// config/shopDatabase.js - Schema for the Shop (multi-vendor marketplace) module
//
// Design notes:
// - Shop ownership is NOT a `users.role` value. Any authenticated user (admin, user, or
//   profile_holder) can apply to run a shop; approval is tracked on the `shops` row itself
//   (status: pending/approved/rejected/suspended). This keeps the existing ID-card role system
//   untouched - "is a shop owner" is an additive capability, not a replacement role.
// - Money is stored in integer paise (1 rupee = 100 paise) everywhere to avoid floating point
//   rounding errors in prices/totals.
// - One order always belongs to exactly one shop. A customer's cart that spans multiple shops
//   is split into one order per shop at checkout time (same pattern Meesho/Amazon use for
//   multi-seller carts), so each shop only ever sees and manages its own orders.
const { query, queryOne } = require('./database');

const createIndexSafely = async (indexName, tableName, columns) => {
    try {
        const existingIndex = await queryOne(`
            SELECT COUNT(*) as count
            FROM information_schema.statistics
            WHERE table_schema = ?
            AND table_name = ?
            AND index_name = ?
        `, [process.env.DB_NAME, tableName, indexName]);

        if (existingIndex.count === 0) {
            await query(`CREATE INDEX ${indexName} ON ${tableName} (${columns})`);
            console.log(`✅ Created index: ${indexName}`);
        } else {
            console.log(`ℹ️  Index already exists: ${indexName}`);
        }
    } catch (error) {
        console.log(`⚠️  Could not create index ${indexName}:`, error.message);
    }
};

