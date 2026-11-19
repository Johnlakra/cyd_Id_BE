# Payments: peer-to-peer UPI

CYD Shop works like the P2P mode on a crypto exchange: **the platform never receives, holds
or forwards money.** A buyer pays the seller's own UPI ID directly from any UPI app. What the
platform holds is the *item*: placing an order reserves its stock, and that reservation is the
"escrow". The seller releases the order by confirming that the money arrived in their bank.
If the two disagree, an admin decides from the chat and the evidence.

Cash on delivery (COD) is available too, per shop.

> **History.** An earlier version integrated YouPI-PG, a self-hosted gateway that detects
> payments by reading bank SMS. An audit found the integration did not match YouPI's real API.
> YouPI's README also forbids collecting payments for unrelated merchants, which is exactly what
> a multi-vendor marketplace does. It was replaced by this model. See `docs/IMPROVEMENT_PLAN.md` §5.

## The flow

```
Buyer places order ──► stock reserved, payment_status = awaiting_payment, pay_by = now + 30 min
        │
        │  buyer pays the seller's UPI ID (copy the ID, or the deep link / QR)
        ▼
Buyer submits the 12-digit UPI Ref No (UTR) ──► claimed, confirm_by = now + 24 h
        │
        │  seller checks their bank app for that amount and UTR
        ├──► seller confirms (sending back the UTR they checked) ──► confirmed ──► fulfilment
        │                                                            (accepted → packed →
        │                                                             shipped → delivered)
        └──► seller reports "not received" ──► disputed ──► admin decides
```

Nobody is ever auto-confirmed. The platform can't see bank accounts, so only the seller (or an
admin, in a dispute) can say the money arrived.

## Timers

| Timer | Default | Env var | What happens |
|---|---|---|---|
| Pay window | 30 min | `PAY_WINDOW_MINUTES` | Buyer must submit a UTR by `pay_by` |
| Grace | 10 min | `PAY_GRACE_MINUTES` | Expiry runs at `pay_by + grace`, so someone typing their UTR at minute 29 isn't cut off. The order is then cancelled (`void`) and its stock returned. |
| Confirm window | 24 h | `CONFIRM_WINDOW_HOURS` | After `confirm_by` the buyer may open a "seller hasn't confirmed" dispute |
| Proof window | 24 h | `DISPUTE_PROOF_HOURS` | After a seller reports "not received", the buyer must upload proof within this time or the claim is rejected automatically |
| Paid after cancel | 48 h | — | A buyer who paid but whose order expired (or who cancelled) can report it within this time |
| Not delivered | 7 days | — | After the seller confirmed payment, the buyer can report non-delivery |
| Refund dispute | 7 days | — | After a refund is recorded, the buyer can say it never arrived |

Expiry and auto-resolution run every 60 s from `server.js`. Because Render's free tier sleeps,
they also run (throttled to once every 30 s) when someone checks out, looks up products or opens
orders. Opening a specific overdue order expires it on the spot.

## Payment states (`shop_orders.payment_status`)

| State | Meaning |
|---|---|
| `awaiting_payment` | UPI order placed; buyer must pay and submit the UTR |
| `claimed` | Buyer submitted a UTR; seller must check and confirm |
| `confirmed` | Seller confirmed receipt; order can be fulfilled |
| `disputed` | An admin is deciding (see the resolution table below) |
| `refund_due` | Seller must refund the buyer directly and enter the refund UTR |
| `refunded` | Seller recorded the refund |
| `void` | No money moved: expired, cancelled before paying, claim rejected, cancelled COD |
| `written_off` | Admin closed an unrecoverable case (e.g. seller unreachable, no refund) |
| `cod_pending` / `cod_collected` | Cash on delivery; delivered → collected |

## Rules that protect both sides

- **Exact references.** The UTR must be the 12-digit UPI Ref No (spaces are ignored) and is
  unique across the whole platform, so one payment can't be reused for two orders.
- **The seller confirms what they checked.** The confirm request includes the UTR the seller
  verified. If the buyer edited it in the meantime, the confirm is refused and the seller has to
  check again.
- **Refunds are separate transactions.** A refund UTR can't equal any payment UTR.
- **Snapshots.** Each order stores the seller's UPI ID and the delivery address at the time it was placed.
  - If a seller changes their UPI ID, buyers of existing orders still see the ID they were told to pay.
  - Changing the ID requires the seller's password and is written to `audit_log`.
- **Suspended shops.**
  - Unpaid orders are cancelled immediately and new claims are blocked.
  - Already-paid orders can still be shipped or refunded.
- **Limits.**
  - A buyer can have at most 3 unpaid UPI orders at a time (`MAX_OPEN_UPI_ORDERS`).
  - Sellers can't buy from their own shop.
  - COD orders have no payment disputes.
