// controllers/paymentController.js - Payment initiation + gateway webhooks
//
// See services/payments/youpiGateway.js for the risk notes on YouPI-PG. The short version:
// treat every webhook "success" as provisional, always verify the signature, and always
// dedupe on deliveryId before touching order state (the gateway retries deliveries, and a
// naive handler would double-credit an order on a retry).
const { query, queryOne, withTransaction } = require('../config/database');
const { getGateway } = require('../services/payments');

// POST /shop/payments/initiate - body: { order_id }
const initiatePayment = async (req, res) => {
    try {
        const { order_id } = req.body;
        const order = await queryOne('SELECT * FROM shop_orders WHERE id = ?', [order_id]);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        if (order.customer_user_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'This is not your order' });
        }
        if (order.payment_method !== 'upi') {
            return res.status(400).json({ success: false, message: 'This order does not use online payment' });
        }
        if (order.payment_status === 'paid') {
            return res.status(400).json({ success: false, message: 'This order is already paid' });
        }

        const gateway = getGateway('youpi');
        const checkout = await gateway.initiatePayment({ order });

        const existingPayment = await queryOne('SELECT * FROM shop_payments WHERE order_id = ? ORDER BY id DESC LIMIT 1', [order.id]);
        if (!existingPayment || existingPayment.status === 'failed') {
            await query(
                `INSERT INTO shop_payments (order_id, gateway, gateway_order_ref, amount_paise, status)
                 VALUES (?, ?, ?, ?, 'initiated')`,
                [order.id, gateway.name, order.order_number, order.total_paise]
            );
        }

        res.json({ success: true, message: 'Payment initiated', data: { checkout } });
    } catch (error) {
        console.error('initiatePayment error:', error);
        res.status(500).json({ success: false, message: 'Failed to initiate payment' });
    }
};

// GET /shop/payments/:orderId/status - frontend polls this while waiting for the webhook
// (YouPI's own README warns its bank-alert detection "can be wrong or delayed")
const getPaymentStatus = async (req, res) => {
    try {
        const order = await queryOne('SELECT * FROM shop_orders WHERE id = ?', [req.params.orderId]);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        if (order.customer_user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'This is not your order' });
        }

        const payment = await queryOne('SELECT * FROM shop_payments WHERE order_id = ? ORDER BY id DESC LIMIT 1', [order.id]);

        res.json({
            success: true,
            message: 'Payment status retrieved',
            data: {
                order_status: order.status,
                payment_status: order.payment_status,
                payment: payment ? { status: payment.status, utr: payment.utr, verified_at: payment.verified_at } : null,
            },
        });
    } catch (error) {
        console.error('getPaymentStatus error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve payment status' });
    }
};

// POST /shop/payments/webhook/youpi - called by the YouPI-PG server, NOT the browser.
// req.rawBody is populated by the express.json `verify` hook in server.js - the signature
// MUST be checked against those raw bytes, before relying on the parsed req.body at all.
const handleYoupiWebhook = async (req, res) => {
    try {
        const gateway = getGateway('youpi');
        const signatureHeader = req.headers['x-gateway-signature'];

        if (!gateway.verifySignature(req.rawBody, signatureHeader)) {
            console.warn('YouPI webhook signature verification failed');
            return res.status(401).json({ success: false, message: 'Invalid signature' });
        }

        const { orderId, utr, amountPaise, deliveryId } = req.body;

        if (!orderId || !deliveryId) {
            return res.status(400).json({ success: false, message: 'Malformed webhook payload' });
        }

        // Dedupe: the gateway retries deliveries with the same deliveryId - a retry we already
        // processed must be acknowledged without being applied twice.
        const alreadyProcessed = await queryOne('SELECT id FROM shop_payments WHERE delivery_id = ?', [deliveryId]);
        if (alreadyProcessed) {
            return res.json({ success: true, message: 'Already processed' });
        }

        const payment = await queryOne(
            "SELECT * FROM shop_payments WHERE gateway_order_ref = ? ORDER BY id DESC LIMIT 1",
            [orderId]
        );

        if (!payment) {
            console.warn(`YouPI webhook for unknown order ref: ${orderId}`);
            return res.status(404).json({ success: false, message: 'Order reference not recognized' });
        }

        // Amount matching is the gateway's own stated weak point ("not a complete payment
        // identity check") - if it doesn't match what we expect, record the attempt for manual
        // reconciliation but do NOT mark the order paid.
        const amountMatches = Number(amountPaise) === Number(payment.amount_paise);

        await withTransaction(async (tx) => {
            await tx.query(
                `UPDATE shop_payments SET status = ?, utr = ?, delivery_id = ?, raw_webhook_payload = ?, verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [amountMatches ? 'success' : 'failed', utr || null, deliveryId, JSON.stringify(req.body), payment.id]
            );

            if (amountMatches) {
                await tx.query(
                    "UPDATE shop_orders SET payment_status = 'paid', status = 'placed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status != 'paid'",
                    [payment.order_id]
                );
            }
        });

        if (!amountMatches) {
            console.warn(`YouPI webhook amount mismatch for order ${orderId}: expected ${payment.amount_paise}, got ${amountPaise}`);
        }

        // Always ack 2xx quickly once stored - the gateway retries on non-2xx responses.
        res.json({ success: true, message: 'Webhook processed' });
    } catch (error) {
        console.error('handleYoupiWebhook error:', error);
        res.status(500).json({ success: false, message: 'Webhook processing failed' });
    }
};

module.exports = { initiatePayment, getPaymentStatus, handleYoupiWebhook };
