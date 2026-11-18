// controllers/checkoutController.js - Places a whole cart (one order per shop) in one transaction.
const lifecycle = require('../services/orderLifecycle');
const queries = require('../services/orderQueries');
const config = require('../config/shopConfig');
const { sendError } = require('../utils/httpError');

const createCheckout = async (req, res) => {
    try {
        // Release stock held by expired orders before checking availability.
        await lifecycle.maybeSweep();
        const result = await lifecycle.createCheckout(req.user, req.body, req.get('Idempotency-Key'));
        res.status(result.replayed ? 200 : 201).json({
            success: true,
            message: result.replayed ? 'This checkout was already placed' : 'Order placed',
            data: result,
        });
    } catch (error) {
        sendError(res, error, 'createCheckout');
    }
};

const getCheckout = async (req, res) => {
    try {
        const checkout = await queries.getCheckoutForBuyer(req.user, Number(req.params.id));
        res.json({ success: true, message: 'Checkout retrieved', data: { checkout } });
    } catch (error) {
        sendError(res, error, 'getCheckout');
    }
};

const getConfig = (req, res) => {
    res.json({
        success: true,
        message: 'Shop configuration',
        data: {
            payment_methods: ['upi', 'cod'],
            pay_window_minutes: config.payWindowMinutes,
            confirm_window_hours: config.confirmWindowMinutes / 60,
            max_open_upi_orders: config.maxOpenUpiOrdersPerBuyer,
        },
    });
};

module.exports = { createCheckout, getCheckout, getConfig };
