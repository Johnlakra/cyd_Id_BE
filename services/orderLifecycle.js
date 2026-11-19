// services/orderLifecycle.js - The ONLY place that changes an order's status or payment_status.
//
// Payment model (peer-to-peer, like crypto-exchange P2P): the platform never holds money. When an
// order is placed its stock is reserved (that is the "escrow"); the buyer pays the seller's own UPI
// ID directly and submits the 12-digit UTR; the seller checks their bank app and confirms. Disputes
// are decided by an admin. See docs/PAYMENTS.md for the full rules.
//
// Every transition runs in a transaction that first locks the order row (SELECT ... FOR UPDATE),
// re-checks the state under that lock, then updates with a WHERE on the expected state. This is
// what stops two simultaneous requests (double cancel, cancel vs accept, claim vs expiry) from
// both succeeding. Stock is returned at most once, guarded by shop_orders.stock_released_at.
const crypto = require('crypto');
const { withTransaction, query, queryOne } = require('../config/database');
const config = require('../config/shopConfig');
const { HttpError } = require('../utils/httpError');
const { generateOrderNumber } = require('../utils/shopHelpers');

const UTR_PATTERN = /^\d{12}$/;
const UPI_ID_PATTERN = /^[\w.+-]{2,256}@[a-zA-Z]{2,64}$/;

const ALLOWED_FULFILMENT = {
    placed: ['accepted'],
    accepted: ['packed'],
    packed: ['shipped'],
    shipped: ['delivered'],
};

const OPEN_UPI_STATES = ['awaiting_payment', 'claimed'];

// Which dispute resolutions an admin may choose, by the payment state the dispute was opened from.
const RESOLUTIONS_BY_ORIGIN = {
    claimed: ['payment_confirmed', 'claim_rejected', 'refund_required'],
    void: ['refund_required', 'claim_rejected'],
    confirmed: ['refund_required', 'fulfilment_ordered'],
    refund_due: ['refund_confirmed', 'refund_required', 'closed_unrecoverable'],
    refunded: ['refund_confirmed', 'refund_required', 'closed_unrecoverable'],
};

const normalizeUtr = (utr) => String(utr || '').replace(/[\s-]/g, '');

const requireUtr = (utr, label = 'UTR') => {
    const normalized = normalizeUtr(utr);
    if (!UTR_PATTERN.test(normalized)) {
        throw new HttpError(400, `${label} must be the 12-digit UPI reference number (UPI Ref No), not the transaction ID`);
    }
    return normalized;
};

const isDuplicateKey = (error, keyName) =>
    error && error.code === 'ER_DUP_ENTRY' && (!keyName || String(error.sqlMessage || error.message).includes(keyName));

// Retry once on deadlock: two transactions locking overlapping rows in different orders can
// deadlock; MySQL kills one, and replaying it is safe because nothing was committed.
const runTransaction = async (callback) => {
    try {
        return await withTransaction(callback);
    } catch (error) {
        if (error && (error.code === 'ER_LOCK_DEADLOCK' || error.errno === 1213)) {
            return withTransaction(callback);
        }
        throw error;
    }
};

// ---- helpers used inside a transaction (tx = { query, queryOne }) ----

const lockOrder = async (tx, orderId) => {
    const order = await tx.queryOne('SELECT * FROM shop_orders WHERE id = ? FOR UPDATE', [orderId]);
    if (!order) throw new HttpError(404, 'Order not found');
    const shop = await tx.queryOne('SELECT id, owner_user_id, name, status FROM shops WHERE id = ?', [order.shop_id]);
    return { order, shop };
};

const roleOf = (order, shop, user) => {
    if (order.customer_user_id === user.id) return 'buyer';
    if (shop && shop.owner_user_id === user.id) return 'seller';
    if (user.role === 'admin') return 'admin';
    return null;
};

const requireRole = (order, shop, user, ...allowed) => {
    const role = roleOf(order, shop, user);
    if (!role) throw new HttpError(404, 'Order not found');
    if (!allowed.includes(role)) throw new HttpError(403, 'You cannot do this on this order');
    return role;
};

// Conditional update: only applies if the order is still in `expectedPaymentStatus`.
const updateOrder = async (tx, orderId, expectedPaymentStatus, fields) => {
    const keys = Object.keys(fields);
    const assignments = keys.map((key) => {
        const value = fields[key];
        return value && typeof value === 'object' && value.sql ? `${key} = ${value.sql}` : `${key} = ?`;
    });
    const params = keys
        .filter((key) => !(fields[key] && typeof fields[key] === 'object' && fields[key].sql))
        .map((key) => fields[key]);
    const result = await tx.query(
        `UPDATE shop_orders SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = ?`,
        [...params, orderId, expectedPaymentStatus]
    );
    if (result.affectedRows !== 1) {
        throw new HttpError(409, 'This order changed in the meantime. Please refresh and try again.');
    }
};

