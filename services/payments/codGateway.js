// services/payments/codGateway.js - "Pay on delivery" fallback, no real gateway involved
const name = 'cod';

const initiatePayment = async ({ order }) => ({
    gateway: name,
    message: 'Pay the shop owner in cash when your order is delivered.',
    amount: order.total_paise / 100,
});

// COD never receives a webhook; nothing to verify.
const verifySignature = () => true;

module.exports = { name, initiatePayment, verifySignature };
