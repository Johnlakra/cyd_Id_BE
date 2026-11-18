// The shop schema as it was before migration 001 (YouPI era), for migration tests.
const { query } = require('../../config/database');

const createLegacySchema = async () => {
    await query(`CREATE TABLE shops (
        id INT PRIMARY KEY AUTO_INCREMENT, owner_user_id INT NOT NULL, name VARCHAR(150) NOT NULL,
        slug VARCHAR(170) UNIQUE NOT NULL, description TEXT, logo_url VARCHAR(255), banner_url VARCHAR(255),
        parish VARCHAR(100), deanery VARCHAR(100), contact_phone VARCHAR(20), upi_id VARCHAR(100),
        status ENUM('pending', 'approved', 'rejected', 'suspended') DEFAULT 'pending', rejection_reason TEXT,
        reviewed_by INT, reviewed_at TIMESTAMP NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_user_id) REFERENCES users(id), FOREIGN KEY (reviewed_by) REFERENCES users(id))`);
    await query(`CREATE TABLE shop_categories (
        id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(80) NOT NULL, slug VARCHAR(90) UNIQUE NOT NULL,
        icon VARCHAR(50), sort_order INT DEFAULT 0, status TINYINT DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await query(`CREATE TABLE shop_products (
        id INT PRIMARY KEY AUTO_INCREMENT, shop_id INT NOT NULL, category_id INT, title VARCHAR(150) NOT NULL,
        slug VARCHAR(170) NOT NULL, description TEXT, price_paise BIGINT UNSIGNED NOT NULL, compare_at_price_paise BIGINT UNSIGNED,
        stock_quantity INT NOT NULL DEFAULT 0, sku VARCHAR(50),
        status ENUM('draft', 'active', 'out_of_stock', 'archived') DEFAULT 'draft', views_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (shop_id) REFERENCES shops(id), FOREIGN KEY (category_id) REFERENCES shop_categories(id))`);
    await query(`CREATE TABLE shop_product_images (
        id INT PRIMARY KEY AUTO_INCREMENT, product_id INT NOT NULL, image_url VARCHAR(255) NOT NULL, sort_order INT DEFAULT 0,
        is_primary TINYINT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES shop_products(id) ON DELETE CASCADE)`);
    await query(`CREATE TABLE shop_addresses (
        id INT PRIMARY KEY AUTO_INCREMENT, user_id INT NOT NULL, label VARCHAR(50) DEFAULT 'Home', full_name VARCHAR(100) NOT NULL,
        phone VARCHAR(20) NOT NULL, line1 VARCHAR(200) NOT NULL, line2 VARCHAR(200), city VARCHAR(100) NOT NULL,
        state VARCHAR(100) NOT NULL, pincode VARCHAR(10) NOT NULL, is_default TINYINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))`);
    await query(`CREATE TABLE shop_orders (
        id INT PRIMARY KEY AUTO_INCREMENT, order_number VARCHAR(40) UNIQUE NOT NULL, customer_user_id INT NOT NULL,
        shop_id INT NOT NULL, address_id INT NOT NULL, subtotal_paise BIGINT UNSIGNED NOT NULL,
        shipping_paise BIGINT UNSIGNED DEFAULT 0, total_paise BIGINT UNSIGNED NOT NULL,
        status ENUM('pending_payment', 'placed', 'accepted', 'packed', 'shipped', 'delivered', 'cancelled', 'rejected') DEFAULT 'pending_payment',
        payment_status ENUM('pending', 'paid', 'failed', 'refunded') DEFAULT 'pending',
        payment_method ENUM('upi', 'cod') DEFAULT 'upi', notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_user_id) REFERENCES users(id), FOREIGN KEY (shop_id) REFERENCES shops(id),
        FOREIGN KEY (address_id) REFERENCES shop_addresses(id))`);
    await query(`CREATE TABLE shop_order_items (
        id INT PRIMARY KEY AUTO_INCREMENT, order_id INT NOT NULL, product_id INT NOT NULL,
        product_title_snapshot VARCHAR(150) NOT NULL, unit_price_paise BIGINT UNSIGNED NOT NULL, quantity INT NOT NULL,
        line_total_paise BIGINT UNSIGNED NOT NULL,
        FOREIGN KEY (order_id) REFERENCES shop_orders(id) ON DELETE CASCADE, FOREIGN KEY (product_id) REFERENCES shop_products(id))`);
    await query(`CREATE TABLE shop_payments (
        id INT PRIMARY KEY AUTO_INCREMENT, order_id INT NOT NULL, gateway VARCHAR(30) NOT NULL DEFAULT 'youpi',
        gateway_order_ref VARCHAR(100) NOT NULL, utr VARCHAR(50), amount_paise BIGINT UNSIGNED NOT NULL,
        status ENUM('initiated', 'success', 'failed') DEFAULT 'initiated', delivery_id VARCHAR(100), raw_webhook_payload JSON,
        verified_at TIMESTAMP NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES shop_orders(id), UNIQUE KEY uniq_delivery_id (delivery_id))`);
};

module.exports = { createLegacySchema };