- **Payment screenshots are private.** They're stored as Cloudinary `authenticated` assets and
  shown only through signed links that expire after 10 minutes. Only the buyer, the seller and
  (when a dispute exists) an admin can see them.
- **Chat.**
  - Each order has its own thread between buyer and seller.
  - An admin can read it only once a dispute exists.
  - HTML is stripped, messages are rate-limited to 20 per minute, and the thread becomes
    read-only 14 days after the order is closed.
  - The seller's phone number is never shown to the buyer.

## Disputes

| Reason | Who | When |
|---|---|---|
| `not_received` | seller | while a claim is waiting |
| `wrong_amount` | seller | while a claim is waiting |
| `not_confirmed` | buyer | after `confirm_by`; screenshot required |
| `paid_after_cancel` | buyer | UPI order cancelled by expiry or by the buyer, within 48 h; UTR + screenshot required |
| `refund_not_received` | buyer | refund due, or within 7 days of a recorded refund |
| `not_delivered` | buyer | 7 days after the seller confirmed, if not delivered |
| `other` | either | while the payment is claimed/confirmed/refund due |

Only one dispute can be open on an order at a time. A later dispute on the same order is still allowed.

What an admin can decide depends on the state the dispute came from:

| Dispute opened from | Possible resolutions |
|---|---|
| `claimed` | `payment_confirmed` (→ confirmed) · `claim_rejected` (→ cancelled, stock returned) · `refund_required` (→ cancelled, refund due, stock returned) |
| `void` (paid after cancel) | `refund_required` · `claim_rejected` |
| `confirmed` (not delivered) | `refund_required` (→ cancelled; stock returned if not shipped) · `fulfilment_ordered` |
| `refund_due` / `refunded` | `refund_confirmed` · `refund_required` · `closed_unrecoverable` (→ written off) |

A note explaining the decision is required. If a seller reports "not received" and the buyer
uploads no proof within 24 h, the claim is rejected automatically.

**Honest limit:** because the platform never holds funds, it cannot force a refund. Against a
seller who won't refund, the admin's levers are suspending the shop and following up through the
diocese. The UI says this plainly.

## API

All endpoints need the usual `Authorization: Bearer <JWT>`. Who may act on an order (buyer,
seller, admin) is decided per order on the server. `GET /shop/orders/:id` returns
`allowed_actions` and `dispute_reasons` for the person viewing, so the UI never has to repeat the rules.

| Method | Path | Who |
|---|---|---|
| POST | `/shop/checkout` (header `Idempotency-Key`) | buyer: whole cart, one order per shop, one transaction |
| GET | `/shop/checkouts/:id` | buyer |
| POST | `/shop/products/lookup` | anyone: current price/stock/UPI availability for a cart |
| GET | `/shop/config` | anyone |
| GET | `/shop/orders` · `/shop/orders/shop` · `/shop/orders/action-count` | buyer / seller / both |
| GET | `/shop/orders/:id` | buyer, seller, admin |
| POST / PATCH | `/shop/orders/:id/payment-claim` | buyer |
| PUT | `/shop/orders/:id/cancel` | buyer |
| POST | `/shop/orders/:id/payment-confirm` | seller |
| POST | `/shop/orders/:id/payment-not-received` | seller |
| PUT | `/shop/orders/:id/status` | seller (incl. `rejected`) |
| POST | `/shop/orders/:id/refund` | seller |
| POST | `/shop/orders/:id/dispute` | buyer or seller |
| GET / POST | `/shop/orders/:id/messages` | buyer, seller; admin when disputed |
| GET / POST | `/shop/orders/:id/evidence` | buyer, seller; admin can view when disputed |
| GET | `/shop/admin/disputes` | admin |
| POST | `/shop/admin/disputes/:id/resolve` | admin |

## Where the code is

- `services/orderLifecycle.js` is the only code that changes `status`/`payment_status`. Every transition:
  - locks the order row (`SELECT … FOR UPDATE`);
  - re-checks the state and updates with `WHERE payment_status = <expected>`;
  - returns stock at most once (`stock_released_at`);
  - writes a system chat message and an `audit_log` row.
- `services/orderQueries.js` is the read side: the order view, `allowed_actions`, lists, chat, evidence.
- `migrations/001_p2p_payments.js` contains the schema for claims, disputes, chat, evidence, checkouts and the audit log, plus the mapping from the old YouPI-era states.
- `tests/` contains 62 tests covering every rule above, including parallel-request races. They run on MariaDB 10.11 and MySQL 8.0 in CI.

*Not legal advice:* a listing platform that only facilitates direct person-to-person UPI payments
is in a much lighter position than one that collects funds. The diocese should still confirm this
with its own advisers.
