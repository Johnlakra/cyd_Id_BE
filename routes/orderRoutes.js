// routes/orderRoutes.js - Orders: viewing, P2P payment actions, fulfilment, chat, evidence.
// Who may do what on a given order (buyer / seller / admin) is decided per order inside
// services/orderLifecycle.js, so most routes only need authentication here.
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const c = require('../controllers/orderController');
const { authenticateToken } = require('../middleware/auth');
const { requireOwnShop } = require('../middleware/shopAuth');
const v = require('../middleware/shopValidation');

const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `chat|${req.user.id}`,
    message: { success: false, message: 'You are sending messages too quickly. Please wait a minute.' },
});

// Static paths first, so they aren't captured by /:id.
router.get('/shop', [authenticateToken, requireOwnShop(['approved', 'suspended'])], c.listShopOrders);
router.get('/action-count', authenticateToken, c.actionCount);
router.get('/', authenticateToken, c.listMyOrders);

router.get('/:id', [authenticateToken, v.validateIdParam], c.getOrder);

// Buyer
router.post('/:id/payment-claim', [authenticateToken, v.validateIdParam, v.validateClaim], c.claimPayment);
router.patch('/:id/payment-claim', [authenticateToken, v.validateIdParam, v.validateConfirm], c.editClaim);
router.put('/:id/cancel', [authenticateToken, v.validateIdParam], c.cancelOrder);

// Seller
router.post('/:id/payment-confirm', [authenticateToken, v.validateIdParam, v.validateConfirm], c.confirmPayment);
router.post('/:id/payment-not-received', [authenticateToken, v.validateIdParam], c.reportNotReceived);
router.post('/:id/refund', [authenticateToken, v.validateIdParam, v.validateRefund], c.markRefunded);
router.put('/:id/status', [authenticateToken, v.validateIdParam, v.validateOrderStatusUpdate], c.updateOrderStatus);

// Either party
router.post('/:id/dispute', [authenticateToken, v.validateIdParam, v.validateDispute], c.openDispute);
router.get('/:id/messages', [authenticateToken, v.validateIdParam], c.listMessages);
router.post('/:id/messages', [authenticateToken, chatLimiter, v.validateIdParam, v.validateMessage], c.postMessage);
router.get('/:id/evidence', [authenticateToken, v.validateIdParam], c.listEvidence);
router.post('/:id/evidence', [authenticateToken, v.validateIdParam, v.validateEvidence], c.addEvidence);

module.exports = router;
