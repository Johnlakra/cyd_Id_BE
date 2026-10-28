// controllers/productController.js - Product catalog CRUD and marketplace browsing
const { query, queryOne } = require('../config/database');
const { uniqueSlug, rupeesToPaise } = require('../utils/shopHelpers');
const { saveBase64Image } = require('../utils/fileUpload');

const attachImages = async (products) => {
    if (products.length === 0) return products;
    const ids = products.map((p) => p.id);
    const images = await query(
        `SELECT * FROM shop_product_images WHERE product_id IN (${ids.map(() => '?').join(',')}) ORDER BY sort_order ASC`,
        ids
    );
    return products.map((product) => ({
        ...product,
        images: images.filter((img) => img.product_id === product.id),
    }));
};

// POST /shop/products - shop owner creates a product (requires approved shop, via requireApprovedShop)
const createProduct = async (req, res) => {
    try {
        const { title, description, price, compare_at_price, stock_quantity, sku, category_id, status, images } = req.body;
        const slug = uniqueSlug(title);

        const result = await query(
            `INSERT INTO shop_products (shop_id, category_id, title, slug, description, price_paise, compare_at_price_paise, stock_quantity, sku, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.shop.id,
                category_id || null,
                title,
                slug,
                description || null,
                rupeesToPaise(price),
                compare_at_price ? rupeesToPaise(compare_at_price) : null,
                stock_quantity,
                sku || null,
                status || 'active',
            ]
        );

        const productId = result.insertId;

        if (Array.isArray(images) && images.length > 0) {
            for (let i = 0; i < images.length; i++) {
                const imageUrl = await saveBase64Image(images[i]);
                await query(
                    'INSERT INTO shop_product_images (product_id, image_url, sort_order, is_primary) VALUES (?, ?, ?, ?)',
                    [productId, imageUrl, i, i === 0 ? 1 : 0]
                );
            }
        }

        const [product] = await attachImages([await queryOne('SELECT * FROM shop_products WHERE id = ?', [productId])]);

        res.status(201).json({ success: true, message: 'Product created successfully', data: { product } });
    } catch (error) {
        console.error('createProduct error:', error);
        res.status(500).json({ success: false, message: 'Failed to create product' });
    }
};

// PUT /shop/products/:id - shop owner updates their own product
const updateProduct = async (req, res) => {
    try {
        const product = await queryOne('SELECT * FROM shop_products WHERE id = ?', [req.params.id]);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        if (product.shop_id !== req.shop.id) {
            return res.status(403).json({ success: false, message: 'You do not own this product' });
        }

        const { title, description, price, compare_at_price, stock_quantity, sku, category_id, status, images } = req.body;
        const updates = [];
        const values = [];

        if (title) { updates.push('title = ?'); values.push(title); }
        if (description !== undefined) { updates.push('description = ?'); values.push(description); }
        if (price !== undefined) { updates.push('price_paise = ?'); values.push(rupeesToPaise(price)); }
        if (compare_at_price !== undefined) {
            updates.push('compare_at_price_paise = ?');
            values.push(compare_at_price ? rupeesToPaise(compare_at_price) : null);
        }
        if (stock_quantity !== undefined) { updates.push('stock_quantity = ?'); values.push(stock_quantity); }
        if (sku !== undefined) { updates.push('sku = ?'); values.push(sku); }
        if (category_id !== undefined) { updates.push('category_id = ?'); values.push(category_id); }
        if (status) { updates.push('status = ?'); values.push(status); }

        if (updates.length > 0) {
            values.push(req.params.id);
            await query(`UPDATE shop_products SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
        }

        if (Array.isArray(images) && images.length > 0) {
            await query('DELETE FROM shop_product_images WHERE product_id = ?', [req.params.id]);
            for (let i = 0; i < images.length; i++) {
                const imageUrl = images[i].startsWith('http') ? images[i] : await saveBase64Image(images[i]);
                await query(
                    'INSERT INTO shop_product_images (product_id, image_url, sort_order, is_primary) VALUES (?, ?, ?, ?)',
                    [req.params.id, imageUrl, i, i === 0 ? 1 : 0]
                );
            }
        }

        const [updated] = await attachImages([await queryOne('SELECT * FROM shop_products WHERE id = ?', [req.params.id])]);
        res.json({ success: true, message: 'Product updated successfully', data: { product: updated } });
    } catch (error) {
        console.error('updateProduct error:', error);
        res.status(500).json({ success: false, message: 'Failed to update product' });
    }
};

