// routes/shopRoutes.js - Shop registration/management, marketplace browsing, categories, admin moderation
const express = require('express');
const router = express.Router();

const shopController = require('../controllers/shopController');
const disputeController = require('../controllers/disputeController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { attachOwnShop } = require('../middleware/shopAuth');
const {
    validateShopApplication,
    validateShopUpdate,
    validateShopReview,
    validateIdParam,
    validateResolve,
} = require('../middleware/shopValidation');

// --- Categories ---
router.get('/categories', authenticateToken, shopController.listCategories);
router.post('/categories', [authenticateToken, requireAdmin], shopController.createCategory);

// --- My shop (any authenticated user) ---
router.post('/shops/apply', [authenticateToken, validateShopApplication], shopController.applyForShop);
router.get('/shops/mine', authenticateToken, shopController.getMyShop);
router.put('/shops/mine', [authenticateToken, attachOwnShop, validateShopUpdate], shopController.updateMyShop);

// --- Admin moderation (must come before /shops/:id to avoid route collisions) ---
router.get('/admin/shops', [authenticateToken, requireAdmin], shopController.adminListShops);
router.put('/admin/shops/:id/review', [authenticateToken, requireAdmin, validateIdParam, validateShopReview], shopController.adminReviewShop);
router.get('/admin/disputes', [authenticateToken, requireAdmin], disputeController.listDisputes);
router.post('/admin/disputes/:id/resolve', [authenticateToken, requireAdmin, validateIdParam, validateResolve], disputeController.resolveDispute);

// --- Marketplace browsing ---
router.get('/shops', authenticateToken, shopController.listShops);
router.get('/shops/:id', authenticateToken, shopController.getShopById);

module.exports = router;
