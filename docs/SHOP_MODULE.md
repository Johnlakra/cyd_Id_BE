# Shop Module — Architecture & API Reference

## Why this document exists

The `shop-and-thoughts` (backend) / `shop-and-thought` (frontend) branches existed before this
work only as empty branch names — there was no prior shop code, no prior design doc, and no
prior chat history to draw from. This document is the first (and so far only) record of what
the module is and why it's built the way it is. Read it before changing anything here.

## What this module is

A **multi-vendor marketplace** bolted onto the existing CYD ID Card Management System (a
Catholic Youth Directorate member-profile/ID-card platform for the Diocese of Jalandhar). Think
Meesho/Etsy, scoped to the diocese: any approved user (youth group, parish, or individual) can
apply to run a shop and sell to other members of the app.

## Key design decision: shop ownership is additive, not a role

The existing `users.role` enum (`admin` / `user` / `profile_holder`) is untouched. Being a shop
owner is tracked entirely on the `shops` table (`owner_user_id`, `status`), not by changing a
user's role. A `profile_holder` can keep their ID-card self-service access **and** run a shop —
the two are orthogonal. This avoids any migration risk to the existing role-based access control
and means "do I own a shop" is simply "is there an approved row in `shops` with
`owner_user_id = me`", checked by `middleware/shopAuth.js`.

## Key design decision: one order per shop

