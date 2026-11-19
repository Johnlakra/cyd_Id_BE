// Timers, UTR rules, cancellation/rejection/refund rules, and abuse limits.
const h = require('./helpers');
const { sweep } = require('../services/orderLifecycle');

let seller, shop, product;

const freshBuyer = async () => {
    const buyer = await h.createUser();
    const address = await h.createAddress(buyer);
    return { buyer, address };
};

beforeAll(async () => {
    await h.resetDatabase();
    seller = await h.createUser();
    shop = await h.createShop(seller);
    product = await h.createProduct(shop, { price: 10000, stock: 500 });
});

afterAll(() => h.closeDatabase());

describe('payment window', () => {
    test('an unpaid order past its window (+ grace) is cancelled by the sweep and its stock returned', async () => {
        const { buyer, address } = await freshBuyer();
        const before = await h.stockOf(product);
        const id = await h.placeUpiOrder(buyer, address, product, 3);
        expect(await h.stockOf(product)).toBe(before - 3);

        await h.query('UPDATE shop_orders SET pay_by = NOW() - INTERVAL 11 MINUTE WHERE id = ?', [id]);
        await sweep();

        const row = await h.orderRow(id);
        expect(row).toMatchObject({ status: 'cancelled', payment_status: 'void', cancelled_by: 'system' });
        expect(await h.stockOf(product)).toBe(before);
        // A second sweep must not return the stock again.
        await sweep();
        expect(await h.stockOf(product)).toBe(before);
    });

    test('a claim during the grace period is still accepted', async () => {
        const { buyer, address } = await freshBuyer();
        const id = await h.placeUpiOrder(buyer, address, product);
        await h.query('UPDATE shop_orders SET pay_by = NOW() - INTERVAL 5 MINUTE WHERE id = ?', [id]);
        const res = await h.api(buyer).post(`/shop/orders/${id}/payment-claim`, { utr: h.nextUtr() });
        expect(res.status).toBe(200);
        expect(res.body.data.order.payment_status).toBe('claimed');
    });

    test('a claim after the grace period is refused, and opening the order expires it', async () => {
        const { buyer, address } = await freshBuyer();
        const id = await h.placeUpiOrder(buyer, address, product);
        await h.query('UPDATE shop_orders SET pay_by = NOW() - INTERVAL 11 MINUTE WHERE id = ?', [id]);
        const res = await h.api(buyer).post(`/shop/orders/${id}/payment-claim`, { utr: h.nextUtr() });
        expect(res.status).toBe(409);
        const view = await h.api(buyer).get(`/shop/orders/${id}`);
        expect(view.body.data.order.payment_status).toBe('void');
        expect(view.body.data.order.dispute_reasons).toContain('paid_after_cancel');
    });
});

describe('UTR rules', () => {
    test('UTR must be 12 digits; spaces are ignored', async () => {
        const { buyer, address } = await freshBuyer();
        const id = await h.placeUpiOrder(buyer, address, product);
        for (const bad of ['12345', 'ABCDEFGHIJKL', '1234567890123', 'T2402150123456789']) {
            const res = await h.api(buyer).post(`/shop/orders/${id}/payment-claim`, { utr: bad });
            expect(res.status).toBe(400);
        }
        expect((await h.api(buyer).post(`/shop/orders/${id}/payment-claim`, { utr: '4012 3456 7890' })).status).toBe(200);
        expect((await h.queryOne('SELECT utr FROM shop_payment_claims WHERE order_id = ?', [id])).utr).toBe('401234567890');
    });

    test('the same UTR cannot pay for two orders', async () => {
        const { buyer, address } = await freshBuyer();
        const first = await h.placeUpiOrder(buyer, address, product);
        const second = await h.placeUpiOrder(buyer, address, product);
        const utr = h.nextUtr();
        expect((await h.api(buyer).post(`/shop/orders/${first}/payment-claim`, { utr })).status).toBe(200);
        const dup = await h.api(buyer).post(`/shop/orders/${second}/payment-claim`, { utr });
        expect(dup.status).toBe(409);
        expect(dup.body.message).toMatch(/already been used/);
        expect((await h.orderRow(second)).payment_status).toBe('awaiting_payment');
    });

    test('if the buyer edits the UTR, the seller must confirm the new one', async () => {
        const { buyer, address } = await freshBuyer();
        const id = await h.placeUpiOrder(buyer, address, product);
        const oldUtr = h.nextUtr();
        const newUtr = h.nextUtr();
        await h.api(buyer).post(`/shop/orders/${id}/payment-claim`, { utr: oldUtr });
        expect((await h.api(buyer).patch(`/shop/orders/${id}/payment-claim`, { utr: newUtr })).status).toBe(200);
        const stale = await h.api(seller).post(`/shop/orders/${id}/payment-confirm`, { utr: oldUtr });
        expect(stale.status).toBe(409);
        expect((await h.api(seller).post(`/shop/orders/${id}/payment-confirm`, { utr: newUtr })).status).toBe(200);
        // Once confirmed, the buyer can no longer change it.
        expect((await h.api(buyer).patch(`/shop/orders/${id}/payment-claim`, { utr: h.nextUtr() })).status).toBe(409);
    });
});

