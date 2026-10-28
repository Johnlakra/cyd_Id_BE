// services/payments/index.js - Payment gateway factory
//
// Every gateway module exports the same shape: { name, initiatePayment({order}), verifySignature(rawBody, header) }.
// Controllers only ever call through this factory, never require a gateway module directly, so
// adding/switching gateways (e.g. a certified UPI provider later) is a one-line env change.
const youpiGateway = require('./youpiGateway');
const codGateway = require('./codGateway');

const GATEWAYS = {
    youpi: youpiGateway,
    cod: codGateway,
};

const getGateway = (gatewayName) => {
    const resolvedName = gatewayName || process.env.PAYMENT_GATEWAY || 'youpi';
    const gateway = GATEWAYS[resolvedName];
    if (!gateway) {
        throw new Error(`Unknown payment gateway: ${resolvedName}`);
    }
    return gateway;
};

module.exports = { getGateway, GATEWAYS };