A customer's cart can span multiple shops. `POST /shop/checkout` takes the whole cart and, in one
transaction, creates one order per shop. A `shop_orders` row therefore always belongs to exactly
one shop, one customer, one address and one payment. This is the same pattern
Amazon/Meesho/Flipkart use for multi-seller carts, and it keeps every other piece of the system
(fulfillment state machine, a shop owner's "my orders" view, payment reconciliation) simple:
one order, one shop, no splitting logic anywhere else.

## Key design decision: money is integer paise everywhere except user input/display

Every `*_paise` column/field is a `BIGINT UNSIGNED` number of paise (1 rupee = 100 paise).
Floating-point rupees are never stored or compared. The only place rupees (not paise) appear is:
- a product create/update request body (`price`, `compare_at_price` — converted via
  `utils/shopHelpers.js#rupeesToPaise`)
- the frontend's display layer (`(value_paise / 100).toFixed(2)`)

## Key design decision: peer-to-peer UPI, the platform never holds money

Buyers pay each seller's own UPI ID directly and submit the 12-digit UTR. The seller confirms the
money arrived, and admins resolve disputes. Placing an order reserves its stock (the "escrow").
Cash on delivery is available per shop. See [`PAYMENTS.md`](./PAYMENTS.md) for the flow, timers,
dispute rules and why this replaced the earlier YouPI-PG gateway.

## Key design decision: one place changes order state

`services/orderLifecycle.js` is the only code that changes an order's `status` or
`payment_status`. Every transition:
- locks the order row;
- re-checks the state, then updates conditionally on the expected state;
- returns stock at most once (`stock_released_at`);
- writes a system chat message and an `audit_log` row.

`services/orderQueries.js` builds what each viewer sees, including the `allowed_actions` the
frontend renders buttons from.

## Database schema

The baseline tables are in `config/shopDatabase.js` (idempotent `CREATE TABLE IF NOT EXISTS`).
Later changes are numbered migrations in `migrations/`, applied by `scripts/migrate.js` and
recorded in `schema_migrations`. `npm start` runs migrations before starting the server.

| Table | Purpose |
|---|---|
| `shops` | One row per shop (pending/approved/rejected/suspended), keyed to the owning user. |
| `shop_categories` | Flat category list (devotional items, books, apparel, event tickets, …). |
| `shop_products` | Catalog items, always under a shop, `price_paise` + `stock_quantity`. |
| `shop_product_images` | Up to a handful of images per product, Cloudinary URLs. |
| `shop_addresses` | Customer delivery addresses (reusable across orders). |
| `shop_orders` | One order = one shop + one customer + one payment method. Stores copies of the delivery address (`ship_*`) and the seller's UPI ID (`payee_*`), plus the P2P deadlines (`pay_by`, `confirm_by`). |
| `shop_order_items` | Line items, with a `product_title_snapshot` so renaming a product later doesn't rewrite order history. |
| `shop_checkouts` | One row per checkout attempt; `UNIQUE(user_id, idempotency_key)` makes a double submit return the same orders. |
| `shop_payment_claims` | The buyer's UTR (globally `UNIQUE`) and, later, the seller's refund UTR. |
| `shop_disputes` | Disputes with reason, origin state and admin resolution; one open dispute per order. |
| `shop_order_messages` | Per-order buyer–seller chat, including system messages. |
| `shop_order_evidence` | Private payment/refund screenshots (Cloudinary `authenticated`). |
| `audit_log` | Who did what to orders and shops, and when. |

### Running the migration

```bash
npm run init-shop-db     # same as: npm run migrate
```

Safe to re-run — every `CREATE TABLE` is `IF NOT EXISTS`, every index is checked against
`information_schema.statistics` first, and default categories are only seeded if the table is
empty. The `shops` table additionally self-heals: if a table named `shops` already existed in
the database from something unrelated (`CREATE TABLE IF NOT EXISTS` silently no-ops against it,
columns and all), `initShopTables()` adds any missing column via `ensureColumn()`/
`healShopsTable()` without touching existing rows. This was a real failure mode on first
rollout — see `⚠️ Could not create index idx_shops_owner: Key column 'owner_user_id' doesn't
exist` in the logs if you ever see it again elsewhere. This also seeds a starter category list (devotional items, books/booklets, apparel,
event tickets, handmade/crafts, food, other) — edit `DEFAULT_CATEGORIES` in
`config/shopDatabase.js` before first run if the diocese wants different starting categories.

## Order status state machine

```
pending_payment ──(seller confirms UPI, or COD)──▶ placed ──▶ accepted ──▶ packed ──▶ shipped ──▶ delivered
       │                                             │            │
       ▼                                             ▼            ▼
   cancelled                                      rejected     rejected
 (buyer before paying, expiry,                  (seller; refund due if paid)
  suspension, or dispute)
```

Fulfilment transitions are enforced by `ALLOWED_FULFILMENT` in `services/orderLifecycle.js` and
are only allowed once the payment is `confirmed` (or for COD). The payment states and dispute
rules are in [`PAYMENTS.md`](./PAYMENTS.md).

## API reference

All endpoints require `Authorization: Bearer <JWT>` (same auth as the rest of the app) unless
noted. All responses are `{ success, message, data }` on success or
`{ success: false, message, errors? }` on failure.

### Categories
| Method | Path | Access |
|---|---|---|
| GET | `/shop/categories` | any logged-in user |
| POST | `/shop/categories` | admin only |

### Shops
| Method | Path | Access |
|---|---|---|
| POST | `/shop/shops/apply` | any logged-in user — becomes a pending shop application |
| GET | `/shop/shops/mine` | the caller's own shop, any status, or `null` |
| PUT | `/shop/shops/mine` | the caller, if they have a shop |
| GET | `/shop/shops` | marketplace browse — approved shops only |
| GET | `/shop/shops/:id` | storefront header — must be approved |
| GET | `/shop/admin/shops` | admin only — all applications, filterable by `?status=` |
| PUT | `/shop/admin/shops/:id/review` | admin only — approve/reject/suspend |

### Products
| Method | Path | Access |
|---|---|---|
| GET | `/shop/products` | marketplace browse — active products from approved shops |
| GET | `/shop/products/mine` | the caller's own shop's products, any status (requires approved shop) |
| GET | `/shop/products/:id` | product detail |
| POST | `/shop/products` | requires an approved shop |
| PUT | `/shop/products/:id` | requires owning the product's shop |
| DELETE | `/shop/products/:id` | archives (soft-removes); requires owning the shop |

### Addresses
| Method | Path | Access |
|---|---|---|
| GET/POST | `/shop/addresses` | the caller's own addresses |
| PUT/DELETE | `/shop/addresses/:id` | the caller's own address only |

### Checkout, orders and payments

The full list (checkout, payment claim/confirm/refund, disputes, chat, evidence, admin disputes)
is in [`PAYMENTS.md` → API](./PAYMENTS.md#api). The main entry points:

| Method | Path | Access |
|---|---|---|
| POST | `/shop/checkout` | buyer: whole cart, needs an `Idempotency-Key` header |
| POST | `/shop/products/lookup` | any logged-in user: current price/stock for a cart |
| GET | `/shop/orders` · `/shop/orders/shop` | buyer's orders · seller's orders (approved or suspended shop) |
| GET | `/shop/orders/:id` | buyer, seller or admin; includes `allowed_actions` for the viewer |

## Frontend structure

`src/pages/shop/ShopApp.jsx` is the single entry point wired into
`src/components/Dashboard.jsx`'s menu (visible to every role — shop ownership is a capability,
not a role, so there's no reason to hide "Shop" from anyone). It owns its own internal view
state (this app has no react-router anywhere, by design — don't introduce one just for Shop).
`src/pages/shop/AdminShopModeration.jsx` is wired in separately, gated to `role === 'admin'`.

## Known gaps / deliberately out of scope for this first build

- No notifications (WhatsApp/SMS/email). Sellers see an action badge in the app, but nothing
  pings them, and the 24-hour confirm window relies on sellers noticing. This is the most
  valuable next addition.
- No reviews/ratings.
- No shipping cost calculation. `shipping_paise` exists in the schema but is always `0`, and
  shop owners arrange local pickup/delivery within the diocese community.
- A cart spanning shops creates one order (and one UPI payment) per shop, because each seller is paid directly.
