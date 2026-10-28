// controllers/shopController.js - Shop registration, management, and marketplace browsing
const { query, queryOne } = require('../config/database');
const { uniqueSlug } = require('../utils/shopHelpers');
const { saveBase64Image } = require('../utils/fileUpload');

// POST /shop/shops/apply - any authenticated user applies to become a shop owner
const applyForShop = async (req, res) => {
    try {
        const existing = await queryOne('SELECT id, status FROM shops WHERE owner_user_id = ?', [req.user.id]);
        if (existing) {
            return res.status(400).json({
                success: false,
                message: `You already have a shop application (status: ${existing.status}).`,
            });
        }

        const { name, description, parish, deanery, contact_phone, upi_id, logo } = req.body;
        const slug = uniqueSlug(name);

        let logoUrl = null;
        if (logo) {
            logoUrl = await saveBase64Image(logo);
        }

        const result = await query(
            `INSERT INTO shops (owner_user_id, name, slug, description, parish, deanery, contact_phone, upi_id, logo_url, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [req.user.id, name, slug, description || null, parish || null, deanery || null, contact_phone, upi_id || null, logoUrl]
        );

        const shop = await queryOne('SELECT * FROM shops WHERE id = ?', [result.insertId]);

        res.status(201).json({
            success: true,
            message: 'Shop application submitted. An admin will review it shortly.',
            data: { shop },
        });
    } catch (error) {
        console.error('applyForShop error:', error);
        res.status(500).json({ success: false, message: 'Failed to submit shop application' });
    }
};

// GET /shop/shops/mine - the caller's own shop, whatever its status
const getMyShop = async (req, res) => {
    try {
        const shop = await queryOne('SELECT * FROM shops WHERE owner_user_id = ?', [req.user.id]);
        res.json({ success: true, message: 'Shop retrieved', data: { shop: shop || null } });
    } catch (error) {
        console.error('getMyShop error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve shop' });
    }
};

// PUT /shop/shops/mine - update own shop profile (requires an existing application, any status
// except 'approved' is still editable; approved shops can still edit non-sensitive fields)
const updateMyShop = async (req, res) => {
    try {
        const shop = req.shop; // loaded by attachOwnShop middleware
        if (!shop) {
            return res.status(404).json({ success: false, message: 'You do not have a shop yet' });
        }

        const { name, description, parish, deanery, contact_phone, upi_id, logo, banner } = req.body;
        const updates = [];
        const values = [];

        if (name) { updates.push('name = ?'); values.push(name); }
        if (description !== undefined) { updates.push('description = ?'); values.push(description); }
        if (parish !== undefined) { updates.push('parish = ?'); values.push(parish); }
        if (deanery !== undefined) { updates.push('deanery = ?'); values.push(deanery); }
        if (contact_phone) { updates.push('contact_phone = ?'); values.push(contact_phone); }
        if (upi_id !== undefined) { updates.push('upi_id = ?'); values.push(upi_id); }

        if (logo) {
            const logoUrl = await saveBase64Image(logo);
            updates.push('logo_url = ?');
            values.push(logoUrl);
        }
        if (banner) {
            const bannerUrl = await saveBase64Image(banner);
            updates.push('banner_url = ?');
            values.push(bannerUrl);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        values.push(shop.id);
        await query(`UPDATE shops SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);

        const updated = await queryOne('SELECT * FROM shops WHERE id = ?', [shop.id]);
        res.json({ success: true, message: 'Shop updated successfully', data: { shop: updated } });
    } catch (error) {
        console.error('updateMyShop error:', error);
        res.status(500).json({ success: false, message: 'Failed to update shop' });
    }
};

