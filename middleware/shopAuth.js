// middleware/shopAuth.js - Shop-module-specific authorization helpers
const { queryOne } = require('../config/database');

// Loads the caller's shop (any status) onto req.shop. Any authenticated user may have at most
// one shop. Used by routes that manage "my shop" (apply, edit, add products, view orders).
const attachOwnShop = async (req, res, next) => {
    try {
        const shop = await queryOne('SELECT * FROM shops WHERE owner_user_id = ?', [req.user.id]);
        req.shop = shop || null;
        next();
    } catch (error) {
        console.error('attachOwnShop error:', error);
        res.status(500).json({ success: false, message: 'Failed to load shop' });
    }
};

// Requires the caller to own an APPROVED shop. Used by product/order-management routes.
const requireApprovedShop = async (req, res, next) => {
    try {
        const shop = await queryOne('SELECT * FROM shops WHERE owner_user_id = ?', [req.user.id]);

        if (!shop) {
            return res.status(403).json({
                success: false,
                message: 'You do not have a shop yet. Apply to become a shop owner first.',
            });
        }

        if (shop.status !== 'approved') {
            return res.status(403).json({
                success: false,
                message: `Your shop is ${shop.status}. Only approved shops can manage products and orders.`,
            });
        }

        req.shop = shop;
        next();
    } catch (error) {
        console.error('requireApprovedShop error:', error);
        res.status(500).json({ success: false, message: 'Failed to verify shop access' });
    }
};

module.exports = { attachOwnShop, requireApprovedShop };
