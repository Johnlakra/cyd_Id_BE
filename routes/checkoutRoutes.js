// routes/checkoutRoutes.js - Checkout (whole cart, one order per shop) and shop-wide config.
const express = require('express');
const router = express.Router();

const c = require('../controllers/checkoutController');
const { authenticateToken } = require('../middleware/auth');
const { validateCheckout, validateIdParam } = require('../middleware/shopValidation');

router.get('/config', authenticateToken, c.getConfig);
router.post('/checkout', [authenticateToken, validateCheckout], c.createCheckout);
router.get('/checkouts/:id', [authenticateToken, validateIdParam], c.getCheckout);

module.exports = router;
