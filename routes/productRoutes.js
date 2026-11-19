// routes/productRoutes.js - Product catalog
const express = require('express');
const router = express.Router();

const productController = require('../controllers/productController');
const { authenticateToken } = require('../middleware/auth');
const { requireApprovedShop } = require('../middleware/shopAuth');
const { validateProduct, validateProductQuery, validateProductLookup, validateIdParam } = require('../middleware/shopValidation');

// IMPORTANT: /mine and /lookup must be registered before /:id so they aren't swallowed by it.
router.get('/mine', [authenticateToken, requireApprovedShop], productController.listMyProducts);
router.post('/lookup', [authenticateToken, validateProductLookup], productController.lookupProducts);

router.get('/', [authenticateToken, validateProductQuery], productController.listProducts);
router.get('/:id', [authenticateToken, validateIdParam], productController.getProductById);

router.post('/', [authenticateToken, requireApprovedShop, validateProduct], productController.createProduct);
router.put('/:id', [authenticateToken, requireApprovedShop, validateProduct], productController.updateProduct);
router.delete('/:id', [authenticateToken, requireApprovedShop], productController.archiveProduct);

module.exports = router;