describe('cancel, reject, refund', () => {
    test('buyer can cancel only before claiming payment', async () => {
        const { buyer, address } = await freshBuyer();
        const before = await h.stockOf(product);
        const unpaid = await h.placeUpiOrder(buyer, address, product);
        const cancel = await h.api(buyer).put(`/shop/orders/${unpaid}/cancel`, {});
        expect(cancel.status).toBe(200);
        expect(cancel.body.data.order).toMatchObject({ status: 'cancelled', payment_status: 'void', cancelled_by: 'buyer' });
        expect(await h.stockOf(product)).toBe(before);

        const claimed = await h.placeUpiOrder(buyer, address, product);
        await h.api(buyer).post(`/shop/orders/${claimed}/payment-claim`, { utr: h.nextUtr() });
        const refused = await h.api(buyer).put(`/shop/orders/${claimed}/cancel`, {});
        expect(refused.status).toBe(409);
        expect(refused.body.message).toMatch(/already submitted a payment/);
    });

    test('seller cannot fulfil before confirming payment', async () => {
        const { buyer, address } = await freshBuyer();
        const id = await h.placeUpiOrder(buyer, address, product);
        await h.api(buyer).post(`/shop/orders/${id}/payment-claim`, { utr: h.nextUtr() });
        const res = await h.api(seller).put(`/shop/orders/${id}/status`, { status: 'accepted' });
        expect(res.status).toBe(409);
    });

    test('seller rejecting a paid order makes a refund due, restocks once, then records the refund', async () => {
        const { buyer, address } = await freshBuyer();
        const before = await h.stockOf(product);
        const id = await h.placeUpiOrder(buyer, address, product, 2);
        const utr = h.nextUtr();
        await h.api(buyer).post(`/shop/orders/${id}/payment-claim`, { utr });
        await h.api(seller).post(`/shop/orders/${id}/payment-confirm`, { utr });

        const reject = await h.api(seller).put(`/shop/orders/${id}/status`, { status: 'rejected', reason: 'Out of stock' });
        expect(reject.status).toBe(200);
        expect(reject.body.data.order).toMatchObject({ status: 'rejected', payment_status: 'refund_due' });
        expect(reject.body.data.order.allowed_actions).toContain('refund');
        expect(await h.stockOf(product)).toBe(before);

        // The refund reference must be a different transaction from the payment.
        expect((await h.api(seller).post(`/shop/orders/${id}/refund`, { refund_utr: utr })).status).toBe(400);
        const refundUtr = h.nextUtr();
        const refund = await h.api(seller).post(`/shop/orders/${id}/refund`, { refund_utr: refundUtr });
        expect(refund.status).toBe(200);
        expect(refund.body.data.order.payment_status).toBe('refunded');
        expect(refund.body.data.order.claim.refund_utr).toBe(refundUtr);
        expect(await h.stockOf(product)).toBe(before);
    });

    test('seller can reject an unpaid order; nothing is owed', async () => {
        const { buyer, address } = await freshBuyer();
        const id = await h.placeUpiOrder(buyer, address, product);
        const res = await h.api(seller).put(`/shop/orders/${id}/status`, { status: 'rejected' });
        expect(res.status).toBe(200);
        expect(res.body.data.order).toMatchObject({ status: 'rejected', payment_status: 'void' });
    });

    test('illegal fulfilment jumps are rejected', async () => {
        const { buyer, address } = await freshBuyer();
        const res = await h.checkout(buyer, address, [[product, 1]], 'cod');
        const id = res.body.data.orders[0].id;
        expect((await h.api(seller).put(`/shop/orders/${id}/status`, { status: 'delivered' })).status).toBe(400);
    });
});

