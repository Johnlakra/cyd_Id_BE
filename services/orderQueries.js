// services/orderQueries.js - Read side of orders: what each viewer may see, and which actions they
// may take right now (`allowed_actions`), so the frontend never has to re-implement the rules.
// Time comparisons are done in SQL against the database clock, not the browser's.
const { query, queryOne } = require('../config/database');
const config = require('../config/shopConfig');
const { HttpError } = require('../utils/httpError');
const { privateImageUrl } = require('../utils/fileUpload');
const lifecycle = require('./orderLifecycle');

const TERMINAL_PAYMENT = ['void', 'refunded', 'written_off', 'cod_collected'];

const isTerminal = (order) =>
    TERMINAL_PAYMENT.includes(order.payment_status) || (order.payment_status === 'confirmed' && order.status === 'delivered');

const upiLink = (order) => {
    if (!order.payee_upi_id || !lifecycle.UPI_ID_PATTERN.test(order.payee_upi_id)) return null;
    const rupees = `${Math.floor(order.total_paise / 100)}.${String(order.total_paise % 100).padStart(2, '0')}`;
    return (
        `upi://pay?pa=${order.payee_upi_id}` +
        `&pn=${encodeURIComponent(order.payee_name || 'CYD Shop seller')}` +
        `&am=${rupees}` +
        `&tn=${encodeURIComponent(order.order_number)}` +
        '&cu=INR'
    );
};

// One query that loads an order plus every clock-based flag the rules need.
const loadOrder = (orderId) =>
    queryOne(
        `SELECT o.*, s.name AS shop_name, s.owner_user_id, s.status AS shop_status,
                bu.username AS customer_username,
                (o.pay_by + INTERVAL ? MINUTE) > NOW() AS pay_open,
                TIMESTAMPDIFF(SECOND, NOW(), o.pay_by) AS pay_seconds_left,
                TIMESTAMPDIFF(SECOND, NOW(), o.confirm_by) AS confirm_seconds_left,
                (o.confirm_by < NOW()) AS confirm_overdue,
                (o.confirmed_at < NOW() - INTERVAL ? DAY) AS not_delivered_eligible,
                (o.cancelled_at > NOW() - INTERVAL ? HOUR) AS paid_after_cancel_open,
                (o.updated_at < NOW() - INTERVAL ? DAY) AS stale
         FROM shop_orders o
         JOIN shops s ON s.id = o.shop_id
         JOIN users bu ON bu.id = o.customer_user_id
         WHERE o.id = ?`,
        [config.payGraceMinutes, config.notDeliveredAfterDays, config.paidAfterCancelHours, config.chatReadOnlyAfterDays, orderId]
    );

const loadClaim = (orderId) =>
    queryOne(
        `SELECT utr, amount_paise, claimed_at, updated_at, refund_utr, refunded_at,
                (refunded_at > NOW() - INTERVAL ? DAY) AS refund_recent
         FROM shop_payment_claims WHERE order_id = ?`,
        [config.refundDisputeDays, orderId]
    );

const loadDisputes = (orderId) =>
    query(
        `SELECT id, origin_payment_status, opened_by_role, reason, description, status, resolution, resolution_note,
                opened_at, resolved_at,
                TIMESTAMPDIFF(SECOND, NOW(), opened_at + INTERVAL ? MINUTE) AS proof_seconds_left
         FROM shop_disputes WHERE order_id = ? ORDER BY id`,
        [config.disputeProofWindowMinutes, orderId]
    );

const viewerRole = (order, user, disputes) => {
    if (order.customer_user_id === user.id) return 'buyer';
    if (order.owner_user_id === user.id) return 'seller';
    if (user.role === 'admin') return 'admin';
    return null;
};

