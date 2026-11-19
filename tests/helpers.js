// Shared test helpers: reset the test DB, create users/shops/products, call the API.
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { pool, query, queryOne, initDatabase } = require('../config/database');
const { runMigrations } = require('../scripts/migrate');

let app;
const getApp = () => {
    if (!app) app = require('../server');
    return app;
};

const resetDatabase = async () => {
    const tables = await query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()');
    await query('SET FOREIGN_KEY_CHECKS = 0');
    for (const { name } of tables) {
        await query(`DROP TABLE IF EXISTS \`${name}\``);
    }
    await query('SET FOREIGN_KEY_CHECKS = 1');
    await initDatabase();
    await runMigrations({ log: () => {} });
};

const closeDatabase = () => pool.end();

let userCounter = 0;
const createUser = async ({ role = 'user', status = 1 } = {}) => {
    userCounter += 1;
    const username = `user${Date.now() % 100000}${userCounter}`;
    const result = await query('INSERT INTO users (username, email, password, role, status) VALUES (?, ?, ?, ?, ?)', [
        username,
        `${username}@test.local`,
        'not-used',
        role,
        status,
    ]);
    const user = { id: result.insertId, username, role };
    user.token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
    return user;
};

let shopCounter = 0;
const createShop = async (owner, { upi = 'seller@okaxis', status = 'approved' } = {}) => {
    shopCounter += 1;
    const result = await query(
        "INSERT INTO shops (owner_user_id, name, slug, contact_phone, upi_id, status) VALUES (?, ?, ?, '9999999999', ?, ?)",
        [owner.id, `Shop ${shopCounter}`, `shop-${shopCounter}-${Date.now()}`, upi, status]
    );
    return { id: result.insertId, owner };
};

let productCounter = 0;
const createProduct = async (shop, { price = 10000, stock = 5, status = 'active' } = {}) => {
    productCounter += 1;
    const result = await query(
        'INSERT INTO shop_products (shop_id, title, slug, price_paise, stock_quantity, status) VALUES (?, ?, ?, ?, ?, ?)',
        [shop.id, `Product ${productCounter}`, `product-${productCounter}-${Date.now()}`, price, stock, status]
    );
    return { id: result.insertId, shop, price };
};

const createAddress = async (user) => {
    const result = await query(
        "INSERT INTO shop_addresses (user_id, full_name, phone, line1, city, state, pincode, is_default) VALUES (?, 'Test Buyer', '9000000000', 'Church Road', 'Jalandhar', 'Punjab', '144001', 1)",
        [user.id]
    );
    return { id: result.insertId };
};

const stockOf = async (product) => (await queryOne('SELECT stock_quantity FROM shop_products WHERE id = ?', [product.id])).stock_quantity;

const orderRow = (id) => queryOne('SELECT * FROM shop_orders WHERE id = ?', [id]);

const api = (user) => {
    const agent = request(getApp());
    const withAuth = (req) => (user ? req.set('Authorization', `Bearer ${user.token}`) : req);
    return {
        get: (path) => withAuth(agent.get(path)),
        post: (path, body) => withAuth(agent.post(path)).send(body || {}),
        put: (path, body) => withAuth(agent.put(path)).send(body || {}),
        patch: (path, body) => withAuth(agent.patch(path)).send(body || {}),
    };
};

let keyCounter = 0;
const checkout = async (buyer, address, lines, methods, key) => {
    keyCounter += 1;
    const items = lines.map(([product, quantity]) => ({ product_id: product.id, quantity }));
    const body = { address_id: address.id, items };
    if (typeof methods === 'string') body.payment_method = methods;
    else body.payment_methods = methods;
    return api(buyer)
        .post('/shop/checkout', body)
        .set('Idempotency-Key', key || `test-key-${Date.now()}-${keyCounter}`);
};

// Places a single UPI order and returns its id.
const placeUpiOrder = async (buyer, address, product, quantity = 1) => {
    const res = await checkout(buyer, address, [[product, quantity]], 'upi');
    if (res.status !== 201) throw new Error(`checkout failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data.orders[0].id;
};

// Unique 12-digit UPI reference numbers.
let utrSequence = (Date.now() % 1000000) * 100;
const nextUtr = () => {
    utrSequence += 1;
    return String(400000000000 + utrSequence);
};

module.exports = {
    getApp,
    resetDatabase,
    closeDatabase,
    createUser,
    createShop,
    createProduct,
    createAddress,
    stockOf,
    orderRow,
    api,
    checkout,
    placeUpiOrder,
    nextUtr,
    query,
    queryOne,
};
