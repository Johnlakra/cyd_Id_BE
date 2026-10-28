// routes/orderRoutes.js - Order placement and fulfillment
const express = require('express');
const router = express.Router();

const orderController = require('../controllers/orderController');
const { authenticateToken } = require('../middleware/auth');
const { requireApprovedShop } = require('../middleware/shopAuth');
const { validateOrderPlacement, validateOrderStatusUpdate } = require('../middleware/shopValidation');

// IMPORTANT: /shop (incoming orders for MY shop) must be registered before /:id.
router.get('/shop', [authenticateToken, requireApprovedShop], orderController.listShopOrders);

router.post('/', [authenticateToken, validateOrderPlacement], orderController.placeOrder);
router.get('/', authenticateToken, orderController.listMyOrders);
router.get('/:id', authenticateToken, orderController.getOrderById);
router.put('/:id/status', [authenticateToken, requireApprovedShop, validateOrderStatusUpdate], orderController.updateOrderStatus);
router.put('/:id/cancel', authenticateToken, orderController.cancelOrder);

module.exports = router;