// GET /shop/shops - marketplace: browse approved shops
const listShops = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const filters = ["status = 'approved'"];
        const values = [];

        if (req.query.parish) {
            filters.push('parish = ?');
            values.push(req.query.parish);
        }
        if (req.query.deanery) {
            filters.push('deanery = ?');
            values.push(req.query.deanery);
        }
        if (req.query.q) {
            filters.push('name LIKE ?');
            values.push(`%${req.query.q}%`);
        }

        const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

        const totalResult = await query(`SELECT COUNT(*) as total FROM shops ${whereClause}`, values);
        const total = totalResult[0].total;

        const shops = await query(
            `SELECT id, name, slug, description, logo_url, banner_url, parish, deanery, created_at
             FROM shops ${whereClause}
             ORDER BY created_at DESC
             LIMIT ${limit} OFFSET ${offset}`,
            values
        );

        res.json({
            success: true,
            message: 'Shops retrieved successfully',
            data: {
                shops,
                pagination: {
                    current_page: page,
                    per_page: limit,
                    total,
                    total_pages: Math.ceil(total / limit),
                    has_next: page < Math.ceil(total / limit),
                    has_prev: page > 1,
                },
            },
        });
    } catch (error) {
        console.error('listShops error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve shops' });
    }
};

// GET /shop/shops/:id - storefront view (public within the app, any logged-in user)
const getShopById = async (req, res) => {
    try {
        const shop = await queryOne(
            "SELECT id, name, slug, description, logo_url, banner_url, parish, deanery, status, created_at FROM shops WHERE id = ?",
            [req.params.id]
        );

        if (!shop || shop.status !== 'approved') {
            return res.status(404).json({ success: false, message: 'Shop not found' });
        }

        res.json({ success: true, message: 'Shop retrieved successfully', data: { shop } });
    } catch (error) {
        console.error('getShopById error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve shop' });
    }
};

// --- Admin moderation ---

// GET /shop/admin/shops - list shop applications, filterable by status
const adminListShops = async (req, res) => {
    try {
        const status = req.query.status;
        const filters = [];
        const values = [];
        if (status) {
            filters.push('s.status = ?');
            values.push(status);
        }
        const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

        const shops = await query(
            `SELECT s.*, u.username as owner_username, u.email as owner_email
             FROM shops s
             JOIN users u ON u.id = s.owner_user_id
             ${whereClause}
             ORDER BY s.created_at DESC`,
            values
        );

        res.json({ success: true, message: 'Shop applications retrieved', data: { shops } });
    } catch (error) {
        console.error('adminListShops error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve shop applications' });
    }
};

// PUT /shop/admin/shops/:id/review - approve/reject/suspend a shop
const adminReviewShop = async (req, res) => {
    try {
        const { status, rejection_reason } = req.body;
        const shop = await queryOne('SELECT * FROM shops WHERE id = ?', [req.params.id]);

        if (!shop) {
            return res.status(404).json({ success: false, message: 'Shop not found' });
        }

        await query(
            `UPDATE shops SET status = ?, rejection_reason = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [status, status === 'rejected' ? (rejection_reason || null) : null, req.user.id, req.params.id]
        );

        const updated = await queryOne('SELECT * FROM shops WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: `Shop ${status}`, data: { shop: updated } });
    } catch (error) {
        console.error('adminReviewShop error:', error);
        res.status(500).json({ success: false, message: 'Failed to review shop' });
    }
};

// GET /shop/categories - list active categories
const listCategories = async (req, res) => {
    try {
        const categories = await query(
            'SELECT * FROM shop_categories WHERE status = 1 ORDER BY sort_order ASC, name ASC'
        );
        res.json({ success: true, message: 'Categories retrieved successfully', data: { categories } });
    } catch (error) {
        console.error('listCategories error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve categories' });
    }
};

// POST /shop/categories - admin-only: add a category
const createCategory = async (req, res) => {
    try {
        const { name, icon, sort_order } = req.body;
        if (!name) {
            return res.status(400).json({ success: false, message: 'Category name is required' });
        }
        const slug = uniqueSlug(name);
        const result = await query(
            'INSERT INTO shop_categories (name, slug, icon, sort_order) VALUES (?, ?, ?, ?)',
            [name, slug, icon || null, sort_order || 0]
        );
        const category = await queryOne('SELECT * FROM shop_categories WHERE id = ?', [result.insertId]);
        res.status(201).json({ success: true, message: 'Category created', data: { category } });
    } catch (error) {
        console.error('createCategory error:', error);
        res.status(500).json({ success: false, message: 'Failed to create category' });
    }
};

module.exports = {
    applyForShop,
    getMyShop,
    updateMyShop,
    listShops,
    getShopById,
    adminListShops,
    adminReviewShop,
    listCategories,
    createCategory,
};
