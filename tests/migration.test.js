// Migration 001 must map every legacy order state correctly, keep stock consistent, and be re-runnable.
const h = require('./helpers');
const { initDatabase } = require('../config/database');
const { runMigrations } = require('../scripts/migrate');
const { createLegacySchema } = require('./fixtures/legacyShopSchema');
const { sweep } = require('../services/orderLifecycle');

const LEGACY_ORDERS = [
    // order_number, status, payment_status, method -> expected payment_status
    ['UPI-PENDING', 'pending_payment', 'pending', 'upi', 'awaiting_payment'],
    ['UPI-PAID', 'placed', 'paid', 'upi', 'confirmed'],
    ['UPI-PAID-CANCELLED', 'cancelled', 'paid', 'upi', 'refund_due'],
    ['UPI-FAILED', 'pending_payment', 'failed', 'upi', 'awaiting_payment'],
    ['UPI-CANCELLED', 'cancelled', 'pending', 'upi', 'void'],
    ['COD-PLACED', 'placed', 'pending', 'cod', 'cod_pending'],
    ['COD-DELIVERED', 'delivered', 'pending', 'cod', 'cod_collected'],
    ['COD-REJECTED', 'rejected', 'pending', 'cod', 'void'],
    ['UPI-REFUNDED', 'cancelled', 'refunded', 'upi', 'refunded'],
];

beforeAll(async () => {
    const tables = await h.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()');
    await h.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const { name } of tables) await h.query(`DROP TABLE IF EXISTS \`${name}\``);
    await h.query('SET FOREIGN_KEY_CHECKS = 1');
    await initDatabase();
    await createLegacySchema();

    await h.query("INSERT INTO users (id, username, email, password) VALUES (1, 'seller', 's@x.com', 'x'), (2, 'buyer', 'b@x.com', 'x')");
    await h.query("INSERT INTO shops (id, owner_user_id, name, slug, contact_phone, upi_id, status) VALUES (1, 1, 'Old Shop', 'old', '9', 'oldshop@okaxis', 'approved')");
    await h.query("INSERT INTO shop_products (id, shop_id, title, slug, price_paise, stock_quantity, status) VALUES (1, 1, 'Rosary', 'rosary', 10000, 5, 'active')");
    await h.query("INSERT INTO shop_addresses (id, user_id, full_name, phone, line1, city, state, pincode) VALUES (1, 2, 'Buyer One', '9000000000', 'Line 1', 'Jalandhar', 'Punjab', '144001')");
    for (const [number, status, paymentStatus, method] of LEGACY_ORDERS) {
        const result = await h.query(
            'INSERT INTO shop_orders (order_number, customer_user_id, shop_id, address_id, subtotal_paise, total_paise, status, payment_status, payment_method) VALUES (?, 2, 1, 1, 10000, 10000, ?, ?, ?)',
            [number, status, paymentStatus, method]
        );
        await h.query("INSERT INTO shop_order_items (order_id, product_id, product_title_snapshot, unit_price_paise, quantity, line_total_paise) VALUES (?, 1, 'Rosary', 10000, 1, 10000)", [result.insertId]);
    }
    await runMigrations({ log: () => {} });
});

afterAll(() => h.closeDatabase());

test('every legacy payment state maps to the right P2P state', async () => {
    for (const [number, , , , expected] of LEGACY_ORDERS) {
        const row = await h.queryOne('SELECT payment_status FROM shop_orders WHERE order_number = ?', [number]);
        expect([number, row.payment_status]).toEqual([number, expected]);
    }
});

test('legacy orders get the payee and delivery address copied onto them', async () => {
    const row = await h.queryOne("SELECT * FROM shop_orders WHERE order_number = 'UPI-PAID'");
    expect(row).toMatchObject({ payee_upi_id: 'oldshop@okaxis', payee_name: 'Old Shop', ship_full_name: 'Buyer One', ship_city: 'Jalandhar' });
});

test('legacy unpaid UPI orders are cancelled by the first sweep and their stock returned', async () => {
    // Treat the legacy deadline (NOW at migration time) as past the grace period.
    await h.query("UPDATE shop_orders SET pay_by = NOW() - INTERVAL 11 MINUTE WHERE order_number IN ('UPI-PENDING', 'UPI-FAILED')");
    const before = await h.stockOf({ id: 1 });
    await sweep();
    expect(await h.stockOf({ id: 1 })).toBe(before + 2);
    const rows = await h.query("SELECT status, payment_status FROM shop_orders WHERE order_number IN ('UPI-PENDING', 'UPI-FAILED')");
    expect(rows.every((r) => r.status === 'cancelled' && r.payment_status === 'void')).toBe(true);
});

test('already-cancelled legacy orders are marked as restocked so no later path restocks them again', async () => {
    const row = await h.queryOne("SELECT stock_released_at FROM shop_orders WHERE order_number = 'UPI-CANCELLED'");
    expect(row.stock_released_at).not.toBeNull();
});

test('the empty legacy payments table is dropped and the new tables exist', async () => {
    const tables = (await h.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()')).map((t) => t.name);
    expect(tables).not.toContain('shop_payments');
    expect(tables).toEqual(expect.arrayContaining(['shop_checkouts', 'shop_payment_claims', 'shop_disputes', 'shop_order_messages', 'shop_order_evidence', 'audit_log', 'schema_migrations']));
});

test('saved addresses used by old orders can now be deleted', async () => {
    await h.query('DELETE FROM shop_addresses WHERE id = 1');
    const row = await h.queryOne("SELECT address_id, ship_full_name FROM shop_orders WHERE order_number = 'UPI-PAID'");
    expect(row).toEqual({ address_id: null, ship_full_name: 'Buyer One' });
});

test('running the migrations again changes nothing', async () => {
    const before = await h.query('SELECT id, payment_status, status FROM shop_orders ORDER BY id');
    await runMigrations({ log: () => {} });
    const after = await h.query('SELECT id, payment_status, status FROM shop_orders ORDER BY id');
    expect(after).toEqual(before);
    const applied = await h.query('SELECT id FROM schema_migrations');
    expect(applied).toEqual([{ id: '001_p2p_payments' }]);
});

test('stock can no longer go negative at the database level', async () => {
    await expect(h.query('UPDATE shop_products SET stock_quantity = -1 WHERE id = 1')).rejects.toThrow();
});
