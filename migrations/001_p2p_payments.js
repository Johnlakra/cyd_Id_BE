// migrations/001_p2p_payments.js - Move from the gateway (YouPI) payment model to peer-to-peer UPI.
//
// MySQL/MariaDB commit each DDL statement on their own, so a failure part-way leaves earlier
// steps applied. Every step below therefore checks before it changes anything and is safe to
// re-run until the whole migration succeeds and is recorded in schema_migrations.
const { query, queryOne } = require('../config/database');
const {
    tableExists,
    columnInfo,
    addColumnIfMissing,
    addIndexIfMissing,
    foreignKeyFor,
    checkConstraintExists,
} = require('../config/migrationHelpers');

const NEW_PAYMENT_STATUSES = [
    'awaiting_payment',
    'claimed',
    'confirmed',
    'disputed',
    'refund_due',
    'refunded',
    'void',
    'written_off',
    'cod_pending',
    'cod_collected',
];
const OLD_PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'];

const enumSql = (values) => `ENUM(${values.map((v) => `'${v}'`).join(', ')})`;

const ensureUniqueShopOwner = async () => {
    const duplicates = await query(
        'SELECT owner_user_id, COUNT(*) AS shop_count FROM shops GROUP BY owner_user_id HAVING COUNT(*) > 1'
    );
    if (duplicates.length > 0) {
        const list = duplicates.map((d) => `user ${d.owner_user_id} (${d.shop_count} shops)`).join(', ');
        throw new Error(
            `Some users own more than one shop: ${list}. Keep one shop per user (delete or merge the others), then re-run the migration.`
        );
    }
    await addIndexIfMissing('uniq_shops_owner', 'shops', 'owner_user_id', { unique: true });
    await addColumnIfMissing('shops', 'upi_id_changed_at', 'DATETIME NULL');
};

const addOrderColumns = async () => {
    const columns = [
        ['payee_upi_id', 'VARCHAR(100) NULL'],
        ['payee_name', 'VARCHAR(150) NULL'],
        ['pay_by', 'DATETIME NULL'],
        ['confirm_by', 'DATETIME NULL'],
        ['confirmed_at', 'DATETIME NULL'],
        ['stock_released_at', 'DATETIME NULL'],
        ['cancelled_at', 'DATETIME NULL'],
        ['cancelled_by', "ENUM('buyer', 'seller', 'system', 'admin') NULL"],
        ['cancel_reason', 'VARCHAR(500) NULL'],
        ['checkout_id', 'INT NULL'],
        ['ship_full_name', 'VARCHAR(100) NULL'],
        ['ship_phone', 'VARCHAR(20) NULL'],
        ['ship_line1', 'VARCHAR(200) NULL'],
        ['ship_line2', 'VARCHAR(200) NULL'],
        ['ship_city', 'VARCHAR(100) NULL'],
        ['ship_state', 'VARCHAR(100) NULL'],
        ['ship_pincode', 'VARCHAR(10) NULL'],
    ];
    for (const [name, definition] of columns) {
        await addColumnIfMissing('shop_orders', name, definition);
    }
};