const initShopTables = async () => {
    console.log('Creating shops table...');
    await query(`
        CREATE TABLE IF NOT EXISTS shops (
            id INT PRIMARY KEY AUTO_INCREMENT,
            owner_user_id INT NOT NULL,
            name VARCHAR(150) NOT NULL,
            slug VARCHAR(170) UNIQUE NOT NULL,
            description TEXT,
            logo_url VARCHAR(255),
            banner_url VARCHAR(255),
            parish VARCHAR(100),
            deanery VARCHAR(100),
            contact_phone VARCHAR(20),
            upi_id VARCHAR(100),
            status ENUM('pending', 'approved', 'rejected', 'suspended') DEFAULT 'pending',
            rejection_reason TEXT,
            reviewed_by INT,
            reviewed_at TIMESTAMP NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (owner_user_id) REFERENCES users(id),
            FOREIGN KEY (reviewed_by) REFERENCES users(id)
        )
    `);

    console.log('Creating shop_categories table...');
    await query(`
        CREATE TABLE IF NOT EXISTS shop_categories (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(80) NOT NULL,
            slug VARCHAR(90) UNIQUE NOT NULL,
            icon VARCHAR(50),
            sort_order INT DEFAULT 0,
            status TINYINT DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    console.log('Creating shop_products table...');
    await query(`
        CREATE TABLE IF NOT EXISTS shop_products (
            id INT PRIMARY KEY AUTO_INCREMENT,
            shop_id INT NOT NULL,
            category_id INT,
            title VARCHAR(150) NOT NULL,
            slug VARCHAR(170) NOT NULL,
            description TEXT,
            price_paise BIGINT UNSIGNED NOT NULL,
            compare_at_price_paise BIGINT UNSIGNED,
            stock_quantity INT NOT NULL DEFAULT 0,
            sku VARCHAR(50),
            status ENUM('draft', 'active', 'out_of_stock', 'archived') DEFAULT 'draft',
            views_count INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (shop_id) REFERENCES shops(id),
            FOREIGN KEY (category_id) REFERENCES shop_categories(id)
        )
    `);

    console.log('Creating shop_product_images table...');
    await query(`
        CREATE TABLE IF NOT EXISTS shop_product_images (
            id INT PRIMARY KEY AUTO_INCREMENT,
            product_id INT NOT NULL,
            image_url VARCHAR(255) NOT NULL,
            sort_order INT DEFAULT 0,
            is_primary TINYINT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES shop_products(id) ON DELETE CASCADE
        )
    `);

    console.log('Creating shop_addresses table...');
    await query(`
        CREATE TABLE IF NOT EXISTS shop_addresses (
            id INT PRIMARY KEY AUTO_INCREMENT,
            user_id INT NOT NULL,
            label VARCHAR(50) DEFAULT 'Home',
            full_name VARCHAR(100) NOT NULL,
            phone VARCHAR(20) NOT NULL,
            line1 VARCHAR(200) NOT NULL,
            line2 VARCHAR(200),
            city VARCHAR(100) NOT NULL,
            state VARCHAR(100) NOT NULL,
            pincode VARCHAR(10) NOT NULL,
            is_default TINYINT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    console.log('Creating shop_orders table...');
    await query(`
        CREATE TABLE IF NOT EXISTS shop_orders (
            id INT PRIMARY KEY AUTO_INCREMENT,
            order_number VARCHAR(40) UNIQUE NOT NULL,
            customer_user_id INT NOT NULL,
            shop_id INT NOT NULL,
            address_id INT NOT NULL,
            subtotal_paise BIGINT UNSIGNED NOT NULL,
            shipping_paise BIGINT UNSIGNED DEFAULT 0,
            total_paise BIGINT UNSIGNED NOT NULL,
            status ENUM('pending_payment', 'placed', 'accepted', 'packed', 'shipped', 'delivered', 'cancelled', 'rejected') DEFAULT 'pending_payment',
            payment_status ENUM('pending', 'paid', 'failed', 'refunded') DEFAULT 'pending',
            payment_method ENUM('upi', 'cod') DEFAULT 'upi',
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (customer_user_id) REFERENCES users(id),
            FOREIGN KEY (shop_id) REFERENCES shops(id),
            FOREIGN KEY (address_id) REFERENCES shop_addresses(id)
        )
    `);

    console.log('Creating shop_order_items table...');
    await query(`
        CREATE TABLE IF NOT EXISTS shop_order_items (
            id INT PRIMARY KEY AUTO_INCREMENT,
            order_id INT NOT NULL,
            product_id INT NOT NULL,
            product_title_snapshot VARCHAR(150) NOT NULL,
            unit_price_paise BIGINT UNSIGNED NOT NULL,
            quantity INT NOT NULL,
            line_total_paise BIGINT UNSIGNED NOT NULL,
            FOREIGN KEY (order_id) REFERENCES shop_orders(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES shop_products(id)
        )
    `);

    console.log('Creating shop_payments table...');
    await query(`
        CREATE TABLE IF NOT EXISTS shop_payments (
            id INT PRIMARY KEY AUTO_INCREMENT,
            order_id INT NOT NULL,
            gateway VARCHAR(30) NOT NULL DEFAULT 'youpi',
            gateway_order_ref VARCHAR(100) NOT NULL,
            utr VARCHAR(50),
            amount_paise BIGINT UNSIGNED NOT NULL,
            status ENUM('initiated', 'success', 'failed') DEFAULT 'initiated',
            delivery_id VARCHAR(100),
            raw_webhook_payload JSON,
            verified_at TIMESTAMP NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES shop_orders(id),
            UNIQUE KEY uniq_delivery_id (delivery_id)
        )
    `);

    console.log('Creating shop module indexes (with error handling)...');
    await createIndexSafely('idx_shops_owner', 'shops', 'owner_user_id');
    await createIndexSafely('idx_shops_status', 'shops', 'status');
    await createIndexSafely('idx_products_shop', 'shop_products', 'shop_id');
    await createIndexSafely('idx_products_category', 'shop_products', 'category_id');
    await createIndexSafely('idx_products_status', 'shop_products', 'status');
    await createIndexSafely('idx_orders_customer', 'shop_orders', 'customer_user_id');
    await createIndexSafely('idx_orders_shop', 'shop_orders', 'shop_id');
    await createIndexSafely('idx_orders_status', 'shop_orders', 'status');
    await createIndexSafely('idx_payments_order', 'shop_payments', 'order_id');
    await createIndexSafely('idx_payments_gateway_ref', 'shop_payments', 'gateway_order_ref');
    await createIndexSafely('idx_addresses_user', 'shop_addresses', 'user_id');

    console.log('✅ Shop module tables initialized successfully');
};

const DEFAULT_CATEGORIES = [
    { name: 'Devotional Items', slug: 'devotional-items', icon: 'church' },
    { name: 'Books & Booklets', slug: 'books-booklets', icon: 'book' },
    { name: 'Apparel & Merchandise', slug: 'apparel-merchandise', icon: 'tshirt' },
    { name: 'Event Tickets', slug: 'event-tickets', icon: 'ticket' },
    { name: 'Handmade & Crafts', slug: 'handmade-crafts', icon: 'craft' },
    { name: 'Food & Snacks', slug: 'food-snacks', icon: 'food' },
    { name: 'Other', slug: 'other', icon: 'category' },
];

const seedDefaultCategories = async () => {
    const existing = await query('SELECT COUNT(*) as count FROM shop_categories');
    if (existing[0].count > 0) {
        console.log('ℹ️  Shop categories already seeded');
        return;
    }
    for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
        const cat = DEFAULT_CATEGORIES[i];
        await query(
            'INSERT INTO shop_categories (name, slug, icon, sort_order) VALUES (?, ?, ?, ?)',
            [cat.name, cat.slug, cat.icon, i]
        );
    }
    console.log(`✅ Seeded ${DEFAULT_CATEGORIES.length} default shop categories`);
};

module.exports = {
    initShopTables,
    seedDefaultCategories,
};
