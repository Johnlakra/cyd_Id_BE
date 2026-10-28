// services/payments/youpiGateway.js - Adapter for YouPI-PG (https://github.com/youpi-pg/YouPI-PG)
//
// ⚠️  IMPORTANT RISK NOTE (read before relying on this in production):
// YouPI-PG's own README states it is "not represented as a certified, bank-approved,
// NPCI-approved, audited, or production-ready payment gateway." It does not call any bank API
// to confirm payment - it detects a UPI payment by having an Android app (or a Gmail/Google
// Messages observer) read the incoming bank SMS/notification text and match the amount. The
// project's own guidance is to keep to roughly 20 payment attempts/day per receiving account,
// and it explicitly warns that "amount matching is not a complete payment identity check."
// This adapter wires it up exactly as requested, but every "success" it reports should be
// treated as provisional - reconcile the shop owner's bank statement periodically, and do not
// use it for amounts where a missed/duplicate detection would be a serious problem.
// To move to a certified gateway (Razorpay, Cashfree, etc.) later, write a new adapter with the
// same { name, initiatePayment, verifySignature } shape and switch PAYMENT_GATEWAY - no
// controller code needs to change.
const crypto = require('crypto');

const YOUPI_BASE_URL = process.env.YOUPI_BASE_URL || 'http://localhost:7000';
const YOUPI_MERCHANT_PUBLIC_KEY = process.env.YOUPI_MERCHANT_PUBLIC_KEY || '';
const YOUPI_WEBHOOK_SECRET = process.env.YOUPI_WEBHOOK_SECRET || '';

const name = 'youpi';

// YouPI's checkout is a client-side script (youpi.js) triggered by the frontend, not a
// server-to-server "create payment" call. The backend's job here is to hand the frontend the
// exact parameters that script needs, keyed to OUR order number so the webhook (see
// paymentController.handleYoupiWebhook) can be matched back to the right order.
const initiatePayment = async ({ order }) => {
    if (!YOUPI_MERCHANT_PUBLIC_KEY) {
        throw new Error('YOUPI_MERCHANT_PUBLIC_KEY is not configured');
    }
    return {
        gateway: name,
        checkoutScriptUrl: `${YOUPI_BASE_URL}/youpi.js`,
        merchantKey: YOUPI_MERCHANT_PUBLIC_KEY,
        currency: 'INR',
        orderId: order.order_number,
        amount: order.total_paise / 100,
        amountPaise: order.total_paise,
    };
};

// Per YouPI's README, the webhook signature MUST be computed over the raw, unparsed request
// bytes before any JSON parsing. `rawBody` must be a Buffer/string captured before body-parsing
// (see server.js's express.json `verify` hook).
const verifySignature = (rawBody, signatureHeader) => {
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
    if (!YOUPI_WEBHOOK_SECRET || !rawBody) return false;

    const expected = crypto
        .createHmac('sha256', YOUPI_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');
    const provided = signatureHeader.slice('sha256='.length);

    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(provided, 'hex');
    if (expectedBuf.length !== providedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
};

module.exports = { name, initiatePayment, verifySignature };
