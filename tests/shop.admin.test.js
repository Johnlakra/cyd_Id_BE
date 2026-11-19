// Shop suspension effects, UPI ID changes, product visibility, and the cart lookup endpoint.
const bcrypt = require('bcryptjs');
const h = require('./helpers');

let admin;

beforeAll(async () => {
    await h.resetDatabase();
    admin = await h.createUser({ role: 'admin' });
});

afterAll(() => h.closeDatabase());

test('suspending a shop cancels its unpaid orders but it can still ship confirmed ones', async () => {
    const seller = await h.createUser();
    const shop = await h.createShop(seller);
    const product = await h.createProduct(shop, { stock: 10 });
    const buyer = await h.createUser();
    const address = await h.createAddress(buyer);

    const unpaid = await h.placeUpiOrder(buyer, address, product);
    const paid = await h.placeUpiOrder(buyer, address, product);
    const utr = h.nextUtr();
    await h.api(buyer).post(`/shop/orders/${paid}/payment-claim`, { utr });
    await h.api(seller).post(`/shop/orders/${paid}/payment-confirm`, { utr });
    expect(await h.stockOf(product)).toBe(8);

    const noReason = await h.api(admin).put(`/shop/admin/shops/${shop.id}/review`, { status: 'suspended' });
    expect(noReason.status).toBe(400);
    const suspend = await h.api(admin).put(`/shop/admin/shops/${shop.id}/review`, { status: 'suspended', rejection_reason: 'Complaints' });
    expect(suspend.status).toBe(200);
    expect(suspend.body.data.cancelled_unpaid_orders).toBe(1);

    expect(await h.orderRow(unpaid)).toMatchObject({ status: 'cancelled', payment_status: 'void', cancelled_by: 'admin' });
    expect(await h.stockOf(product)).toBe(9);

    // The suspended seller can still see and fulfil the paid order.
    const list = await h.api(seller).get('/shop/orders/shop');
    expect(list.status).toBe(200);
    expect((await h.api(seller).put(`/shop/orders/${paid}/status`, { status: 'accepted' })).status).toBe(200);

    // Nobody can buy from it any more.
    expect((await h.checkout(buyer, address, [[product, 1]], 'cod')).status).toBe(400);
});

test('changing the UPI ID requires the account password and does not affect existing orders', async () => {
    const seller = await h.createUser();
    await h.query('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash('Secret123', 4), seller.id]);
    const shop = await h.createShop(seller, { upi: 'old@okaxis' });
    const product = await h.createProduct(shop);
    const buyer = await h.createUser();
    const address = await h.createAddress(buyer);
    const orderId = await h.placeUpiOrder(buyer, address, product);

    expect((await h.api(seller).put('/shop/shops/mine', { upi_id: 'new@oksbi' })).status).toBe(403);
    expect((await h.api(seller).put('/shop/shops/mine', { upi_id: 'new@oksbi', current_password: 'wrong' })).status).toBe(403);
    expect((await h.api(seller).put('/shop/shops/mine', { upi_id: 'not a upi', current_password: 'Secret123' })).status).toBe(400);
    const ok = await h.api(seller).put('/shop/shops/mine', { upi_id: 'new@oksbi', current_password: 'Secret123' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.shop.upi_id).toBe('new@oksbi');

    // Non-UPI fields don't need the password.
    expect((await h.api(seller).put('/shop/shops/mine', { description: 'Rosaries and candles' })).status).toBe(200);

    const view = await h.api(buyer).get(`/shop/orders/${orderId}`);
    expect(view.body.data.order.payee.upi_id).toBe('old@okaxis');
    const audit = await h.queryOne("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'shop.upi_changed' AND entity_id = ?", [shop.id]);
    expect(audit.c).toBe(1);
});

test('blank UPI ID on a shop application is accepted (cash-on-delivery only shop)', async () => {
    const user = await h.createUser();
    const res = await h.api(user).post('/shop/shops/apply', { name: 'Candle Corner', contact_phone: '9876543210', upi_id: '' });
    expect(res.status).toBe(201);
    expect(res.body.data.shop.upi_id).toBeNull();
});

test('draft and pending-shop products are hidden from other users by id', async () => {
    const seller = await h.createUser();
    const shop = await h.createShop(seller);
    const draft = await h.createProduct(shop, { status: 'draft' });
    const active = await h.createProduct(shop);
    const viewer = await h.createUser();

    expect((await h.api(viewer).get(`/shop/products/${draft.id}`)).status).toBe(404);
    expect((await h.api(seller).get(`/shop/products/${draft.id}`)).status).toBe(200);
    expect((await h.api(admin).get(`/shop/products/${draft.id}`)).status).toBe(200);
    const shown = await h.api(viewer).get(`/shop/products/${active.id}`);
    expect(shown.status).toBe(200);
    expect(shown.body.data.product.owner_user_id).toBeUndefined();
});

test('product lookup returns current price, stock and UPI availability for a cart', async () => {
    const seller = await h.createUser();
    const upiShop = await h.createShop(seller);
    const codSeller = await h.createUser();
    const codShop = await h.createShop(codSeller, { upi: null });
    const a = await h.createProduct(upiShop, { price: 12300, stock: 2 });
    const b = await h.createProduct(codShop, { price: 500, stock: 0 });
    const viewer = await h.createUser();

    const res = await h.api(viewer).post('/shop/products/lookup', { ids: [a.id, b.id] });
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.data.products.map((p) => [p.id, p]));
    expect(byId[a.id]).toMatchObject({ price_paise: 12300, stock_quantity: 2, available: true, accepts_upi: true });
    expect(byId[b.id]).toMatchObject({ available: false, accepts_upi: false });
});

test('shop config endpoint exposes the payment timers', async () => {
    const res = await h.api(admin).get('/shop/config');
    expect(res.body.data).toMatchObject({ pay_window_minutes: 30, confirm_window_hours: 24, payment_methods: ['upi', 'cod'] });
});
