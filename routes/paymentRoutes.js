// routes/paymentRoutes.js - Payment initiation + gateway webhook
const express = require('express');
const router = express.Router();

const paymentController = require('../controllers/paymentController');
const { authenticateToken } = require('../middleware/auth');

router.post('/initiate', authenticateToken, paymentController.initiatePayment);
router.get('/:orderId/status', authenticateToken, paymentController.getPaymentStatus);

// Called by the YouPI-PG server itself, NOT a logged-in browser - no authenticateToken here.
// Authenticity instead comes from the HMAC signature verified inside the handler using the raw
// request body captured in server.js.
router.post('/webhook/youpi', paymentController.handleYoupiWebhook);

module.exports = router;