const allowedActions = (order, claim, disputes, role) => {
    const actions = [];
    const disputeReasons = [];
    const upi = order.payment_method === 'upi';
    const ps = order.payment_status;
    const openDispute = disputes.find((d) => d.status === 'open');

    if (role === 'buyer') {
        if (upi && ps === 'awaiting_payment' && order.pay_open && order.shop_status === 'approved') actions.push('claim');
        if (ps === 'claimed') actions.push('edit_claim');
        if ((upi && ps === 'awaiting_payment') || (!upi && ps === 'cod_pending' && order.status === 'placed')) actions.push('cancel');
        if (upi && !openDispute) {
            if (ps === 'claimed' && order.confirm_overdue) disputeReasons.push('not_confirmed');
            if (
                ps === 'void' &&
                order.status === 'cancelled' &&
                ['system', 'buyer'].includes(order.cancelled_by) &&
                order.paid_after_cancel_open &&
                !claim
            ) {
                disputeReasons.push('paid_after_cancel');
            }
            const refundOpen = ps === 'refund_due' || (ps === 'refunded' && claim && claim.refund_recent);
            if (refundOpen) disputeReasons.push('refund_not_received');
            if (ps === 'confirmed' && !['delivered', 'cancelled', 'rejected'].includes(order.status) && order.not_delivered_eligible) {
                disputeReasons.push('not_delivered');
            }
            if (['claimed', 'confirmed', 'refund_due'].includes(ps) || (ps === 'refunded' && claim && claim.refund_recent)) {
                disputeReasons.push('other');
            }
        }
    }

    if (role === 'seller') {
        if (ps === 'claimed') {
            actions.push('confirm');
            if (!openDispute) disputeReasons.push('not_received', 'wrong_amount');
        }
        if (ps === 'awaiting_payment' || (['confirmed', 'cod_pending'].includes(ps) && ['placed', 'accepted'].includes(order.status))) {
            actions.push('reject');
        }
        if (['confirmed', 'cod_pending'].includes(ps)) {
            for (const next of lifecycle.ALLOWED_FULFILMENT[order.status] || []) actions.push(`advance:${next}`);
        }
        if (ps === 'refund_due') actions.push('refund');
        if (upi && !openDispute && ['confirmed', 'refund_due'].includes(ps)) disputeReasons.push('other');
    }

    if (role === 'admin' && openDispute) actions.push('resolve');

    const chatReadOnly = isTerminal(order) && order.stale;
    const canSeeChat = role === 'buyer' || role === 'seller' || (role === 'admin' && disputes.length > 0);
    if (canSeeChat && !chatReadOnly) actions.push('chat');
    if ((role === 'buyer' || role === 'seller') && (!isTerminal(order) || openDispute)) actions.push('upload_evidence');
    if (disputeReasons.length) actions.push('dispute');

    return { actions, dispute_reasons: [...new Set(disputeReasons)], chat_read_only: chatReadOnly };
};

const toBool = (v) => v === 1 || v === true || v === '1';

const shapeOrder = (row) => {
    const order = { ...row };
    for (const key of ['pay_open', 'confirm_overdue', 'not_delivered_eligible', 'paid_after_cancel_open', 'stale']) {
        order[key] = toBool(order[key]);
    }
    return order;
};

const getOrderForViewer = async (user, orderId) => {
    let row = await loadOrder(orderId);
    if (!row) throw new HttpError(404, 'Order not found');

    // Lazily expire an order whose window has passed, so whoever opens it sees the truth even if
    // the background sweep hasn't run yet.
    if (row.payment_status === 'awaiting_payment' && !toBool(row.pay_open)) {
        await lifecycle.expireOrder(row.id);
        row = await loadOrder(orderId);
    }

    const order = shapeOrder(row);
    const disputes = await loadDisputes(order.id);
    const role = viewerRole(order, user, disputes);
    if (!role) throw new HttpError(404, 'Order not found');

    const claim = await loadClaim(order.id);
    const items = await query('SELECT * FROM shop_order_items WHERE order_id = ? ORDER BY id', [order.id]);
    const { actions, dispute_reasons, chat_read_only } = allowedActions(order, claim, disputes, role);

    const showPayee = role === 'buyer' && order.payment_status === 'awaiting_payment' && order.shop_status === 'approved';

    const response = {
        id: order.id,
        order_number: order.order_number,
        checkout_id: order.checkout_id,
        shop_id: order.shop_id,
        shop_name: order.shop_name,
        shop_status: order.shop_status,
        customer_user_id: order.customer_user_id,
        customer_username: role === 'buyer' ? undefined : order.customer_username,
        owner_user_id: order.owner_user_id,
        status: order.status,
        payment_status: order.payment_status,
        payment_method: order.payment_method,
        subtotal_paise: order.subtotal_paise,
        shipping_paise: order.shipping_paise,
        total_paise: order.total_paise,
        notes: order.notes,
        created_at: order.created_at,
        updated_at: order.updated_at,
        pay_by: order.pay_by,
        pay_seconds_left: order.payment_status === 'awaiting_payment' ? order.pay_seconds_left : null,
        confirm_by: order.confirm_by,
        confirm_seconds_left: order.payment_status === 'claimed' ? order.confirm_seconds_left : null,
        confirmed_at: order.confirmed_at,
        cancelled_at: order.cancelled_at,
        cancelled_by: order.cancelled_by,
        cancel_reason: order.cancel_reason,
        // Delivery address, copied onto the order when it was placed.
        full_name: order.ship_full_name,
        phone: order.ship_phone,
        line1: order.ship_line1,
        line2: order.ship_line2,
        city: order.ship_city,
        state: order.ship_state,
        pincode: order.ship_pincode,
        items,
        claim: claim
            ? {
                  utr: claim.utr,
                  amount_paise: claim.amount_paise,
                  claimed_at: claim.claimed_at,
                  updated_at: claim.updated_at,
                  refund_utr: claim.refund_utr,
                  refunded_at: claim.refunded_at,
              }
            : null,
        disputes,
        viewer_role: role,
        allowed_actions: actions,
        dispute_reasons,
        chat_read_only,
        payee: showPayee
            ? { upi_id: order.payee_upi_id, name: order.payee_name, upi_link: upiLink(order) }
            : null,
    };
    return response;
};