const sql = (fragment) => ({ sql: fragment });

const releaseStock = async (tx, orderId) => {
    const claimed = await tx.query(
        'UPDATE shop_orders SET stock_released_at = NOW() WHERE id = ? AND stock_released_at IS NULL',
        [orderId]
    );
    if (claimed.affectedRows !== 1) return false;
    const items = await tx.query(
        'SELECT product_id, quantity FROM shop_order_items WHERE order_id = ? ORDER BY product_id',
        [orderId]
    );
    for (const item of items) {
        await tx.query('UPDATE shop_products SET stock_quantity = stock_quantity + ? WHERE id = ?', [item.quantity, item.product_id]);
    }
    return true;
};

const systemMessage = (tx, orderId, body) =>
    tx.query("INSERT INTO shop_order_messages (order_id, sender_user_id, sender_role, body) VALUES (?, NULL, 'system', ?)", [
        orderId,
        body,
    ]);

const audit = (tx, actorUserId, action, entity, entityId, data) =>
    tx.query('INSERT INTO audit_log (actor_user_id, action, entity, entity_id, data) VALUES (?, ?, ?, ?, ?)', [
        actorUserId || null,
        action,
        entity,
        entityId,
        data ? JSON.stringify(data) : null,
    ]);

const formatRupees = (paise) => `₹${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;

// ---- checkout ----

const hashRequest = (payload) => crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

const checkoutOrders = async (checkoutId) => {
    const orders = await query(
        `SELECT o.id, o.order_number, o.shop_id, s.name AS shop_name, o.total_paise, o.status, o.payment_status,
                o.payment_method, o.pay_by
         FROM shop_orders o JOIN shops s ON s.id = o.shop_id
         WHERE o.checkout_id = ? ORDER BY o.id`,
        [checkoutId]
    );
    return orders;
};

const mergeLines = (items) => {
    const merged = new Map();
    for (const item of items) {
        const productId = Number(item.product_id);
        const quantity = Number(item.quantity);
        if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(quantity) || quantity < 1) {
            throw new HttpError(400, 'Each item needs a valid product_id and a quantity of at least 1');
        }
        merged.set(productId, (merged.get(productId) || 0) + quantity);
    }
    if (merged.size === 0) throw new HttpError(400, 'Your cart is empty');
    if (merged.size > config.maxCheckoutLines) {
        throw new HttpError(400, `A checkout can contain at most ${config.maxCheckoutLines} different products`);
    }
    for (const [productId, quantity] of merged) {
        if (quantity > config.maxLineQuantity) {
            throw new HttpError(400, `Quantity for product ${productId} cannot exceed ${config.maxLineQuantity}`);
        }
    }
    return [...merged.entries()].sort((a, b) => a[0] - b[0]);
};

const createCheckout = async (user, { address_id, items, payment_methods, payment_method, notes }, idempotencyKey) => {
    if (!idempotencyKey || !/^[\w-]{8,64}$/.test(idempotencyKey)) {
        throw new HttpError(400, 'A valid Idempotency-Key header (8-64 letters, digits, - or _) is required');
    }
    if (!Array.isArray(items)) throw new HttpError(400, 'items must be a list');
    const lines = mergeLines(items);
    const methods = payment_methods && typeof payment_methods === 'object' ? payment_methods : {};
    const requestHash = hashRequest({ address_id: Number(address_id), lines, methods, payment_method: payment_method || null });

    try {
        const checkoutId = await runTransaction(async (tx) => {
            const inserted = await tx.query(
                'INSERT INTO shop_checkouts (user_id, idempotency_key, request_hash) VALUES (?, ?, ?)',
                [user.id, idempotencyKey, requestHash]
            );

            const address = await tx.queryOne('SELECT * FROM shop_addresses WHERE id = ? AND user_id = ?', [address_id, user.id]);
            if (!address) throw new HttpError(404, 'Delivery address not found');

            // Lock the products in ascending id order so two checkouts that share products always
            // take their locks in the same order (no deadlock).
            const productIds = lines.map(([id]) => id);
            const products = await tx.query(
                `SELECT * FROM shop_products WHERE id IN (${productIds.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`,
                productIds
            );
            const productById = new Map(products.map((p) => [p.id, p]));

            const shopIds = [...new Set(products.map((p) => p.shop_id))];
            const shops = shopIds.length
                ? await tx.query(`SELECT * FROM shops WHERE id IN (${shopIds.map(() => '?').join(',')})`, shopIds)
                : [];
            const shopById = new Map(shops.map((s) => [s.id, s]));

            const byShop = new Map();
            for (const [productId, quantity] of lines) {
                const product = productById.get(productId);
                const shop = product && shopById.get(product.shop_id);
                if (!product || product.status !== 'active' || !shop || shop.status !== 'approved') {
                    throw new HttpError(400, `Product ${productId} is no longer available`);
                }
                if (shop.owner_user_id === user.id) {
                    throw new HttpError(400, `You cannot buy from your own shop ("${shop.name}")`);
                }
                if (product.stock_quantity < quantity) {
                    throw new HttpError(400, `Only ${product.stock_quantity} left of "${product.title}"`);
                }
                if (!byShop.has(shop.id)) byShop.set(shop.id, { shop, lines: [] });
                byShop.get(shop.id).lines.push({ product, quantity });
            }

            let newUpiOrders = 0;
            for (const group of byShop.values()) {
                const method = methods[group.shop.id] || methods[String(group.shop.id)] || payment_method;
                if (!['upi', 'cod'].includes(method)) {
                    throw new HttpError(400, `Choose UPI or cash on delivery for "${group.shop.name}"`);
                }
                if (method === 'upi' && !(group.shop.upi_id && UPI_ID_PATTERN.test(group.shop.upi_id))) {
                    throw new HttpError(400, `"${group.shop.name}" only accepts cash on delivery`);
                }
                group.method = method;
                if (method === 'upi') newUpiOrders += 1;
            }

            if (newUpiOrders > 0) {
                const open = await tx.queryOne(
                    `SELECT COUNT(*) AS count FROM shop_orders WHERE customer_user_id = ? AND payment_status IN ('awaiting_payment', 'claimed')`,
                    [user.id]
                );
                if (open.count + newUpiOrders > config.maxOpenUpiOrdersPerBuyer) {
                    throw new HttpError(
                        400,
                        `You can have at most ${config.maxOpenUpiOrdersPerBuyer} unpaid UPI orders at a time. Pay or cancel an existing order first.`
                    );
                }
            }

            for (const group of byShop.values()) {
                let subtotal = 0;
                for (const line of group.lines) {
                    const decremented = await tx.query(
                        'UPDATE shop_products SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?',
                        [line.quantity, line.product.id, line.quantity]
                    );
                    if (decremented.affectedRows !== 1) {
                        throw new HttpError(409, `"${line.product.title}" just sold out`);
                    }
                    subtotal += line.product.price_paise * line.quantity;
                }

                const isUpi = group.method === 'upi';
                const orderResult = await tx.query(
                    `INSERT INTO shop_orders (
                        order_number, checkout_id, customer_user_id, shop_id, address_id,
                        subtotal_paise, shipping_paise, total_paise, status, payment_status, payment_method, notes,
                        payee_upi_id, payee_name, pay_by,
                        ship_full_name, ship_phone, ship_line1, ship_line2, ship_city, ship_state, ship_pincode
                     ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ${isUpi ? 'NOW() + INTERVAL ? MINUTE' : 'NULL'},
                               ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        generateOrderNumber(),
                        inserted.insertId,
                        user.id,
                        group.shop.id,
                        address.id,
                        subtotal,
                        subtotal,
                        isUpi ? 'pending_payment' : 'placed',
                        isUpi ? 'awaiting_payment' : 'cod_pending',
                        group.method,
                        notes ? String(notes).slice(0, 500) : null,
                        isUpi ? group.shop.upi_id : null,
                        group.shop.name,
                        ...(isUpi ? [config.payWindowMinutes] : []),
                        address.full_name,
                        address.phone,
                        address.line1,
                        address.line2,
                        address.city,
                        address.state,
                        address.pincode,
                    ]
                );
                const orderId = orderResult.insertId;

                for (const line of group.lines) {
                    await tx.query(
                        `INSERT INTO shop_order_items (order_id, product_id, product_title_snapshot, unit_price_paise, quantity, line_total_paise)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [orderId, line.product.id, line.product.title, line.product.price_paise, line.quantity, line.product.price_paise * line.quantity]
                    );
                }

                await systemMessage(
                    tx,
                    orderId,
                    isUpi
                        ? `Order placed. Buyer pays ${formatRupees(subtotal)} directly to the seller's UPI ID within ${config.payWindowMinutes} minutes, then submits the UPI reference number.`
                        : `Order placed with cash on delivery (${formatRupees(subtotal)}).`
                );
                await audit(tx, user.id, 'order.created', 'order', orderId, { method: group.method, total_paise: subtotal });
            }

            return inserted.insertId;
        });

        return { checkout_id: checkoutId, replayed: false, orders: await checkoutOrders(checkoutId) };
    } catch (error) {
        if (!isDuplicateKey(error, 'uniq_checkout_key')) throw error;
        // Same Idempotency-Key again (a retry or a double submit): return what the first one made.
        const existing = await queryOne('SELECT * FROM shop_checkouts WHERE user_id = ? AND idempotency_key = ?', [
            user.id,
            idempotencyKey,
        ]);
        if (!existing || existing.request_hash !== requestHash) {
            throw new HttpError(409, 'This checkout key was already used for a different cart. Please refresh and try again.');
        }
        return { checkout_id: existing.id, replayed: true, orders: await checkoutOrders(existing.id) };
    }
};

