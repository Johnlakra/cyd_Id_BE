// config/shopConfig.js - Timers and limits for the P2P payment flow (overridable via env)
const positiveInt = (value, fallback) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

module.exports = {
    // Buyer must pay the seller and submit a UTR within this window, or the order is cancelled
    // and its stock released.
    payWindowMinutes: positiveInt(process.env.PAY_WINDOW_MINUTES, 30),
    // Silent extra time before expiry actually runs, so a buyer who pays at minute 29 isn't
    // cancelled while typing their UTR.
    payGraceMinutes: positiveInt(process.env.PAY_GRACE_MINUTES, 10),
    // Seller has this long to confirm receipt before the buyer may open a dispute.
    confirmWindowMinutes: positiveInt(process.env.CONFIRM_WINDOW_HOURS, 24) * 60,
    // After a seller reports "not received", the buyer has this long to upload proof before the
    // claim is rejected automatically.
    disputeProofWindowMinutes: positiveInt(process.env.DISPUTE_PROOF_HOURS, 24) * 60,
    notDeliveredAfterDays: 7,
    refundDisputeDays: 7,
    paidAfterCancelHours: 48,
    chatReadOnlyAfterDays: 14,
    maxOpenUpiOrdersPerBuyer: positiveInt(process.env.MAX_OPEN_UPI_ORDERS, 3),
    maxCheckoutLines: 50,
    maxLineQuantity: 99,
};
