// Parallel requests must never double-apply: these are the races the audit reproduced.
const h = require('./helpers');

let seller, shop;

beforeAll(async () => {
    await h.resetDatabase();
    seller = await h.createUser();
    shop = await h.createShop(seller);
});

afterAll(() => h.closeDatabase());

const statuses = (responses) => responses.map((r) => r.status).sort();

test('parallel cancels return stock exactly once', async () => {
    const product = await h.createProduct(shop, { stock: 10 });
    const buyer = await h.createUser();
    const address = await h.createAddress(buyer);
    const id = await h.placeUpiOrder(buyer, address, product, 1);
    expect(await h.stockOf(product)).toBe(9);

    const results = await Promise.all(Array.from({ length: 6 }, () => h.api(buyer).put(`/shop/orders/${id}/cancel`, {})));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await h.stockOf(product)).toBe(10);
});

test('seller confirm and "not received" racing: exactly one wins', async () => {
    const product = await h.createProduct(shop, { stock: 10 });
    const buyer = await h.createUser();
    const address = await h.createAddress(buyer);
    const id = await h.placeUpiOrder(buyer, address, product);
    const utr = h.nextUtr();
    await h.api(buyer).post(`/shop/orders/${id}/payment-claim`, { utr });

    const results = await Promise.all([
        h.api(seller).post(`/shop/orders/${id}/payment-confirm`, { utr }),
        h.api(seller).post(`/shop/orders/${id}/payment-not-received`, {}),
        h.api(seller).post(`/shop/orders/${id}/payment-confirm`, { utr }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const row = await h.orderRow(id);
    expect(['confirmed', 'disputed']).toContain(row.payment_status);
});

test('buyer cancel and seller accept racing on a COD order: exactly one wins', async () => {
    const product = await h.createProduct(shop, { stock: 10 });
    for (let round = 0; round < 5; round += 1) {
        const buyer = await h.createUser();
        const address = await h.createAddress(buyer);
        const res = await h.checkout(buyer, address, [[product, 1]], 'cod');
        const id = res.body.data.orders[0].id;
        const [cancel, accept] = await Promise.all([
            h.api(buyer).put(`/shop/orders/${id}/cancel`, {}),
            h.api(seller).put(`/shop/orders/${id}/status`, { status: 'accepted' }),
        ]);
        expect([cancel.status, accept.status].filter((s) => s === 200)).toHaveLength(1);
        const row = await h.orderRow(id);
        if (cancel.status === 200) expect(row.status).toBe('cancelled');
        else expect(row.status).toBe('accepted');
    }
    // Every cancelled order returned its unit, every accepted one kept it.
    const kept = await h.queryOne(
        "SELECT COUNT(*) AS c FROM shop_orders o JOIN shop_order_items i ON i.order_id = o.id WHERE i.product_id = ? AND o.status = 'accepted'",
        [product.id]
    );
    expect(await h.stockOf(product)).toBe(10 - kept.c);
});

test('parallel claims with the same UTR on two orders: only one succeeds', async () => {
    const product = await h.createProduct(shop, { stock: 10 });
    const buyer = await h.createUser();
    const address = await h.createAddress(buyer);
    const a = await h.placeUpiOrder(buyer, address, product);
    const b = await h.placeUpiOrder(buyer, address, product);
    const utr = h.nextUtr();
    const results = await Promise.all([
        h.api(buyer).post(`/shop/orders/${a}/payment-claim`, { utr }),
        h.api(buyer).post(`/shop/orders/${b}/payment-claim`, { utr }),
    ]);
    expect(statuses(results)).toEqual([200, 409]);
});

test('racing for the last unit: exactly one checkout gets it', async () => {
    const product = await h.createProduct(shop, { stock: 1 });
    const buyers = await Promise.all(Array.from({ length: 6 }, () => h.createUser()));
    const addresses = await Promise.all(buyers.map((b) => h.createAddress(b)));
    const results = await Promise.all(buyers.map((b, i) => h.checkout(b, addresses[i], [[product, 1]], 'cod')));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await h.stockOf(product)).toBe(0);
});

test('same Idempotency-Key: a double submit creates one set of orders', async () => {
    const product = await h.createProduct(shop, { stock: 10 });
    const buyer = await h.createUser();
    const address = await h.createAddress(buyer);
    const key = `double-submit-${Date.now()}`;

    const parallel = await Promise.all([
        h.checkout(buyer, address, [[product, 2]], 'cod', key),
        h.checkout(buyer, address, [[product, 2]], 'cod', key),
        h.checkout(buyer, address, [[product, 2]], 'cod', key),
    ]);
    expect(parallel.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(parallel.filter((r) => r.status === 201)).toHaveLength(1);
    const ids = new Set(parallel.map((r) => r.body.data.orders[0].id));
    expect(ids.size).toBe(1);
    expect(await h.stockOf(product)).toBe(8);

    // A later retry with the same key also returns the same orders...
    const retry = await h.checkout(buyer, address, [[product, 2]], 'cod', key);
    expect(retry.status).toBe(200);
    expect(retry.body.data.replayed).toBe(true);
    // ...but reusing the key for a different cart is refused.
    const different = await h.checkout(buyer, address, [[product, 3]], 'cod', key);
    expect(different.status).toBe(409);
    expect(await h.stockOf(product)).toBe(8);
});

test('parallel shop applications from one user create one shop', async () => {
    const user = await h.createUser();
    const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
            h.api(user).post('/shop/shops/apply', { name: `Youth Shop ${i}`, contact_phone: '9876543210' })
        )
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const row = await h.queryOne('SELECT COUNT(*) AS c FROM shops WHERE owner_user_id = ?', [user.id]);
    expect(row.c).toBe(1);
});
