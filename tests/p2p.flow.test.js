// End-to-end happy paths for peer-to-peer UPI and cash on delivery.
const h = require('./helpers');

let seller, buyer, stranger, shop, product, address;

beforeAll(async () => {
    await h.resetDatabase();
    seller = await h.createUser();
    buyer = await h.createUser();
    stranger = await h.createUser();
    shop = await h.createShop(seller, { upi: 'stjohnsyouth@okaxis' });
    product = await h.createProduct(shop, { price: 25050, stock: 50 });
    address = await h.createAddress(buyer);
});

afterAll(() => h.closeDatabase());

test('UPI order: buyer pays seller directly, seller confirms, then fulfils to delivered', async () => {
    const res = await h.checkout(buyer, address, [[product, 2]], 'upi');
    expect(res.status).toBe(201);
    const [summary] = res.body.data.orders;
    expect(summary).toMatchObject({ payment_status: 'awaiting_payment', status: 'pending_payment', total_paise: 50100 });
    expect(await h.stockOf(product)).toBe(48);

    // Buyer sees the seller's UPI ID and a deep link with the exact amount and order reference.
    let view = await h.api(buyer).get(`/shop/orders/${summary.id}`);
    expect(view.status).toBe(200);
    const order = view.body.data.order;
    expect(order.payee.upi_id).toBe('stjohnsyouth@okaxis');
    expect(order.payee.upi_link).toContain('pa=stjohnsyouth@okaxis');
    expect(order.payee.upi_link).toContain('am=501.00');
    expect(order.payee.upi_link).toContain(`tn=${order.order_number}`);
    expect(order.allowed_actions).toEqual(expect.arrayContaining(['claim', 'cancel', 'chat']));
    expect(order.pay_seconds_left).toBeGreaterThan(25 * 60);

    // Seller sees the order but not the payee block, and cannot confirm before a claim exists.
    view = await h.api(seller).get(`/shop/orders/${summary.id}`);
    expect(view.body.data.order.payee).toBeNull();
    expect(view.body.data.order.viewer_role).toBe('seller');

    const utr = h.nextUtr();
    const claim = await h.api(buyer).post(`/shop/orders/${summary.id}/payment-claim`, { utr: `${utr.slice(0, 4)} ${utr.slice(4)}` });
    expect(claim.status).toBe(200);
    expect(claim.body.data.order.payment_status).toBe('claimed');
    expect(claim.body.data.order.claim.utr).toBe(utr);
    expect(claim.body.data.order.payee).toBeNull();

    view = await h.api(seller).get(`/shop/orders/${summary.id}`);
    expect(view.body.data.order.allowed_actions).toEqual(expect.arrayContaining(['confirm', 'dispute']));
    expect(view.body.data.order.dispute_reasons).toEqual(expect.arrayContaining(['not_received']));

    const confirm = await h.api(seller).post(`/shop/orders/${summary.id}/payment-confirm`, { utr });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.order).toMatchObject({ payment_status: 'confirmed', status: 'placed' });

    for (const status of ['accepted', 'packed', 'shipped', 'delivered']) {
        const step = await h.api(seller).put(`/shop/orders/${summary.id}/status`, { status });
        expect(step.status).toBe(200);
        expect(step.body.data.order.status).toBe(status);
    }

    // System messages narrate the whole flow in the order chat.
    const chat = await h.api(buyer).get(`/shop/orders/${summary.id}/messages`);
    expect(chat.body.data.messages.length).toBeGreaterThanOrEqual(6);
    expect(chat.body.data.messages.every((m) => m.sender_role === 'system')).toBe(true);
});

test('COD order: placed immediately, delivered marks cash collected', async () => {
    const res = await h.checkout(buyer, address, [[product, 1]], 'cod');
    expect(res.status).toBe(201);
    const id = res.body.data.orders[0].id;
    expect(res.body.data.orders[0]).toMatchObject({ payment_status: 'cod_pending', status: 'placed' });

    for (const status of ['accepted', 'packed', 'shipped', 'delivered']) {
        expect((await h.api(seller).put(`/shop/orders/${id}/status`, { status })).status).toBe(200);
    }
    const row = await h.orderRow(id);
    expect(row.payment_status).toBe('cod_collected');
});