// DELETE /shop/products/:id - shop owner archives (soft-removes) their own product
const archiveProduct = async (req, res) => {
    try {
        const product = await queryOne('SELECT * FROM shop_products WHERE id = ?', [req.params.id]);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        if (product.shop_id !== req.shop.id) {
            return res.status(403).json({ success: false, message: 'You do not own this product' });
        }

        await query("UPDATE shop_products SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
        res.json({ success: true, message: 'Product archived successfully' });
    } catch (error) {
        console.error('archiveProduct error:', error);
        res.status(500).json({ success: false, message: 'Failed to archive product' });
    }
};

// GET /shop/products - marketplace browse: active products across all approved shops
const listProducts = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const filters = ["p.status = 'active'", "s.status = 'approved'"];
        const values = [];

        if (req.query.category_id) {
            filters.push('p.category_id = ?');
            values.push(req.query.category_id);
        }
        if (req.query.shop_id) {
            filters.push('p.shop_id = ?');
            values.push(req.query.shop_id);
        }
        if (req.query.q) {
            filters.push('(p.title LIKE ? OR p.description LIKE ?)');
            values.push(`%${req.query.q}%`, `%${req.query.q}%`);
        }

        const whereClause = `WHERE ${filters.join(' AND ')}`;

        const totalResult = await query(
            `SELECT COUNT(*) as total FROM shop_products p JOIN shops s ON s.id = p.shop_id ${whereClause}`,
            values
        );
        const total = totalResult[0].total;

        const products = await query(
            `SELECT p.*, s.name as shop_name, s.slug as shop_slug
             FROM shop_products p
             JOIN shops s ON s.id = p.shop_id
             ${whereClause}
             ORDER BY p.created_at DESC
             LIMIT ${limit} OFFSET ${offset}`,
            values
        );

        const withImages = await attachImages(products);

        res.json({
            success: true,
            message: 'Products retrieved successfully',
            data: {
                products: withImages,
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
        console.error('listProducts error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve products' });
    }
};

// GET /shop/products/mine - shop owner's own products, any status
const listMyProducts = async (req, res) => {
    try {
        const products = await query('SELECT * FROM shop_products WHERE shop_id = ? ORDER BY created_at DESC', [req.shop.id]);
        const withImages = await attachImages(products);
        res.json({ success: true, message: 'Your products retrieved successfully', data: { products: withImages } });
    } catch (error) {
        console.error('listMyProducts error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve your products' });
    }
};

// GET /shop/products/:id - product detail page
const getProductById = async (req, res) => {
    try {
        const product = await queryOne(
            `SELECT p.*, s.name as shop_name, s.slug as shop_slug, s.id as shop_id
             FROM shop_products p JOIN shops s ON s.id = p.shop_id WHERE p.id = ?`,
            [req.params.id]
        );

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        await query('UPDATE shop_products SET views_count = views_count + 1 WHERE id = ?', [req.params.id]);

        const [withImages] = await attachImages([product]);
        res.json({ success: true, message: 'Product retrieved successfully', data: { product: withImages } });
    } catch (error) {
        console.error('getProductById error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve product' });
    }
};

module.exports = {
    createProduct,
    updateProduct,
    archiveProduct,
    listProducts,
    listMyProducts,
    getProductById,
};