// ---- buyer actions ----

const claimPayment = async (user, orderId, { utr, evidence }) => {
    const normalized = requireUtr(utr);
    return runTransaction(async (tx) => {
        const { order, shop } = await lockOrder(tx, orderId);
        requireRole(order, shop, user, 'buyer');
        if (order.payment_method !== 'upi') throw new HttpError(400, 'This is a cash-on-delivery order');
        if (order.payment_status !== 'awaiting_payment') throw new HttpError(409, 'This order is not waiting for payment');
        if (shop.status !== 'approved') {
            throw new HttpError(409, 'This shop is suspended and cannot take payments. Do not pay; the order will be cancelled.');
        }
        const window = await tx.queryOne('SELECT (pay_by + INTERVAL ? MINUTE) > NOW() AS open FROM shop_orders WHERE id = ?', [
            config.payGraceMinutes,
            order.id,
        ]);
        if (!window.open) {
            throw new HttpError(409, 'The payment window has closed. If you already paid, open a "paid after cancel" dispute with your UTR.');
        }

        try {
            await tx.query('INSERT INTO shop_payment_claims (order_id, utr, amount_paise) VALUES (?, ?, ?)', [
                order.id,
                normalized,
                order.total_paise,
            ]);
        } catch (error) {
            if (isDuplicateKey(error, 'uniq_claim_utr')) throw new HttpError(409, 'This UTR has already been used for another order');
            throw error;
        }

        await updateOrder(tx, order.id, 'awaiting_payment', {
            payment_status: 'claimed',
            confirm_by: sql(`NOW() + INTERVAL ${Number(config.confirmWindowMinutes)} MINUTE`),
        });
        if (evidence) {
            await tx.query(
                "INSERT INTO shop_order_evidence (order_id, uploader_user_id, kind, public_id, format) VALUES (?, ?, 'payment_proof', ?, ?)",
                [order.id, user.id, evidence.public_id, evidence.format]
            );
        }
        await systemMessage(tx, order.id, `Buyer says they paid ${formatRupees(order.total_paise)}. UPI Ref No: ${normalized}. Seller: please check your bank app and confirm.`);
        await audit(tx, user.id, 'payment.claimed', 'order', order.id, { utr: normalized });
    });
};