test('a cart spanning two shops becomes one order per shop with per-shop payment methods', async () => {
    const otherSeller = await h.createUser();
    const otherShop = await h.createShop(otherSeller, { upi: null });
    const otherProduct = await h.createProduct(otherShop, { price: 5000 });

    const res = await h.checkout(buyer, address, [[product, 1], [otherProduct, 2]], {
        [shop.id]: 'upi',
        [otherShop.id]: 'cod',
    });
    expect(res.status).toBe(201);
    const orders = res.body.data.orders;
    expect(orders).toHaveLength(2);
    expect(orders.find((o) => o.shop_id === shop.id).payment_status).toBe('awaiting_payment');
    expect(orders.find((o) => o.shop_id === otherShop.id)).toMatchObject({ payment_status: 'cod_pending', total_paise: 10000 });

    const view = await h.api(buyer).get(`/shop/checkouts/${res.body.data.checkout_id}`);
    expect(view.body.data.checkout.orders).toHaveLength(2);
});

test('shops without a valid UPI ID only accept cash on delivery', async () => {
    const codSeller = await h.createUser();
    const codShop = await h.createShop(codSeller, { upi: null });
    const codProduct = await h.createProduct(codShop);
    const res = await h.checkout(buyer, address, [[codProduct, 1]], 'upi');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/only accepts cash on delivery/);
});

test('strangers cannot see an order, its chat, or its evidence', async () => {
    const id = await h.placeUpiOrder(buyer, address, product);
    expect((await h.api(stranger).get(`/shop/orders/${id}`)).status).toBe(404);
    expect((await h.api(stranger).get(`/shop/orders/${id}/messages`)).status).toBe(404);
    expect((await h.api(stranger).post(`/shop/orders/${id}/messages`, { body: 'hi' })).status).toBe(404);
    expect((await h.api(stranger).get(`/shop/orders/${id}/evidence`)).status).toBe(404);
    expect((await h.api(stranger).post(`/shop/orders/${id}/payment-claim`, { utr: h.nextUtr() })).status).toBe(404);
});

test('buyer and seller can chat; HTML is stripped', async () => {
    const id = await h.placeUpiOrder(buyer, address, product);
    const sent = await h.api(buyer).post(`/shop/orders/${id}/messages`, { body: 'Hello <b>seller</b>, can I pick up after Mass?' });
    expect(sent.status).toBe(201);
    expect(sent.body.data.message.body).toBe('Hello seller, can I pick up after Mass?');
    expect((await h.api(seller).post(`/shop/orders/${id}/messages`, { body: 'Yes, Sunday works.' })).status).toBe(201);
    const list = await h.api(seller).get(`/shop/orders/${id}/messages`);
    const human = list.body.data.messages.filter((m) => m.sender_role !== 'system');
    expect(human.map((m) => m.sender_role)).toEqual(['buyer', 'seller']);
    // Polling with ?after= returns only newer messages.
    const after = await h.api(buyer).get(`/shop/orders/${id}/messages?after=${human[0].id}`);
    expect(after.body.data.messages.map((m) => m.body)).toEqual(['Yes, Sunday works.']);
});

test('action counts reflect what each side needs to do', async () => {
    const before = (await h.api(seller).get('/shop/orders/action-count')).body.data.seller;
    const freshBuyer = await h.createUser();
    const freshAddress = await h.createAddress(freshBuyer);
    const id = await h.placeUpiOrder(freshBuyer, freshAddress, product);

    let buyerCounts = await h.api(freshBuyer).get('/shop/orders/action-count');
    expect(buyerCounts.body.data.buyer).toBe(1); // needs to pay

    await h.api(freshBuyer).post(`/shop/orders/${id}/payment-claim`, { utr: h.nextUtr() });
    buyerCounts = await h.api(freshBuyer).get('/shop/orders/action-count');
    expect(buyerCounts.body.data.buyer).toBe(0);
    const after = (await h.api(seller).get('/shop/orders/action-count')).body.data.seller;
    expect(after).toBe(before + 1); // needs to confirm

    const list = await h.api(seller).get('/shop/orders/shop');
    expect(list.body.data.orders.find((o) => o.id === id).needs_action).toBe(true);
});
