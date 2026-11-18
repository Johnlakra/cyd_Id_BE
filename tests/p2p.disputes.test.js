// Disputes: who can open which, admin resolutions per origin, auto-resolution, evidence, chat access.
jest.mock('../utils/fileUpload', () => {
    const actual = jest.requireActual('../utils/fileUpload');
    let n = 0;
    return {
        ...actual,
        uploadImage: jest.fn(async () => {
            n += 1;
            return { url: `https://res.cloudinary.com/test/image/authenticated/proof${n}.jpg`, public_id: `cyd/order-evidence/proof${n}`, format: 'jpg' };
        }),
    };
});

const h = require('./helpers');
const { sweep } = require('../services/orderLifecycle');

const SCREENSHOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let admin, seller, shop, product;

const freshBuyer = async () => {
    const buyer = await h.createUser();
    const address = await h.createAddress(buyer);
    return { buyer, address };
};

const claimedOrder = async () => {
    const { buyer, address } = await freshBuyer();
    const id = await h.placeUpiOrder(buyer, address, product, 1);
    const utr = h.nextUtr();
    await h.api(buyer).post(`/shop/orders/${id}/payment-claim`, { utr });
    return { buyer, id, utr };
};

const disputeIdFor = async (orderId) =>
    (await h.queryOne("SELECT id FROM shop_disputes WHERE order_id = ? AND status = 'open'", [orderId])).id;

beforeAll(async () => {
    await h.resetDatabase();
    admin = await h.createUser({ role: 'admin' });
    seller = await h.createUser();
    shop = await h.createShop(seller);
    product = await h.createProduct(shop, { price: 30000, stock: 200 });
});

afterAll(() => h.closeDatabase());

test('seller "not received" opens a dispute; admin confirms the payment after reviewing', async () => {
    const { id } = await claimedOrder();
    const report = await h.api(seller).post(`/shop/orders/${id}/payment-not-received`, { description: 'Nothing in my account' });
    expect(report.status).toBe(200);
    expect(report.body.data.order.payment_status).toBe('disputed');

    const queue = await h.api(admin).get('/shop/admin/disputes?status=open');
    expect(queue.body.data.disputes.some((d) => d.order_id === id && d.reason === 'not_received')).toBe(true);

    // The admin can read the chat only because there is a dispute.
    expect((await h.api(admin).get(`/shop/orders/${id}/messages`)).status).toBe(200);

    const disputeId = await disputeIdFor(id);
    expect((await h.api(admin).post(`/shop/admin/disputes/${disputeId}/resolve`, { resolution: 'payment_confirmed' })).status).toBe(400);
    const resolve = await h.api(admin).post(`/shop/admin/disputes/${disputeId}/resolve`, {
        resolution: 'payment_confirmed',
        note: 'Seller bank statement shows the credit.',
    });
    expect(resolve.status).toBe(200);
    expect(await h.orderRow(id)).toMatchObject({ payment_status: 'confirmed', status: 'placed' });
});