const editClaim = async (user, orderId, { utr }) => {
    const normalized = requireUtr(utr);
    return runTransaction(async (tx) => {
        const { order, shop } = await lockOrder(tx, orderId);
        requireRole(order, shop, user, 'buyer');
        if (order.payment_status !== 'claimed') throw new HttpError(409, 'The UTR can only be changed before the seller responds');
        try {
            await tx.query('UPDATE shop_payment_claims SET utr = ? WHERE order_id = ?', [normalized, order.id]);
        } catch (error) {
            if (isDuplicateKey(error, 'uniq_claim_utr')) throw new HttpError(409, 'This UTR has already been used for another order');
            throw error;
        }
        await systemMessage(tx, order.id, `Buyer corrected the UPI Ref No to ${normalized}.`);
        await audit(tx, user.id, 'payment.claim_edited', 'order', order.id, { utr: normalized });
    });
};

const cancelByBuyer = async (user, orderId, { reason }) =>
    runTransaction(async (tx) => {
        const { order, shop } = await lockOrder(tx, orderId);
        requireRole(order, shop, user, 'buyer');
        const unpaidUpi = order.payment_method === 'upi' && order.payment_status === 'awaiting_payment';
        const codNotStarted = order.payment_method === 'cod' && order.payment_status === 'cod_pending' && order.status === 'placed';
        if (!unpaidUpi && !codNotStarted) {
            throw new HttpError(
                409,
                order.payment_status === 'claimed'
                    ? 'You already submitted a payment for this order. Ask the seller in the chat, or open a dispute after the confirmation window.'
                    : 'This order can no longer be cancelled'
            );
        }
        await updateOrder(tx, order.id, order.payment_status, {
            payment_status: 'void',
            status: 'cancelled',
            cancelled_by: 'buyer',
            cancelled_at: sql('NOW()'),
            cancel_reason: reason ? String(reason).slice(0, 500) : null,
        });
        await releaseStock(tx, order.id);
        await systemMessage(tx, order.id, 'Buyer cancelled the order.');
        await audit(tx, user.id, 'order.cancelled', 'order', order.id, { by: 'buyer' });
    });

// ---- seller actions ----