// Changing an ENUM's members in one step fails in strict mode (and silently writes '' on
// non-strict MariaDB) for any row holding a value that is being removed. So: widen to old+new,
// map the rows, then narrow to the new set.
const migratePaymentStatus = async () => {
    const info = await columnInfo('shop_orders', 'payment_status');
    const alreadyMigrated = info.columnType.includes("'awaiting_payment'") && !info.columnType.includes("'pending'");
    if (alreadyMigrated) return;

    const union = [...new Set([...OLD_PAYMENT_STATUSES, ...NEW_PAYMENT_STATUSES])];
    await query(`ALTER TABLE shop_orders MODIFY payment_status ${enumSql(union)} NULL DEFAULT 'pending'`);

    await query("UPDATE shop_orders SET payment_status = 'pending' WHERE payment_status IS NULL");
    await query(
        "UPDATE shop_orders SET payment_status = 'void' WHERE payment_status IN ('pending', 'failed') AND status IN ('cancelled', 'rejected')"
    );
    await query(
        "UPDATE shop_orders SET payment_status = 'refund_due' WHERE payment_status = 'paid' AND status IN ('cancelled', 'rejected')"
    );
    await query(
        "UPDATE shop_orders SET payment_status = 'cod_collected' WHERE payment_status = 'pending' AND payment_method = 'cod' AND status = 'delivered'"
    );
    await query("UPDATE shop_orders SET payment_status = 'cod_pending' WHERE payment_status = 'pending' AND payment_method = 'cod'");
    // Legacy unpaid UPI orders get an already-passed deadline, so the first expiry sweep cancels
    // them and releases the stock they have been holding.
    await query(
        "UPDATE shop_orders SET payment_status = 'awaiting_payment', pay_by = NOW() WHERE payment_status IN ('pending', 'failed') AND payment_method = 'upi' AND status = 'pending_payment'"
    );
    await query(
        "UPDATE shop_orders SET payment_status = 'confirmed', confirmed_at = COALESCE(confirmed_at, updated_at) WHERE payment_status = 'paid'"
    );
    await query("UPDATE shop_orders SET payment_status = 'void' WHERE payment_status = 'failed'");

    await query(
        `ALTER TABLE shop_orders MODIFY payment_status ${enumSql(NEW_PAYMENT_STATUSES)} NOT NULL DEFAULT 'awaiting_payment'`
    );
};

const backfillOrders = async () => {
    // The old cancel endpoint already restocked cancelled orders; record that so no later path
    // (e.g. a dispute resolution) can restock them a second time.
    await query(
        "UPDATE shop_orders SET stock_released_at = updated_at, cancelled_at = COALESCE(cancelled_at, updated_at) WHERE status = 'cancelled' AND stock_released_at IS NULL"
    );
    await query(
        "UPDATE shop_orders SET cancelled_at = COALESCE(cancelled_at, updated_at) WHERE status = 'rejected' AND cancelled_at IS NULL"
    );
    await query(
        `UPDATE shop_orders o JOIN shops s ON s.id = o.shop_id
         SET o.payee_upi_id = s.upi_id, o.payee_name = s.name
         WHERE o.payment_method = 'upi' AND o.payee_name IS NULL`
    );
    await query(
        `UPDATE shop_orders o JOIN shop_addresses a ON a.id = o.address_id
         SET o.ship_full_name = a.full_name, o.ship_phone = a.phone, o.ship_line1 = a.line1, o.ship_line2 = a.line2,
             o.ship_city = a.city, o.ship_state = a.state, o.ship_pincode = a.pincode
         WHERE o.ship_full_name IS NULL`
    );
};

// Orders now carry their own copy of the delivery address, so deleting a saved address must not
// be blocked by (or rewrite) old orders: address_id becomes nullable with ON DELETE SET NULL.
const relaxOrderAddressForeignKey = async () => {
    const fk = await foreignKeyFor('shop_orders', 'address_id');
    if (fk && fk.deleteRule === 'SET NULL') return;
    if (fk) {
        await query(`ALTER TABLE shop_orders DROP FOREIGN KEY ${fk.name}`);
    }
    await query('ALTER TABLE shop_orders MODIFY address_id INT NULL');
    await query(
        'ALTER TABLE shop_orders ADD CONSTRAINT fk_shop_orders_address FOREIGN KEY (address_id) REFERENCES shop_addresses(id) ON DELETE SET NULL'
    );
};

