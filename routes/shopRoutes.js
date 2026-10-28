// routes/shopRoutes.js - Shop registration/management, marketplace browsing, categories, admin moderation
const express = require('express');
const router = express.Router();

const shopController = require('../controllers/shopController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { attachOwnShop } = require('../middleware/shopAuth');
const { validateShopApplication, validateShopReview } = require('../middleware/shopValidation');

// --- Categories ---
router.get('/categories', authenticateToken, shopController.listCategories);
router.post('/categories', [authenticateToken, requireAdmin], shopController.createCategory);

// --- My shop (any authenticated user) ---
router.post('/shops/apply', [authenticateToken, validateShopApplication], shopController.applyForShop);
router.get('/shops/mine', authenticateToken, shopController.getMyShop);
router.put('/shops/mine', [authenticateToken, attachOwnShop], shopController.updateMyShop);

// --- Admin moderation (must come before /shops/:id to avoid route collisions) ---
router.get('/admin/shops', [authenticateToken, requireAdmin], shopController.adminListShops);
router.put('/admin/shops/:id/review', [authenticateToken, requireAdmin, validateShopReview], shopController.adminReviewShop);

// --- Marketplace browsing ---
router.get('/shops', authenticateToken, shopController.listShops);
router.get('/shops/:id', authenticateToken, shopController.getShopById);

module.exports = router;