describe('checkout limits', () => {
    test('duplicate lines are merged and still cannot exceed stock', async () => {
        const limited = await h.createProduct(shop, { stock: 3 });
        const { buyer, address } = await freshBuyer();
        const over = await h.checkout(buyer, address, [[limited, 2], [limited, 2]], 'cod');
        expect(over.status).toBe(400);
        expect(await h.stockOf(limited)).toBe(3);
        const ok = await h.checkout(buyer, address, [[limited, 1], [limited, 2]], 'cod');
        expect(ok.status).toBe(201);
        expect(await h.stockOf(limited)).toBe(0);
        const items = await h.query('SELECT quantity FROM shop_order_items WHERE order_id = ?', [ok.body.data.orders[0].id]);
        expect(items).toEqual([{ quantity: 3 }]);
    });

    test('a buyer may have at most 3 unpaid UPI orders', async () => {
        const { buyer, address } = await freshBuyer();
        for (let i = 0; i < 3; i += 1) await h.placeUpiOrder(buyer, address, product);
        const fourth = await h.checkout(buyer, address, [[product, 1]], 'upi');
        expect(fourth.status).toBe(400);
        expect(fourth.body.message).toMatch(/at most 3 unpaid UPI orders/);
        // Cash on delivery is not limited.
        expect((await h.checkout(buyer, address, [[product, 1]], 'cod')).status).toBe(201);
    });

    test('sellers cannot buy from their own shop', async () => {
        const address = await h.createAddress(seller);
        const res = await h.checkout(seller, address, [[product, 1]], 'cod');
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/your own shop/);
    });

    test('inactive products and unapproved shops cannot be bought', async () => {
        const { buyer, address } = await freshBuyer();
        const draft = await h.createProduct(shop, { status: 'draft' });
        expect((await h.checkout(buyer, address, [[draft, 1]], 'cod')).status).toBe(400);
        const pendingSeller = await h.createUser();
        const pendingShop = await h.createShop(pendingSeller, { status: 'pending' });
        const pendingProduct = await h.createProduct(pendingShop);
        expect((await h.checkout(buyer, address, [[pendingProduct, 1]], 'cod')).status).toBe(400);
    });

    test('checkout requires an Idempotency-Key and an address the buyer owns', async () => {
        const { buyer, address } = await freshBuyer();
        const other = await freshBuyer();
        const noKey = await h.api(buyer).post('/shop/checkout', {
            address_id: address.id,
            items: [{ product_id: product.id, quantity: 1 }],
            payment_method: 'cod',
        });
        expect(noKey.status).toBe(400);
        const wrongAddress = await h.checkout(buyer, other.address, [[product, 1]], 'cod');
        expect(wrongAddress.status).toBe(404);
    });
});

describe('address snapshot', () => {
    test('orders keep their delivery address even if the saved address is edited or deleted', async () => {
        const { buyer, address } = await freshBuyer();
        const res = await h.checkout(buyer, address, [[product, 1]], 'cod');
        const id = res.body.data.orders[0].id;
        await h.api(buyer).put(`/shop/addresses/${address.id}`, {
            full_name: 'Someone Else', phone: '9111111111', line1: 'New Street', city: 'Amritsar', state: 'Punjab', pincode: '143001',
        });
        const del = await h.api(buyer).get(`/shop/orders/${id}`);
        expect(del.body.data.order).toMatchObject({ full_name: 'Test Buyer', city: 'Jalandhar' });
        const remove = await require('supertest')(h.getApp())
            .delete(`/shop/addresses/${address.id}`)
            .set('Authorization', `Bearer ${buyer.token}`);
        expect(remove.status).toBe(200);
        const after = await h.api(buyer).get(`/shop/orders/${id}`);
        expect(after.body.data.order.full_name).toBe('Test Buyer');
    });
});