const createTables = async () => {
    await query(`
        CREATE TABLE IF NOT EXISTS shop_checkouts (
            id INT PRIMARY KEY AUTO_INCREMENT,
            user_id INT NOT NULL,
            idempotency_key VARCHAR(64) NOT NULL,
            request_hash CHAR(64) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_checkout_key (user_id, idempotency_key),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS shop_payment_claims (
            id INT PRIMARY KEY AUTO_INCREMENT,
            order_id INT NOT NULL,
            utr CHAR(12) NOT NULL,
            amount_paise BIGINT UNSIGNED NOT NULL,
            refund_utr CHAR(12) NULL,
            refunded_at DATETIME NULL,
            claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_claim_order (order_id),
            UNIQUE KEY uniq_claim_utr (utr),
            UNIQUE KEY uniq_claim_refund_utr (refund_utr),
            FOREIGN KEY (order_id) REFERENCES shop_orders(id)
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS shop_order_evidence (
            id INT PRIMARY KEY AUTO_INCREMENT,
            order_id INT NOT NULL,
            uploader_user_id INT NOT NULL,
            kind ENUM('payment_proof', 'refund_proof', 'other') NOT NULL DEFAULT 'other',
            public_id VARCHAR(255) NOT NULL,
            format VARCHAR(20) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_evidence_order (order_id),
            FOREIGN KEY (order_id) REFERENCES shop_orders(id),
            FOREIGN KEY (uploader_user_id) REFERENCES users(id)
        )
    `);

    // open_order_id is order_id while the dispute is open and NULL once resolved; its UNIQUE index
    // allows only one open dispute per order while still allowing later disputes on the same order.
    await query(`
        CREATE TABLE IF NOT EXISTS shop_disputes (
            id INT PRIMARY KEY AUTO_INCREMENT,
            order_id INT NOT NULL,
            origin_payment_status VARCHAR(30) NOT NULL,
            opened_by_user_id INT NOT NULL,
            opened_by_role ENUM('buyer', 'seller') NOT NULL,
            reason ENUM('not_received', 'not_confirmed', 'wrong_amount', 'refund_not_received', 'paid_after_cancel', 'not_delivered', 'other') NOT NULL,
            description VARCHAR(1000) NULL,
            status ENUM('open', 'resolved') NOT NULL DEFAULT 'open',
            resolution VARCHAR(30) NULL,
            resolution_note VARCHAR(1000) NULL,
            resolved_by INT NULL,
            opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            resolved_at DATETIME NULL,
            open_order_id INT AS (IF(status = 'open', order_id, NULL)) STORED,
            UNIQUE KEY uniq_open_dispute (open_order_id),
            INDEX idx_disputes_order (order_id),
            INDEX idx_disputes_status (status),
            FOREIGN KEY (order_id) REFERENCES shop_orders(id),
            FOREIGN KEY (opened_by_user_id) REFERENCES users(id),
            FOREIGN KEY (resolved_by) REFERENCES users(id)
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS shop_order_messages (
            id INT PRIMARY KEY AUTO_INCREMENT,
            order_id INT NOT NULL,
            sender_user_id INT NULL,
            sender_role ENUM('buyer', 'seller', 'admin', 'system') NOT NULL,
            body VARCHAR(1000) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_messages_order (order_id, id),
            FOREIGN KEY (order_id) REFERENCES shop_orders(id),
            FOREIGN KEY (sender_user_id) REFERENCES users(id)
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS audit_log (
            id INT PRIMARY KEY AUTO_INCREMENT,
            actor_user_id INT NULL,
            action VARCHAR(60) NOT NULL,
            entity VARCHAR(40) NOT NULL,
            entity_id INT NULL,
            data JSON NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_audit_entity (entity, entity_id)
        )
    `);

    await addIndexIfMissing('idx_orders_payment_due', 'shop_orders', 'payment_status, pay_by');
    await addIndexIfMissing('idx_orders_checkout', 'shop_orders', 'checkout_id');
};

const enforceNonNegativeStock = async () => {
    if (await checkConstraintExists('shop_products', 'chk_products_stock_nonneg')) return;
    // Negative stock is always a bug (the old checkout allowed it); clamp before adding the rule.
    await query('UPDATE shop_products SET stock_quantity = 0 WHERE stock_quantity < 0');
    await query('ALTER TABLE shop_products ADD CONSTRAINT chk_products_stock_nonneg CHECK (stock_quantity >= 0)');
};

// The YouPI-era payments table is no longer used. Drop it only if nothing was ever recorded.
const dropLegacyPaymentsTable = async () => {
    if (!(await tableExists('shop_payments'))) return;
    const row = await queryOne('SELECT COUNT(*) AS count FROM shop_payments');
    if (row.count === 0) {
        await query('DROP TABLE shop_payments');
    }
};

module.exports = {
    id: '001_p2p_payments',
    up: async () => {
        await ensureUniqueShopOwner();
        await addOrderColumns();
        await migratePaymentStatus();
        await backfillOrders();
        await relaxOrderAddressForeignKey();
        await createTables();
        await enforceNonNegativeStock();
        await dropLegacyPaymentsTable();
    },
};