const confirmPayment = async (user, orderId, { utr }) => {
    const normalized = requireUtr(utr);
    return runTransaction(async (tx) => {
        const { order, shop } = await lockOrder(tx, orderId);
        requireRole(order, shop, user, 'seller');
        if (order.payment_status !== 'claimed') throw new HttpError(409, 'There is no payment claim to confirm');
        const claim = await tx.queryOne('SELECT * FROM shop_payment_claims WHERE order_id = ?', [order.id]);
        if (!claim || claim.utr !== normalized) {
            throw new HttpError(409, 'The buyer has changed the UPI Ref No since you looked. Please check the new one in your bank app.');
        }
        await updateOrder(tx, order.id, 'claimed', {
            payment_status: 'confirmed',
            confirmed_at: sql('NOW()'),
            status: order.status === 'pending_payment' ? 'placed' : order.status,
        });
        await systemMessage(tx, order.id, 'Seller confirmed the payment was received. The order is now being processed.');
        await audit(tx, user.id, 'payment.confirmed', 'order', order.id, { utr: normalized });
    });
};

const rejectBySeller = async (tx, order, user, reason) => {
    let paymentStatus;
    if (order.payment_status === 'awaiting_payment') paymentStatus = 'void';
    else if (order.payment_status === 'cod_pending' && ['placed', 'accepted'].includes(order.status)) paymentStatus = 'void';
    else if (order.payment_status === 'confirmed' && ['placed', 'accepted'].includes(order.status)) paymentStatus = 'refund_due';
    else throw new HttpError(409, 'This order can no longer be rejected');

    await updateOrder(tx, order.id, order.payment_status, {
        payment_status: paymentStatus,
        status: 'rejected',
        cancelled_by: 'seller',
        cancelled_at: sql('NOW()'),
        cancel_reason: reason ? String(reason).slice(0, 500) : null,
    });
    await releaseStock(tx, order.id);
    await systemMessage(
        tx,
        order.id,
        paymentStatus === 'refund_due'
            ? `Seller rejected the order${reason ? `: ${reason}` : ''}. The seller must refund ${formatRupees(order.total_paise)} to the buyer and enter the refund UPI Ref No.`
            : `Seller rejected the order${reason ? `: ${reason}` : ''}.`
    );
    await audit(tx, user.id, 'order.rejected', 'order', order.id, { payment_status: paymentStatus });
};

const advanceFulfilment = async (user, orderId, { status, reason }) =>
    runTransaction(async (tx) => {
        const { order, shop } = await lockOrder(tx, orderId);
        requireRole(order, shop, user, 'seller');
        if (status === 'rejected') return rejectBySeller(tx, order, user, reason);

        if (!['confirmed', 'cod_pending'].includes(order.payment_status)) {
            throw new HttpError(409, 'Confirm the payment before processing this order');
        }
        const allowed = ALLOWED_FULFILMENT[order.status] || [];
        if (!allowed.includes(status)) {
            throw new HttpError(400, `Cannot move order from "${order.status}" to "${status}"`);
        }
        const fields = { status };
        if (status === 'delivered' && order.payment_status === 'cod_pending') fields.payment_status = 'cod_collected';
        await updateOrder(tx, order.id, order.payment_status, fields);
        await systemMessage(tx, order.id, `Seller marked the order as ${status}.`);
        await audit(tx, user.id, 'order.status', 'order', order.id, { status });
    });

const markRefunded = async (user, orderId, { refund_utr }) => {
    const normalized = requireUtr(refund_utr, 'Refund UTR');
    return runTransaction(async (tx) => {
        const { order, shop } = await lockOrder(tx, orderId);
        requireRole(order, shop, user, 'seller');
        if (order.payment_status !== 'refund_due') throw new HttpError(409, 'This order has no refund due');
        const claim = await tx.queryOne('SELECT * FROM shop_payment_claims WHERE order_id = ?', [order.id]);
        if (!claim) throw new HttpError(409, 'No payment was recorded for this order');
        const reused = await tx.queryOne('SELECT id FROM shop_payment_claims WHERE utr = ?', [normalized]);
        if (claim.utr === normalized || reused) {
            throw new HttpError(400, 'The refund UPI Ref No must be the refund transaction, not a payment');
        }
        try {
            await tx.query('UPDATE shop_payment_claims SET refund_utr = ?, refunded_at = NOW() WHERE order_id = ?', [normalized, order.id]);
        } catch (error) {
            if (isDuplicateKey(error, 'uniq_claim_refund_utr')) throw new HttpError(409, 'This refund UTR was already used');
            throw error;
        }
        await updateOrder(tx, order.id, 'refund_due', { payment_status: 'refunded' });
        await systemMessage(tx, order.id, `Seller says they refunded ${formatRupees(order.total_paise)}. Refund UPI Ref No: ${normalized}.`);
        await audit(tx, user.id, 'payment.refunded', 'order', order.id, { refund_utr: normalized });
    });
};

// ---- disputes ----

