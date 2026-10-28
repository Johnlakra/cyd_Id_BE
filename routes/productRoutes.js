// routes/productRoutes.js - Product catalog
const express = require('express');
const router = express.Router();

const productController = require('../controllers/productController');
const { authenticateToken } = require('../middleware/auth');
const { requireApprovedShop } = require('../middleware/shopAuth');
const { validateProduct, validateProductQuery } = require('../middleware/shopValidation');

// IMPORTANT: /mine must be registered before /:id so it isn't swallowed by the :id param route.
router.get('/mine', [authenticateToken, requireApprovedShop], productController.listMyProducts);

router.get('/', [authenticateToken, validateProductQuery], productController.listProducts);
router.get('/:id', authenticateToken, productController.getProductById);

router.post('/', [authenticateToken, requireApprovedShop, validateProduct], productController.createProduct);
router.put('/:id', [authenticateToken, requireApprovedShop, validateProduct], productController.updateProduct);
router.delete('/:id', [authenticateToken, requireApprovedShop], productController.archiveProduct);

module.exports = router;
