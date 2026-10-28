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

A customer's cart can span multiple shops. At checkout, the frontend splits the cart by
`shop_id` and calls `POST /shop/orders` once per shop — so a `shop_orders` row always belongs to
exactly one shop, exactly one customer, one address, one payment. This is the same pattern
Amazon/Meesho/Flipkart use for multi-seller carts, and it keeps every other piece of the system
(fulfillment state machine, a shop owner's "my orders" view, payment reconciliation) simple:
one order, one shop, no splitting logic anywhere else.

## Key design decision: money is integer paise everywhere except user input/display

Every `*_paise` column/field is a `BIGINT UNSIGNED` number of paise (1 rupee = 100 paise).
Floating-point rupees are never stored or compared. The only place rupees (not paise) appear is:
- a product create/update request body (`price`, `compare_at_price` — converted via
  `utils/shopHelpers.js#rupeesToPaise`)
- the frontend's display layer (`(value_paise / 100).toFixed(2)`)

## Key design decision: pluggable payment gateway, YouPI-PG as the default

See [`PAYMENTS.md`](./PAYMENTS.md) for the full picture, including the risk this carries.
In short: `services/payments/index.js#getGateway()` is the only way controllers reach a
gateway implementation. The default (`PAYMENT_GATEWAY=youpi`) is
[YouPI-PG](https://github.com/youpi-pg/YouPI-PG), which is **not** a certified/bank-backed
gateway — read `PAYMENTS.md` before trusting this with money that matters. A `cod`
(cash-on-delivery) gateway is also implemented and needs no external service at all.

## Database schema

See `config/shopDatabase.js` for the authoritative `CREATE TABLE` statements (idempotent,
following the same `CREATE TABLE IF NOT EXISTS` + `createIndexSafely` style as the base app's
`config/database.js` — no ORM, no migration framework, by design, to match the rest of this
small codebase).

| Table | Purpose |
|---|---|
| `shops` | One row per shop (pending/approved/rejected/suspended), keyed to the owning user. |
| `shop_categories` | Flat category list (devotional items, books, apparel, event tickets, …). |
| `shop_products` | Catalog items, always under a shop, `price_paise` + `stock_quantity`. |
| `shop_product_images` | Up to a handful of images per product, Cloudinary URLs. |
| `shop_addresses` | Customer delivery addresses (reusable across orders). |
| `shop_orders` | One order = one shop + one customer + one address + one payment method. |
| `shop_order_items` | Line items, with a `product_title_snapshot` so renaming a product later doesn't rewrite order history. |
| `shop_payments` | One or more payment attempts per order; `delivery_id` is `UNIQUE` for webhook idempotency. |

### Running the migration

```bash
node scripts/initShopDatabase.js
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
pending_payment ──(payment OR cod)──▶ placed ──▶ accepted ──▶ packed ──▶ shipped ──▶ delivered
                                         │            │
                                         ▼            ▼
                                     cancelled     rejected
                                   (customer,    (shop owner,
                                  before shop     either stage)
                                     accepts)
```

Enforced server-side in `controllers/orderController.js`'s `ALLOWED_TRANSITIONS` map — the API
will reject any status update that isn't a listed transition from the order's current status.

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

### Orders
| Method | Path | Access |
|---|---|---|
| POST | `/shop/orders` | customer places an order for one shop's items |
| GET | `/shop/orders` | customer's own order history |
| GET | `/shop/orders/shop` | shop owner's incoming orders (requires approved shop) |
| GET | `/shop/orders/:id` | the customer, the owning shop owner, or admin |
| PUT | `/shop/orders/:id/status` | shop owner, within `ALLOWED_TRANSITIONS` |
| PUT | `/shop/orders/:id/cancel` | customer, only while `pending_payment`/`placed` |

### Payments
| Method | Path | Access |
|---|---|---|
| POST | `/shop/payments/initiate` | customer — returns YouPI checkout params |
| GET | `/shop/payments/:orderId/status` | customer or admin — poll while waiting |
| POST | `/shop/payments/webhook/youpi` | **the YouPI-PG server**, not a browser — HMAC-signed, no JWT |

## Frontend structure

`src/pages/shop/ShopApp.jsx` is the single entry point wired into
`src/components/Dashboard.jsx`'s menu (visible to every role — shop ownership is a capability,
not a role, so there's no reason to hide "Shop" from anyone). It owns its own internal view
state (this app has no react-router anywhere, by design — don't introduce one just for Shop).
`src/pages/shop/AdminShopModeration.jsx` is wired in separately, gated to `role === 'admin'`.

## Known gaps / deliberately out of scope for this first build

- No payout/settlement automation — a shop owner's `upi_id` is captured for reference, but
  actually paying shop owners out is a manual, offline process for now.
- No reviews/ratings.
- No shipping cost calculation — `shipping_paise` exists in the schema but is always `0`;
  shop owners are expected to arrange local pickup/delivery within the diocese community.
- No multi-shop single-payment checkout — a cart spanning shops creates one order (and one
  payment) per shop, not one combined payment.