const disputeEligibility = async (tx, order, role, reason) => {
    const origin = order.payment_status;
    if (order.payment_method !== 'upi') throw new HttpError(400, 'Cash-on-delivery orders have no payment disputes; use the chat or contact an admin');
    const ageCheck = async (expression, params) => (await tx.queryOne(`SELECT ${expression} AS ok FROM shop_orders WHERE id = ?`, [...params, order.id])).ok;

    switch (reason) {
        case 'not_received':
        case 'wrong_amount':
            if (role !== 'seller' || origin !== 'claimed') throw new HttpError(409, 'Only the seller can report this, while a payment claim is waiting');
            return;
        case 'not_confirmed':
            if (role !== 'buyer' || origin !== 'claimed') throw new HttpError(409, 'There is no payment claim waiting for the seller');
            if (!(await ageCheck('confirm_by < NOW()', []))) {
                throw new HttpError(409, 'The seller still has time to confirm. You can open a dispute after the confirmation deadline.');
            }
            return;
        case 'paid_after_cancel':
            if (
                role !== 'buyer' ||
                origin !== 'void' ||
                order.status !== 'cancelled' ||
                !['system', 'buyer'].includes(order.cancelled_by)
            ) {
                throw new HttpError(409, 'This applies only to UPI orders that were cancelled before you could submit your payment');
            }
            if (!(await ageCheck('cancelled_at > NOW() - INTERVAL ? HOUR', [config.paidAfterCancelHours]))) {
                throw new HttpError(409, `This must be reported within ${config.paidAfterCancelHours} hours of the cancellation`);
            }
            return;
        case 'refund_not_received':
            if (role !== 'buyer') throw new HttpError(403, 'Only the buyer can report a missing refund');
            if (origin === 'refund_due') return;
            if (origin === 'refunded') {
                const recent = await tx.queryOne(
                    'SELECT refunded_at > NOW() - INTERVAL ? DAY AS ok FROM shop_payment_claims WHERE order_id = ?',
                    [config.refundDisputeDays, order.id]
                );
                if (recent && recent.ok) return;
                throw new HttpError(409, `Refunds can be disputed within ${config.refundDisputeDays} days`);
            }
            throw new HttpError(409, 'There is no refund on this order');
        case 'not_delivered':
            if (role !== 'buyer' || origin !== 'confirmed' || ['delivered', 'cancelled', 'rejected'].includes(order.status)) {
                throw new HttpError(409, 'This applies only to paid orders that have not been delivered');
            }
            if (!(await ageCheck('confirmed_at < NOW() - INTERVAL ? DAY', [config.notDeliveredAfterDays]))) {
                throw new HttpError(409, `You can report non-delivery ${config.notDeliveredAfterDays} days after the seller confirmed payment`);
            }
            return;
        case 'other':
            if (['claimed', 'confirmed', 'refund_due'].includes(origin)) return;
            if (origin === 'refunded' && role === 'buyer') return disputeEligibility(tx, order, role, 'refund_not_received');
            throw new HttpError(409, 'This order cannot be disputed in its current state');
        default:
            throw new HttpError(400, 'Unknown dispute reason');
    }
};

const BUYER_REASONS_NEEDING_PROOF = ['not_confirmed', 'paid_after_cancel'];