const attachItems = async (orders) => {
    if (orders.length === 0) return orders;
    const ids = orders.map((o) => o.id);
    const items = await query(`SELECT * FROM shop_order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids);
    return orders.map((order) => ({ ...order, items: items.filter((item) => item.order_id === order.id) }));
};

const LIST_COLUMNS = `o.id, o.order_number, o.checkout_id, o.shop_id, o.status, o.payment_status, o.payment_method,
    o.total_paise, o.created_at, o.updated_at, o.pay_by, o.confirm_by,
    TIMESTAMPDIFF(SECOND, NOW(), o.pay_by) AS pay_seconds_left`;

const listBuyerOrders = async (user) => {
    const orders = await query(
        `SELECT ${LIST_COLUMNS}, s.name AS shop_name
         FROM shop_orders o JOIN shops s ON s.id = o.shop_id
         WHERE o.customer_user_id = ? ORDER BY o.created_at DESC, o.id DESC LIMIT 200`,
        [user.id]
    );
    return attachItems(
        orders.map((o) => ({ ...o, needs_action: o.payment_status === 'awaiting_payment' && o.pay_seconds_left > 0 }))
    );
};

const sellerNeedsAction = (o) =>
    ['claimed', 'refund_due'].includes(o.payment_status) ||
    (['confirmed', 'cod_pending'].includes(o.payment_status) && ['placed', 'accepted', 'packed', 'shipped'].includes(o.status));

const listSellerOrders = async (shop) => {
    const orders = await query(
        `SELECT ${LIST_COLUMNS}, u.username AS customer_username
         FROM shop_orders o JOIN users u ON u.id = o.customer_user_id
         WHERE o.shop_id = ? ORDER BY o.created_at DESC, o.id DESC LIMIT 500`,
        [shop.id]
    );
    return attachItems(orders.map((o) => ({ ...o, needs_action: sellerNeedsAction(o) })));
};

const actionCounts = async (user) => {
    const buyer = await queryOne(
        "SELECT COUNT(*) AS count FROM shop_orders WHERE customer_user_id = ? AND payment_status = 'awaiting_payment' AND pay_by > NOW()",
        [user.id]
    );
    const shop = await queryOne('SELECT id FROM shops WHERE owner_user_id = ?', [user.id]);
    let seller = 0;
    if (shop) {
        const row = await queryOne(
            `SELECT COUNT(*) AS count FROM shop_orders WHERE shop_id = ? AND (
                payment_status IN ('claimed', 'refund_due')
                OR (payment_status IN ('confirmed', 'cod_pending') AND status IN ('placed', 'accepted', 'packed', 'shipped')))`,
            [shop.id]
        );
        seller = row.count;
    }
    let admin = 0;
    if (user.role === 'admin') {
        admin = (await queryOne("SELECT COUNT(*) AS count FROM shop_disputes WHERE status = 'open'")).count;
    }
    return { buyer: buyer.count, seller, admin_disputes: admin, total: buyer.count + seller + admin };
};

const getCheckoutForBuyer = async (user, checkoutId) => {
    const checkout = await queryOne('SELECT id, user_id, created_at FROM shop_checkouts WHERE id = ?', [checkoutId]);
    if (!checkout || checkout.user_id !== user.id) throw new HttpError(404, 'Checkout not found');
    const orders = await query(
        `SELECT ${LIST_COLUMNS}, s.name AS shop_name
         FROM shop_orders o JOIN shops s ON s.id = o.shop_id WHERE o.checkout_id = ? ORDER BY o.id`,
        [checkoutId]
    );
    return { id: checkout.id, created_at: checkout.created_at, orders };
};

// ---- chat ----

const chatAccess = async (user, orderId) => {
    const row = await loadOrder(orderId);
    if (!row) throw new HttpError(404, 'Order not found');
    const order = shapeOrder(row);
    const disputes = await loadDisputes(order.id);
    const role = viewerRole(order, user, disputes);
    const allowed = role === 'buyer' || role === 'seller' || (role === 'admin' && disputes.length > 0);
    if (!allowed) throw new HttpError(404, 'Order not found');
    return { order, role, readOnly: isTerminal(order) && order.stale };
};

const listMessages = async (user, orderId, afterId) => {
    const { order, readOnly } = await chatAccess(user, orderId);
    const after = Number.isInteger(afterId) && afterId > 0 ? afterId : 0;
    const messages = await query(
        `SELECT m.id, m.sender_role, m.sender_user_id, u.username AS sender_username, m.body, m.created_at
         FROM shop_order_messages m LEFT JOIN users u ON u.id = m.sender_user_id
         WHERE m.order_id = ? AND m.id > ? ORDER BY m.id LIMIT 200`,
        [order.id, after]
    );
    return { messages, read_only: readOnly };
};

const postMessage = async (user, orderId, body) => {
    const { order, role, readOnly } = await chatAccess(user, orderId);
    if (readOnly) throw new HttpError(409, 'This conversation is closed');
    const text = String(body || '').replace(/<[^>]*>/g, '').trim();
    if (!text) throw new HttpError(400, 'Message cannot be empty');
    if (text.length > 1000) throw new HttpError(400, 'Message is too long (max 1000 characters)');
    const result = await query(
        'INSERT INTO shop_order_messages (order_id, sender_user_id, sender_role, body) VALUES (?, ?, ?, ?)',
        [order.id, user.id, role, text]
    );
    return queryOne(
        `SELECT m.id, m.sender_role, m.sender_user_id, u.username AS sender_username, m.body, m.created_at
         FROM shop_order_messages m LEFT JOIN users u ON u.id = m.sender_user_id WHERE m.id = ?`,
        [result.insertId]
    );
};

// ---- evidence (payment screenshots etc.) ----

const listEvidence = async (user, orderId) => {
    await chatAccess(user, orderId);
    const rows = await query(
        `SELECT e.id, e.kind, e.created_at, e.uploader_user_id, u.username AS uploader_username, e.public_id, e.format
         FROM shop_order_evidence e JOIN users u ON u.id = e.uploader_user_id
         WHERE e.order_id = ? ORDER BY e.id`,
        [orderId]
    );
    return rows.map(({ public_id, format, ...rest }) => ({ ...rest, url: privateImageUrl(public_id, format) }));
};

const addEvidence = async (user, orderId, { kind, uploaded }) => {
    const row = await loadOrder(orderId);
    if (!row) throw new HttpError(404, 'Order not found');
    const order = shapeOrder(row);
    const disputes = await loadDisputes(order.id);
    const role = viewerRole(order, user, disputes);
    if (role !== 'buyer' && role !== 'seller') throw new HttpError(404, 'Order not found');
    const hasOpenDispute = disputes.some((d) => d.status === 'open');
    if (isTerminal(order) && !hasOpenDispute) throw new HttpError(409, 'This order is closed');
    const allowedKinds = role === 'buyer' ? ['payment_proof', 'other'] : ['refund_proof', 'other'];
    const finalKind = allowedKinds.includes(kind) ? kind : 'other';
    const result = await query(
        'INSERT INTO shop_order_evidence (order_id, uploader_user_id, kind, public_id, format) VALUES (?, ?, ?, ?, ?)',
        [order.id, user.id, finalKind, uploaded.public_id, uploaded.format]
    );
    await query("INSERT INTO shop_order_messages (order_id, sender_user_id, sender_role, body) VALUES (?, NULL, 'system', ?)", [
        order.id,
        `${role === 'buyer' ? 'Buyer' : 'Seller'} uploaded ${finalKind === 'payment_proof' ? 'a payment screenshot' : finalKind === 'refund_proof' ? 'a refund screenshot' : 'a file'}.`,
    ]);
    return { id: result.insertId, kind: finalKind };
};

// ---- admin ----

const listDisputesForAdmin = async (status) => {
    const filters = [];
    const params = [];
    if (status === 'open' || status === 'resolved') {
        filters.push('d.status = ?');
        params.push(status);
    }
    return query(
        `SELECT d.id, d.order_id, d.reason, d.status, d.origin_payment_status, d.opened_by_role, d.description,
                d.resolution, d.resolution_note, d.opened_at, d.resolved_at,
                o.order_number, o.total_paise, o.payment_status, o.status AS order_status,
                s.name AS shop_name, bu.username AS buyer_username, su.username AS seller_username
         FROM shop_disputes d
         JOIN shop_orders o ON o.id = d.order_id
         JOIN shops s ON s.id = o.shop_id
         JOIN users bu ON bu.id = o.customer_user_id
         JOIN users su ON su.id = s.owner_user_id
         ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
         ORDER BY d.status = 'open' DESC, d.opened_at DESC LIMIT 500`,
        params
    );
};

module.exports = {
    getOrderForViewer,
    listBuyerOrders,
    listSellerOrders,
    actionCounts,
    getCheckoutForBuyer,
    listMessages,
    postMessage,
    listEvidence,
    addEvidence,
    listDisputesForAdmin,
    allowedActions,
    isTerminal,
    upiLink,
};