test('resolutions must fit where the dispute came from', async () => {
    const { id } = await claimedOrder();
    await h.api(seller).post(`/shop/orders/${id}/payment-not-received`, {});
    const disputeId = await disputeIdFor(id);
    const wrong = await h.api(admin).post(`/shop/admin/disputes/${disputeId}/resolve`, { resolution: 'refund_confirmed', note: 'x' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toMatch(/payment_confirmed, claim_rejected, refund_required/);
});

test('claim rejected in a dispute cancels the order and returns stock once', async () => {
    const before = await h.stockOf(product);
    const { id } = await claimedOrder();
    await h.api(seller).post(`/shop/orders/${id}/payment-not-received`, {});
    const disputeId = await disputeIdFor(id);
    await h.api(admin).post(`/shop/admin/disputes/${disputeId}/resolve`, { resolution: 'claim_rejected', note: 'Fake UTR' });
    expect(await h.orderRow(id)).toMatchObject({ status: 'cancelled', payment_status: 'void', cancelled_by: 'admin' });
    expect(await h.stockOf(product)).toBe(before);
    // Resolving again is refused.
    expect((await h.api(admin).post(`/shop/admin/disputes/${disputeId}/resolve`, { resolution: 'claim_rejected', note: 'again' })).status).toBe(409);
});

test('no buyer proof within the window: the sweep rejects the claim automatically', async () => {
    const before = await h.stockOf(product);
    const { id } = await claimedOrder();
    await h.api(seller).post(`/shop/orders/${id}/payment-not-received`, {});
    await h.query('UPDATE shop_disputes SET opened_at = NOW() - INTERVAL 25 HOUR WHERE order_id = ?', [id]);
    const result = await sweep();
    expect(result.autoResolved).toBeGreaterThanOrEqual(1);
    expect(await h.orderRow(id)).toMatchObject({ status: 'cancelled', payment_status: 'void' });
    expect(await h.stockOf(product)).toBe(before);
    const dispute = await h.queryOne('SELECT resolution, resolved_by FROM shop_disputes WHERE order_id = ?', [id]);
    expect(dispute).toEqual({ resolution: 'claim_rejected', resolved_by: null });
});

test('buyer uploads proof in time: no automatic rejection', async () => {
    const { buyer, id } = await claimedOrder();
    await h.api(seller).post(`/shop/orders/${id}/payment-not-received`, {});
    const upload = await h.api(buyer).post(`/shop/orders/${id}/evidence`, { image: SCREENSHOT, kind: 'payment_proof' });
    expect(upload.status).toBe(201);
    await h.query('UPDATE shop_disputes SET opened_at = NOW() - INTERVAL 25 HOUR WHERE order_id = ?', [id]);
    await h.query('UPDATE shop_order_evidence SET created_at = NOW() - INTERVAL 24 HOUR WHERE order_id = ?', [id]);
    await sweep();
    expect((await h.orderRow(id)).payment_status).toBe('disputed');

    // Seller and admin get short-lived signed links to the private screenshot; strangers get nothing.
    const evidence = await h.api(seller).get(`/shop/orders/${id}/evidence`);
    expect(evidence.status).toBe(200);
    expect(evidence.body.data.evidence[0].url).toMatch(/^https:\/\/api\.cloudinary\.com\/.*expires_at=/);
    expect((await h.api(admin).get(`/shop/orders/${id}/evidence`)).status).toBe(200);
    expect((await h.api(await h.createUser()).get(`/shop/orders/${id}/evidence`)).status).toBe(404);
});

test('buyer can dispute an unconfirmed claim only after the deadline, and must attach proof', async () => {
    const { buyer, id } = await claimedOrder();
    const early = await h.api(buyer).post(`/shop/orders/${id}/dispute`, { reason: 'not_confirmed' });
    expect(early.status).toBe(409);

    await h.query('UPDATE shop_orders SET confirm_by = NOW() - INTERVAL 1 MINUTE WHERE id = ?', [id]);
    const view = await h.api(buyer).get(`/shop/orders/${id}`);
    expect(view.body.data.order.dispute_reasons).toContain('not_confirmed');

    const noProof = await h.api(buyer).post(`/shop/orders/${id}/dispute`, { reason: 'not_confirmed' });
    expect(noProof.status).toBe(400);
    expect(noProof.body.message).toMatch(/screenshot/);

    const ok = await h.api(buyer).post(`/shop/orders/${id}/dispute`, { reason: 'not_confirmed', screenshot: SCREENSHOT });
    expect(ok.status).toBe(200);
    expect(ok.body.data.order.payment_status).toBe('disputed');
    // Only one open dispute at a time.
    expect((await h.api(seller).post(`/shop/orders/${id}/payment-not-received`, {})).status).toBe(409);
});

test('paid after the window closed: buyer reports it, admin orders a refund, seller refunds', async () => {
    const { buyer, address } = await freshBuyer();
    const id = await h.placeUpiOrder(buyer, address, product);
    await h.query('UPDATE shop_orders SET pay_by = NOW() - INTERVAL 11 MINUTE WHERE id = ?', [id]);
    await sweep();
    expect((await h.orderRow(id)).payment_status).toBe('void');

    const utr = h.nextUtr();
    const dispute = await h.api(buyer).post(`/shop/orders/${id}/dispute`, { reason: 'paid_after_cancel', utr, screenshot: SCREENSHOT });
    expect(dispute.status).toBe(200);
    const disputeId = await disputeIdFor(id);
    const resolve = await h.api(admin).post(`/shop/admin/disputes/${disputeId}/resolve`, {
        resolution: 'refund_required',
        note: 'Payment arrived after cancellation.',
    });
    expect(resolve.status).toBe(200);
    expect((await h.orderRow(id)).payment_status).toBe('refund_due');

    const refund = await h.api(seller).post(`/shop/orders/${id}/refund`, { refund_utr: h.nextUtr() });
    expect(refund.status).toBe(200);
    expect((await h.orderRow(id)).payment_status).toBe('refunded');
    // The stock was released when the order expired; the dispute path must not add it again.
    const row = await h.orderRow(id);
    expect(row.stock_released_at).not.toBeNull();
});

test('paid_after_cancel is not available for orders the seller rejected', async () => {
    const { buyer, address } = await freshBuyer();
    const id = await h.placeUpiOrder(buyer, address, product);
    await h.api(seller).put(`/shop/orders/${id}/status`, { status: 'rejected' });
    const res = await h.api(buyer).post(`/shop/orders/${id}/dispute`, { reason: 'paid_after_cancel', utr: h.nextUtr(), screenshot: SCREENSHOT });
    expect(res.status).toBe(409);
});

test('a refund dispute can follow an earlier resolved dispute on the same order', async () => {
    const { buyer, id, utr } = await claimedOrder();
    await h.api(seller).post(`/shop/orders/${id}/payment-confirm`, { utr });
    await h.api(seller).put(`/shop/orders/${id}/status`, { status: 'rejected', reason: 'Cannot deliver' });
    expect((await h.orderRow(id)).payment_status).toBe('refund_due');

    const first = await h.api(buyer).post(`/shop/orders/${id}/dispute`, { reason: 'refund_not_received' });
    expect(first.status).toBe(200);
    let disputeId = await disputeIdFor(id);
    await h.api(admin).post(`/shop/admin/disputes/${disputeId}/resolve`, { resolution: 'refund_required', note: 'Seller must refund.' });
    expect((await h.orderRow(id)).payment_status).toBe('refund_due');

    await h.api(seller).post(`/shop/orders/${id}/refund`, { refund_utr: h.nextUtr() });
    const second = await h.api(buyer).post(`/shop/orders/${id}/dispute`, { reason: 'refund_not_received', description: 'Still nothing' });
    expect(second.status).toBe(200);
    disputeId = await disputeIdFor(id);
    await h.api(admin).post(`/shop/admin/disputes/${disputeId}/resolve`, { resolution: 'closed_unrecoverable', note: 'Seller unreachable; referred to parish priest.' });
    expect((await h.orderRow(id)).payment_status).toBe('written_off');
    const count = await h.queryOne('SELECT COUNT(*) AS c FROM shop_disputes WHERE order_id = ?', [id]);
    expect(count.c).toBe(2);
});

test('not delivered: buyer can dispute a week after the seller confirmed payment', async () => {
    const { buyer, id, utr } = await claimedOrder();
    await h.api(seller).post(`/shop/orders/${id}/payment-confirm`, { utr });
    expect((await h.api(buyer).post(`/shop/orders/${id}/dispute`, { reason: 'not_delivered' })).status).toBe(409);
    await h.query('UPDATE shop_orders SET confirmed_at = NOW() - INTERVAL 8 DAY WHERE id = ?', [id]);
    expect((await h.api(buyer).post(`/shop/orders/${id}/dispute`, { reason: 'not_delivered' })).status).toBe(200);
    const disputeId = await disputeIdFor(id);
    const before = await h.stockOf(product);
    await h.api(admin).post(`/shop/admin/disputes/${disputeId}/resolve`, { resolution: 'refund_required', note: 'Never shipped.' });
    expect(await h.orderRow(id)).toMatchObject({ payment_status: 'refund_due', status: 'cancelled' });
    expect(await h.stockOf(product)).toBe(before + 1);
});

test('cash-on-delivery orders cannot have payment disputes', async () => {
    const { buyer, address } = await freshBuyer();
    const res = await h.checkout(buyer, address, [[product, 1]], 'cod');
    const id = res.body.data.orders[0].id;
    expect((await h.api(buyer).post(`/shop/orders/${id}/dispute`, { reason: 'other' })).status).toBe(400);
});

test('admin cannot read a chat with no dispute', async () => {
    const { id } = await claimedOrder();
    expect((await h.api(admin).get(`/shop/orders/${id}/messages`)).status).toBe(404);
});