const openDispute = async (user, orderId, { reason, description, utr, evidence }) =>
    runTransaction(async (tx) => {
        const { order, shop } = await lockOrder(tx, orderId);
        const role = requireRole(order, shop, user, 'buyer', 'seller');
        await disputeEligibility(tx, order, role, reason);

        if (role === 'buyer' && BUYER_REASONS_NEEDING_PROOF.includes(reason)) {
            const existingProof = await tx.queryOne(
                "SELECT id FROM shop_order_evidence WHERE order_id = ? AND uploader_user_id = ? AND kind = 'payment_proof'",
                [order.id, user.id]
            );
            if (!existingProof && !evidence) {
                throw new HttpError(400, 'Attach a screenshot of your UPI payment to open this dispute');
            }
        }

        if (reason === 'paid_after_cancel') {
            const normalized = requireUtr(utr);
            try {
                await tx.query('INSERT INTO shop_payment_claims (order_id, utr, amount_paise) VALUES (?, ?, ?)', [
                    order.id,
                    normalized,
                    order.total_paise,
                ]);
            } catch (error) {
                if (isDuplicateKey(error, 'uniq_claim_utr')) throw new HttpError(409, 'This UTR has already been used for another order');
                if (isDuplicateKey(error, 'uniq_claim_order')) throw new HttpError(409, 'A payment is already recorded for this order');
                throw error;
            }
        }

        if (evidence) {
            await tx.query(
                'INSERT INTO shop_order_evidence (order_id, uploader_user_id, kind, public_id, format) VALUES (?, ?, ?, ?, ?)',
                [order.id, user.id, role === 'buyer' ? 'payment_proof' : 'other', evidence.public_id, evidence.format]
            );
        }

        try {
            await tx.query(
                `INSERT INTO shop_disputes (order_id, origin_payment_status, opened_by_user_id, opened_by_role, reason, description)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [order.id, order.payment_status, user.id, role, reason, description ? String(description).slice(0, 1000) : null]
            );
        } catch (error) {
            if (isDuplicateKey(error, 'uniq_open_dispute')) throw new HttpError(409, 'This order already has an open dispute');
            throw error;
        }
        await updateOrder(tx, order.id, order.payment_status, { payment_status: 'disputed' });
        await systemMessage(tx, order.id, `${role === 'buyer' ? 'Buyer' : 'Seller'} opened a dispute (${reason.replace(/_/g, ' ')}). An admin will review the chat and evidence.`);
        await audit(tx, user.id, 'dispute.opened', 'order', order.id, { reason });
    });

const reportNotReceived = (user, orderId, { description }) => openDispute(user, orderId, { reason: 'not_received', description });

const resolveDisputeInTx = async (tx, disputeId, { resolution, note }, actorUserId) => {
    const dispute = await tx.queryOne('SELECT * FROM shop_disputes WHERE id = ?', [disputeId]);
    if (!dispute) throw new HttpError(404, 'Dispute not found');
    const { order } = await lockOrder(tx, dispute.order_id);
    const lockedDispute = await tx.queryOne('SELECT * FROM shop_disputes WHERE id = ? FOR UPDATE', [disputeId]);
    if (lockedDispute.status !== 'open' || order.payment_status !== 'disputed') {
        throw new HttpError(409, 'This dispute is already resolved');
    }

    const origin = lockedDispute.origin_payment_status;
    const allowed = RESOLUTIONS_BY_ORIGIN[origin] || [];
    if (!allowed.includes(resolution)) {
        throw new HttpError(400, `For this dispute, choose one of: ${allowed.join(', ')}`);
    }

    const fields = {};
    let restock = false;
    switch (resolution) {
        case 'payment_confirmed':
            Object.assign(fields, {
                payment_status: 'confirmed',
                confirmed_at: sql('NOW()'),
                status: order.status === 'pending_payment' ? 'placed' : order.status,
            });
            break;
        case 'claim_rejected':
            fields.payment_status = 'void';
            if (origin === 'claimed') {
                Object.assign(fields, { status: 'cancelled', cancelled_by: 'admin', cancelled_at: sql('NOW()'), cancel_reason: 'Payment claim rejected in dispute' });
                restock = true;
            }
            break;
        case 'refund_required':
            fields.payment_status = 'refund_due';
            if (origin === 'claimed' || (origin === 'confirmed' && order.status !== 'delivered')) {
                Object.assign(fields, { status: 'cancelled', cancelled_by: 'admin', cancelled_at: sql('NOW()'), cancel_reason: 'Refund ordered in dispute' });
                restock = origin === 'claimed' || ['placed', 'accepted', 'packed'].includes(order.status);
            }
            if (['refund_due', 'refunded'].includes(origin)) {
                await tx.query('UPDATE shop_payment_claims SET refunded_at = NULL WHERE order_id = ?', [order.id]);
            }
            break;
        case 'fulfilment_ordered':
            fields.payment_status = 'confirmed';
            break;
        case 'refund_confirmed':
            fields.payment_status = 'refunded';
            await tx.query('UPDATE shop_payment_claims SET refunded_at = COALESCE(refunded_at, NOW()) WHERE order_id = ?', [order.id]);
            break;
        case 'closed_unrecoverable':
            fields.payment_status = 'written_off';
            break;
        default:
            throw new HttpError(400, 'Unknown resolution');
    }

    await updateOrder(tx, order.id, 'disputed', fields);
    if (restock) await releaseStock(tx, order.id);
    await tx.query(
        "UPDATE shop_disputes SET status = 'resolved', resolution = ?, resolution_note = ?, resolved_by = ?, resolved_at = NOW() WHERE id = ?",
        [resolution, note, actorUserId || null, disputeId]
    );
    await systemMessage(tx, order.id, `Dispute resolved${actorUserId ? ' by an admin' : ' automatically'}: ${resolution.replace(/_/g, ' ')}. ${note}`);
    await audit(tx, actorUserId, 'dispute.resolved', 'order', order.id, { dispute_id: disputeId, resolution });
};

const resolveDispute = async (admin, disputeId, { resolution, note }) => {
    if (!note || !String(note).trim()) throw new HttpError(400, 'A note explaining the decision is required');
    return runTransaction((tx) => resolveDisputeInTx(tx, disputeId, { resolution, note: String(note).trim().slice(0, 1000) }, admin.id));
};

// ---- admin: shop suspension ----

const voidAwaitingOrdersForShop = async (shopId, actorUserId) => {
    const orders = await query("SELECT id FROM shop_orders WHERE shop_id = ? AND payment_status = 'awaiting_payment'", [shopId]);
    for (const { id } of orders) {
        await runTransaction(async (tx) => {
            const { order } = await lockOrder(tx, id);
            if (order.payment_status !== 'awaiting_payment') return;
            await updateOrder(tx, order.id, 'awaiting_payment', {
                payment_status: 'void',
                status: 'cancelled',
                cancelled_by: 'admin',
                cancelled_at: sql('NOW()'),
                cancel_reason: 'Shop suspended',
            });
            await releaseStock(tx, order.id);
            await systemMessage(tx, order.id, 'This shop was suspended, so this unpaid order was cancelled. Do not send any payment.');
            await audit(tx, actorUserId, 'order.cancelled', 'order', order.id, { by: 'admin', reason: 'shop_suspended' });
        });
    }
    return orders.length;
};

// ---- background sweep ----

const expireOrder = async (orderId) =>
    runTransaction(async (tx) => {
        const order = await tx.queryOne('SELECT * FROM shop_orders WHERE id = ? FOR UPDATE', [orderId]);
        if (!order || order.payment_status !== 'awaiting_payment') return false;
        const due = await tx.queryOne('SELECT (pay_by + INTERVAL ? MINUTE) <= NOW() AS due FROM shop_orders WHERE id = ?', [
            config.payGraceMinutes,
            orderId,
        ]);
        if (!due.due) return false;
        await updateOrder(tx, orderId, 'awaiting_payment', {
            payment_status: 'void',
            status: 'cancelled',
            cancelled_by: 'system',
            cancelled_at: sql('NOW()'),
            cancel_reason: 'Payment window expired',
        });
        await releaseStock(tx, orderId);
        await systemMessage(tx, orderId, 'The payment window expired, so the order was cancelled. Already paid? Open a "paid after cancel" dispute with your UTR within 48 hours.');
        await audit(tx, null, 'order.expired', 'order', orderId, null);
        return true;
    });

const sweep = async () => {
    const result = { expired: 0, autoResolved: 0 };
    // Select without locking, then handle each order in its own transaction that re-checks it.
    const due = await query(
        `SELECT id FROM shop_orders WHERE payment_status = 'awaiting_payment' AND pay_by + INTERVAL ? MINUTE <= NOW() ORDER BY id LIMIT 200`,
        [config.payGraceMinutes]
    );
    for (const { id } of due) {
        try {
            if (await expireOrder(id)) result.expired += 1;
        } catch (error) {
            console.error(`sweep: could not expire order ${id}:`, error.message);
        }
    }

    // Seller said "not received" and the buyer never uploaded proof in time: reject the claim.
    const stale = await query(
        `SELECT d.id FROM shop_disputes d
         JOIN shop_orders o ON o.id = d.order_id
         WHERE d.status = 'open' AND d.reason = 'not_received'
           AND d.opened_at <= NOW() - INTERVAL ? MINUTE
           AND NOT EXISTS (
               SELECT 1 FROM shop_order_evidence e
               WHERE e.order_id = d.order_id AND e.uploader_user_id = o.customer_user_id AND e.created_at >= d.opened_at
           )
         ORDER BY d.id LIMIT 200`,
        [config.disputeProofWindowMinutes]
    );
    for (const { id } of stale) {
        try {
            await runTransaction((tx) =>
                resolveDisputeInTx(tx, id, { resolution: 'claim_rejected', note: 'The buyer did not upload payment proof in time.' }, null)
            );
            result.autoResolved += 1;
        } catch (error) {
            if (!(error instanceof HttpError)) console.error(`sweep: could not auto-resolve dispute ${id}:`, error.message);
        }
    }
    return result;
};

// Render's free tier sleeps, so a timer alone can miss deadlines; requests also trigger a sweep,
// at most once per 30 seconds.
let lastSweepAt = 0;
let runningSweep = null;
const maybeSweep = async () => {
    // Tests call sweep() explicitly so that timing is deterministic.
    if (process.env.NODE_ENV === 'test') return null;
    if (runningSweep) return runningSweep;
    if (Date.now() - lastSweepAt < 30 * 1000) return null;
    lastSweepAt = Date.now();
    runningSweep = sweep()
        .catch((error) => console.error('sweep failed:', error.message))
        .finally(() => {
            runningSweep = null;
        });
    return runningSweep;
};

module.exports = {
    UTR_PATTERN,
    UPI_ID_PATTERN,
    ALLOWED_FULFILMENT,
    OPEN_UPI_STATES,
    RESOLUTIONS_BY_ORIGIN,
    normalizeUtr,
    roleOf,
    createCheckout,
    claimPayment,
    editClaim,
    cancelByBuyer,
    confirmPayment,
    advanceFulfilment,
    markRefunded,
    openDispute,
    reportNotReceived,
    resolveDispute,
    voidAwaitingOrdersForShop,
    expireOrder,
    sweep,
    maybeSweep,
};
