# CYD ID + CYD Shop — Flaws Audit & Improvement Plan

> **Read this first if you are an AI assistant (or a person) arriving cold.**
> This file is self-contained: it explains what the two repositories are, what was built, what
> was actually tested, every flaw found, and a phased plan to fix them. The **same file** lives
> at `docs/IMPROVEMENT_PLAN.md` in both repositories, so either repo alone is enough context.
> Line numbers refer to backend commit `b0cebd9` and frontend commit `b124a20` on branch
> `claude/happy-bell-oy6or2`; they will drift as fixes land.

Audit date: 2026-11-17.

---

## 0. TL;DR

1. **Security emergency on `main` (pre-existing, not shop code):** anyone on the internet can
   call `POST /auth/register` with `"role": "admin"` and get a working admin account. Verified
   live against a local copy. Fix this on `main` first, before anything else (§4, S-01).
2. **The UPI payment integration does not work and should not ship as-is.** It was built from a
   summarized README and is wrong against YouPI-PG's real API in three critical ways, and
   YouPI-PG's own README forbids exactly the multi-vendor "collect for many sellers" use this
   marketplace needs. Its `package.json` licence is `"Commercial"`. A payment-model decision is
   needed before more payment code is written (§5).
3. **Order/stock integrity has real, reproducible bugs:** negative stock via duplicate order
   lines, double-restock via parallel cancels, cancelled orders resurrected as paid, paid
   orders cancelled with no refund path (§6).
4. **Frontend:** checkout can create partial/duplicate orders, the cart is shared between users
   on one browser and never refreshes prices, the promised "installable PWA" does not exist, and
   3 of 5 shop tabs are cut off on phones (§8).
5. **No tests, no CI** in either repo. Everything in §6–§9 needs a regression test as it is fixed (§10).

Findings in this document: **71 — critical 4, high 20, medium 30, low 17** (security 6,
payments 8, backend 26, frontend 31).

---

## 1. Context for a cold reader

### 1.1 What the repositories are

| Repo | What it is | Stack |
|---|---|---|
| [`Johnlakra/cyd_Id_BE`](https://github.com/Johnlakra/cyd_Id_BE) | Backend API for the **CYD ID Card Management System** — member profiles and ID cards for the Catholic Youth Directorate, Diocese of Jalandhar (parishes/deaneries, admin / user / profile_holder roles). Deployed at `https://cyd-id-be.onrender.com`. | Node.js, Express 4, MySQL (`mysql2`, raw SQL, no ORM), JWT, Cloudinary |
| [`Johnlakra/CYD_ID`](https://github.com/Johnlakra/CYD_ID) | Frontend for the same system. Deployed via `gh-pages`. | React 18 (Create React App), MUI v5, axios, **no router** (navigation is component state in `src/components/Dashboard.jsx`) |

### 1.2 What the `shop` work is

The branches `shop-and-thoughts` (backend) and `shop-and-thought` (frontend) were empty when work
started — no prior shop code or design existed. A **multi-vendor marketplace ("CYD Shop")** was
then built from scratch on branch **`claude/happy-bell-oy6or2`** in both repos:

- Backend PR: [Johnlakra/cyd_Id_BE#1](https://github.com/Johnlakra/cyd_Id_BE/pull/1)
- Frontend PR: [Johnlakra/CYD_ID#2](https://github.com/Johnlakra/CYD_ID/pull/2)

Product decisions taken with the owner: multi-vendor (any approved member/parish group can run a
shop), shop ownership is a capability stored on the `shops` table rather than a new user role,
web + "installable PWA" now with a Flutter app later, the "thought" feature from the branch name
was dropped, and payments behind a pluggable gateway layer defaulting to **YouPI-PG**
(https://github.com/youpi-pg/YouPI-PG).

### 1.3 Where things are

**Backend (`cyd_Id_BE`)**
- `config/shopDatabase.js` — shop tables (`shops`, `shop_categories`, `shop_products`,
  `shop_product_images`, `shop_addresses`, `shop_orders`, `shop_order_items`, `shop_payments`) +
  self-heal for a stray pre-existing `shops` table. Run with `npm run init-shop-db`.
- `controllers/{shop,product,address,order,payment}Controller.js`, `routes/*Routes.js`,
  `middleware/shopAuth.js`, `middleware/shopValidation.js`
- `services/payments/` — `index.js` (`getGateway()`), `youpiGateway.js`, `codGateway.js`
- `docs/SHOP_MODULE.md` (architecture + API reference), `docs/PAYMENTS.md` (payment notes —
  **partly wrong, see §5**)
- Pre-existing base app: `routes/auth.js`, `controllers/authController.js`,
  `controllers/profileController.js`, `middleware/auth.js`, `middleware/validation.js`,
  `utils/fileUpload.js`

**Frontend (`CYD_ID`)**
- `src/pages/shop/` — `ShopApp.jsx` (internal view router), `Marketplace`, `ShopStorefront`,
  `ProductDetail`, `Cart`, `Checkout`, `PaymentProcessing`, `OrderConfirmation`, `MyOrders`,
  `OrderDetail`, `Addresses`, `BecomeSeller`, `MyShopDashboard`, `AdminShopModeration`
- `src/components/shop/` — `ProductCard`, `ProductFormDialog`, `AddressForm`, `OrderStatusChip`,
  `MoneyText`, `EmptyState`
- `src/api/shopApi.js`, `src/utils/cart.js` (localStorage cart), `src/utils/money.js`
- `docs/design/SHOP_UI_CLAUDE_DESIGN_PROMPT.md`, `docs/design/FLUTTER_APP_BUILD_PROMPT.md`
- Both repos: `.claude/agents/*.md` — five reviewer sub-agent definitions for Claude Code.

### 1.4 What has actually been tested (be precise about this)

| Area | Tested how | Not tested |
|---|---|---|
| Backend API | Run locally against MariaDB 10.11 with scripted HTTP requests (normal flows, races, malformed input, signed webhooks) | MySQL 8 specifically; real Cloudinary; production data |
| Frontend | Production build, Playwright at 1280px and 375px with **all API calls mocked**, plus UI request bodies replayed through the real backend validators | Against the real backend end-to-end; screen readers; GitHub Pages hosting |
| YouPI-PG | Its real source files (README, `openapi.yaml`, `youpi.js`, payment-api routes) read and compared line by line; signed webhooks replayed against our backend | A running YouPI-PG instance (cloning was blocked from the audit sandbox) |
| Migration | `init-shop-db` run on a fresh DB and on a DB with a stray `shops` table | — |

### 1.5 Conventions used below

- **Severity:** `CRIT` (exploitable now or loses money/data), `HIGH`, `MED`, `LOW`.
- **Evidence:** `VERIFIED` = reproduced by running it; `REVIEW` = found by reading code.
- **Effort (rough):** `S` < half a day, `M` 1–2 days, `L` 3+ days.
- IDs: `S-` security, `YP-` payments, `BE-` backend, `FE-` frontend, `C-` FE↔BE contract.

---

## 2. What held up (don't re-test these from scratch)

**Backend:**
- Webhook signature checks: bad, wrong-secret, non-hex and missing signatures all return 401 with no crash, and an empty secret rejects everything.
- A replayed successful webhook (same `deliveryId`) is acknowledged but not re-applied.
- The order price is always re-read from the DB; a client-sent `price_paise: 1` was ignored.
- Racing 10 single-line orders for the last unit of stock gave exactly one success.
- These all returned 403 or 404:
  - another user's orders, addresses or payment status;
  - editing another shop's products or orders;
  - non-admin calls to admin routes.
- Illegal status transitions (e.g. `placed` to `delivered`) are rejected.
- Unapproved shops can't create products, and suspended shops are hidden.
- A SQL-injection string was stored literally, because all queries are parameterised.
- The server didn't crash under any malformed input tested.

**Frontend:**
- The build has zero lint warnings in the shop files.
- The Dashboard role-gating is correct ("Shop Applications" is admin-only).
- The full customer path renders at 1280px and 375px with no page-level horizontal scroll.
- The payment screen degrades gracefully when its script is blocked.
- A double-click on "Place Order" sends one request.
- Money display is correct: paise from the API, rupees in inputs.
- Empty and loading states exist, and there is no `dangerouslySetInnerHTML`.
- All 25 `shopApi.js` calls match the backend's paths, methods and body keys.

---

## 3. Phased plan at a glance

| Phase | Goal | Contents | Where | Effort |
|---|---|---|---|---|
| **0** | Close live security holes | S-01 … S-06 | `main` (both repos), hotfix PRs | S–M |
| **1** | Decide the payment model | §5 decision; then either fix YouPI (YP-*) or replace it | Shop branch | decision + M–L |
| **2** | Order, stock and payment integrity | BE-01 … BE-14 | Backend shop branch | L |
| **3** | API hardening | BE-15 … BE-33 | Backend | M |
| **4** | Frontend correctness and UX | FE-01 … FE-31, C-* | Frontend | L |
| **5** | Engineering foundation | Tests, CI, migrations, envs (§10) | Both | M–L, start alongside Phase 2 |
| **6** | Product features after launch | §11 | Both | ongoing |

Recommended merge order: Phase 0 → (Phase 1 decision) → Phase 2 + 5 together → Phase 3 → Phase 4
→ merge the shop PRs → Phase 6. **Do not merge the shop PRs to `main` before Phase 2 is done.**

---

## 4. Phase 0 — Security on `main` (pre-existing base app)

These affect the live ID-card system today, independent of the shop.

| ID | Sev | Evidence | Finding | Fix | Effort |
|---|---|---|---|---|---|
| S-01 | CRIT | VERIFIED | **Anyone can register as admin.** `POST /auth/register` is unauthenticated (`routes/auth.js:17` on `main`); `middleware/validation.js:41` accepts `role: 'admin'`; `authController.js:18` stores whatever role is sent. The resulting token reached admin-only routes (200). | Ignore `role` from the body and always insert `'user'`. Better still: make `/auth/register` admin-only (members are created by admins via profiles anyway), and add a separate admin-only endpoint to create users with roles. Then audit existing `users` rows for admins nobody created on purpose. | S |
| S-02 | HIGH | VERIFIED | Default admin `admin` / `admin123` is created by `scripts/initDatabase.js` and works. | Rotate the production admin password now. Seed script reads `ADMIN_INITIAL_PASSWORD` from env and refuses a weak default; force a password change on first login. | S |
| S-03 | HIGH | VERIFIED | Deactivated users keep access: `middleware/auth.js` loads the user without checking `status = 1`, so a soft-deleted profile holder's JWT still works for up to 24h. | Add `AND status = 1` to the auth lookup. | S |
| S-04 | HIGH | REVIEW | Profile-holder credentials are guessable: username = first 4 letters of name + `ddmm` of birth date, password = phone number (`profileController.js` ~28–52). Anyone who knows a member's name, birthday and phone can log in as them. | Generate a random one-time password and deliver it out-of-band, or force a password change on first login. Flag accounts still on the default. | M |
| S-05 | HIGH | VERIFIED | No rate limiting (30 bad logins returned 0 responses of 429). CORS is `*`, and there is no `helmet`/HSTS. | `express-rate-limit` on `/auth/*` and `/profile-holder/login`; `helmet()`; CORS allowlist of the real frontend origins. | S |
| S-06 | MED | VERIFIED | Errors leak internals: malformed JSON or an oversize body returns Express's HTML stack trace with server paths. Register also confirms which usernames exist. | Add a final JSON error handler (`{success:false,message}`, no stack outside development) and generic register errors. | S |

---

## 5. Phase 1 — Payments: the decision comes first

### 5.1 What YouPI-PG actually is (from its real source, not a summary)

- **Server-side payment creation is required.** Use `POST /api/v1/payments` with headers `X-Merchant-Id` and `X-Merchant-Key`, and body `{orderId, amount: "499.00" (a string), returnUrl}`. It returns `paymentId` and `checkoutUrl`. Status is available at `GET /api/v1/payments/{id}`, with values `INITIATED, ACTIVE, QUEUED, PROCESSING, SUCCESS, FAILED, EXPIRED, CANCELLED`.
- **The browser SDK only opens a payment that already exists.** `Youpi.pay()` **throws** unless it's given `checkoutUrl` or `paymentId` (`youpi.js` ~line 179: *"Create the payment on your server using trusted order data, then pass checkoutUrl or paymentId to Youpi.pay()"*). The script tag reads `data-merchant-id`, not `data-youpi-key`.
- **Webhook headers:**
  - `X-Gateway-Signature: sha256=<hmac of raw body>`
  - `X-Gateway-Signature-V2`
  - `X-Gateway-Delivery-Id`
  - `X-Gateway-Timestamp`
  - `X-Gateway-Event`
- **Webhook payload:** `event`, `settlementState`, `method`, `orderId`, `amountPaise`, `utr`, `paymentId`, `deliveryId`, `timestamp`.
- **Paid only means reconciled.** A bank SMS alert produces `OBSERVED_SUCCESS` with `settlementState: "NOT_RECONCILED"`, which is *not* settled. An order should be treated as paid **only** on `event === "RECONCILED"` with `settlementState === "RECONCILED"` (README ~375–402 and its sample handlers). That requires an operator to import a bank-statement CSV. Other events are `MANUAL_REVIEW`, `FAILED`, `EXPIRED`, `CANCELLED`, and `SUCCESS` (COD only).
- **Operationally heavy:**
  - the customer completes a WhatsApp OTP step;
  - the operator runs an Android "observer" phone that reads bank SMS;
  - same-amount payments go through a single-slot FIFO queue, so concurrent shoppers wait;
  - the pay window is short (the audit read about 5 minutes).
- **Runtime:** Node `>= 24.22.1`.
- **Licence:** `package.json` says `"license": "Commercial"`, and there is no `LICENSE` file in the repo.
- **Prohibited use (README line 223):** *"Do not use this experimental setup to collect payments on behalf of unrelated merchants, pool or route funds, or represent the software as an authorised payment aggregator."* A multi-vendor marketplace that collects money into one account for many independent sellers is that use case.
- **The "20 payment attempts/day per receiving account"** figure is a stated project guideline; the audit found no code enforcing it.

### 5.2 How our adapter is wrong (YP-*)

| ID | Sev | Evidence | Finding | Fix |
|---|---|---|---|---|
| YP-01 | CRIT | VERIFIED (signed webhook replayed) | Our handler ignores `event`/`settlementState`; a signed **`EXPIRED`** webhook marked a pending order **paid** (`paymentController.js` `handleYoupiWebhook`). | Only `RECONCILED`+`RECONCILED` marks paid; `OBSERVED_SUCCESS` → "awaiting confirmation"; `FAILED`/`EXPIRED`/`CANCELLED` → payment failed (order stays payable or expires); `MANUAL_REVIEW` → flag for admin. |
| YP-02 | CRIT | VERIFIED | A webhook for an order the customer already **cancelled** resurrected it as `placed`/`paid` (stock had already been restocked). | Webhook may only advance orders in `pending_payment`; anything else → record payment as "orphaned/needs refund", alert admin. |
| YP-03 | CRIT | REVIEW + source | `PaymentProcessing.jsx` calls `Youpi.pay({orderId, amount})` which always throws; `initiatePayment` never calls YouPI at all. The UPI flow cannot work. | Backend `initiatePayment` calls `POST /api/v1/payments` with the merchant id/key **server-side**, stores `paymentId`, returns `checkoutUrl`; frontend calls `Youpi.pay({checkoutUrl})` or simply redirects to it. |
| YP-04 | HIGH | REVIEW | `deliveryId` is read only from the body; the header `X-Gateway-Delivery-Id` is ignored. There is no timestamp window, so a captured webhook can be replayed until its delivery id is recorded. | Read the header first; reject if `X-Gateway-Timestamp` is more than ~5 minutes old; consider verifying `X-Gateway-Signature-V2`. |
| YP-05 | HIGH | REVIEW | No server-side status check: we trust webhooks only. | On every webhook and on the "check again" button, confirm with `GET /api/v1/payments/{id}` before changing state. |
| YP-06 | HIGH | REVIEW | Config names are wrong (`YOUPI_MERCHANT_PUBLIC_KEY`; there is no merchant id). The default `YOUPI_BASE_URL=http://localhost:7000` is also plain HTTP, so an HTTPS page would block it as mixed content. | Add `YOUPI_API_URL`, `YOUPI_MERCHANT_ID`, `YOUPI_MERCHANT_KEY` (secret, server only), `YOUPI_CHECKOUT_ORIGIN`, `YOUPI_WEBHOOK_SECRET`, and require HTTPS outside development. |
| YP-07 | HIGH | source | Legal/architecture: single receiving account versus the README's prohibition on collecting for unrelated merchants, plus a commercial licence. | See §5.3. Needs an owner decision, possibly with legal or financial advice. |
| YP-08 | MED | REVIEW | `PAYMENT_GATEWAY=cod` doesn't disable UPI, because `paymentController.js` ~29 and ~82 hardcode `getGateway('youpi')`, and the UI always offers UPI (C-02). | Use `getGateway()` from config, and add `GET /shop/config` returning `{paymentMethods:[...]}` that the UI reads. |

### 5.3 Decision required — payment model

| Option | How it works | Pros | Cons |
|---|---|---|---|
| **A. Direct-to-seller UPI + COD (recommended for launch)** | The platform never touches money. Checkout shows the **shop's own** UPI ID/QR (already stored as `shops.upi_id`) with the exact amount and an order reference. The customer pays in any UPI app and enters the UTR, and the **shop owner confirms receipt** in their dashboard. COD stays as it is. | No pooling, so no aggregator or licensing issue. No gateway to host. Works for every seller from day one. Fits diocese scale. | Manual confirmation by the seller. No automatic proof of payment. Disputes are handled between buyer and seller. |
| **B. Licensed aggregator with marketplace split** (e.g. Razorpay Route, Cashfree Easy Split, PayU Split) | The platform is merchant of record and the provider splits settlements to each seller's linked account. | Automatic confirmation, refunds, real compliance, scales. | KYC for the diocese **and** each seller, fees, more integration work. |
| **C. Keep YouPI-PG** | Fix YP-01…06, run YouPI + an observer phone + daily CSV reconciliation. | Matches the original request. | Prohibited for multi-merchant collection by its own README, commercial licence terms unknown, heavy operations, slow confirmation. Only defensible if the **diocese itself is the sole seller**, which this marketplace is not. |

**Recommendation:** ship **A** (plus COD) for launch and move to **B** if volume justifies it.
Keep the `services/payments/` abstraction, add a `manual_upi` gateway, and either remove the
YouPI adapter or leave it disabled behind config with a pointer to this section. The gateway
interface needs one more method for A/B: `confirmPayment` (seller or webhook) and `refund`.

New data for option A: on `shop_payments` add `payer_utr` (customer-entered), `confirmed_by`,
`confirmed_at`, and statuses `awaiting_confirmation` / `confirmed` / `disputed`. On orders, a
`pending_payment` order the seller has not confirmed within N hours expires (see BE-08).

---

## 6. Phase 2 — Order, stock and payment integrity (backend)

| ID | Sev | Evidence | Finding | Fix | Effort |
|---|---|---|---|---|---|
| BE-01 | HIGH | VERIFIED | **Negative stock via duplicate lines.** Two lines for the same product in one order each pass the stock check separately; stock went to −1. A 5,000-line order drove it to −4,980. `stock_quantity` is a signed INT and there's no cap on lines (`orderController.js` `placeOrder`). | Merge lines by `product_id` before checking; max ~50 lines; `CHECK (stock_quantity >= 0)` (MySQL 8.0.16+) or `UNSIGNED`; decrement with `UPDATE … SET stock = stock - ? WHERE id = ? AND stock >= ?` and fail if `affectedRows = 0`. | S |
| BE-02 | HIGH | VERIFIED | **Double restock.** 5 parallel cancels of one order restocked 5× (stock 9→14). `cancelOrder` checks status, then updates, without locking. | Inside the transaction: `SELECT … FROM shop_orders WHERE id=? FOR UPDATE`, re-check status, then `UPDATE … WHERE id=? AND status IN ('pending_payment','placed')` and only restock if `affectedRows = 1`. | S |
| BE-03 | MED | VERIFIED | **Accept vs cancel race** (8/8 runs): both calls returned 200; final status `accepted` with stock already restocked. Same root cause as BE-02 in `updateOrderStatus`. | Same pattern: conditional UPDATE on expected current status, transaction, row lock. | S |
| BE-04 | HIGH | VERIFIED | **Cancelled orders can still be paid.** `initiatePayment` doesn't check order status; a later webhook then marks it `placed/paid` without re-taking stock (see also YP-02). | `initiatePayment` only for `pending_payment`; webhook only advances `pending_payment`. | S |
| BE-05 | HIGH | VERIFIED | **No refund path.** Cancelling or rejecting a **paid** order leaves `payment_status='paid'`. Reject never restocks at all. | Rejecting or cancelling a paid order sets `payment_status='refund_due'` and alerts the admin and seller. Option A: the seller marks the refund done and enters a refund UTR. Option B: call the provider's refund API. Also restock on reject. Customer self-cancel is allowed only before payment, or before the seller accepts with refund-due. | M |
| BE-06 | HIGH | VERIFIED | **Webhook state bugs:** a mismatched-amount webhook stores its `deliveryId`, so the gateway's corrected retry with the same id is ignored; a late mismatch flips a *successful* payment to `failed`; a second payment with a new `deliveryId` silently overwrites the `utr`; 5 parallel identical webhooks were all processed. | Store each delivery in its own `shop_payment_events` row (unique `delivery_id`). Never downgrade a `success`. Treat a second success as `duplicate_payment` → refund due. Lock the payment row (`FOR UPDATE`) and insert the event first, so the unique constraint arbitrates races. | M |
| BE-07 | MED | VERIFIED | **Duplicate shops per user.** 25 parallel `apply` calls created 3 shops; there is no `UNIQUE(owner_user_id)`. | Add a unique index (clean duplicates first) and catch `ER_DUP_ENTRY` → 400. | S |
| BE-08 | MED | REVIEW | **Unpaid UPI orders hold stock forever** (no expiry). Combined with FE-06, abandoned multi-shop checkouts lock inventory. | Add `expires_at` on `pending_payment` orders and a job (cron or `setInterval` on boot) that cancels them and restocks, using the BE-02 pattern. | S |
| BE-09 | MED | VERIFIED | COD orders stay `payment_status='pending'` forever, even when delivered. | When marked `delivered`, a COD order becomes `paid`, or the seller confirms cash received. | S |
| BE-10 | MED | VERIFIED | **Addresses:** deleting an address used by an order returns 500 (FK), and editing an address rewrites the delivery address of past orders (no snapshot). | Copy the address fields into `shop_orders` at order time (`ship_name`, `ship_phone`, `ship_line1`, …). Soft-delete addresses (`is_deleted`). | S |
| BE-11 | MED | VERIFIED | **Product visibility leak:** `GET /shop/products/:id` returns draft, archived and pending/suspended-shop products to anyone logged in (`productController.js` ~214). It also bumps `views_count` on every hit, which can be spammed. | Return 404 unless the product is `active` in an `approved` shop, or the caller owns it or is an admin. Count views at most once per user per day, or drop the counter. | S |
| BE-12 | LOW | VERIFIED | A shop owner can order from their own shop. | Reject when `shop.owner_user_id === req.user.id`. | S |
| BE-13 | LOW | REVIEW | `out_of_stock` is never set automatically; a sold-out product stays "active" and fails at checkout. | Derive availability from `stock_quantity > 0` in listings, or flip the status in the same transaction that decrements stock. | S |
| BE-14 | LOW | VERIFIED | A **suspended** shop's owner can't progress orders that are already paid (403), so customers are stuck. | Let suspended shops fulfil or refund existing orders, but not create products or take new orders. | S |

**Also add a unified checkout endpoint** (fixes FE-01 from the server side): `POST /shop/checkout` taking the whole cart plus `address_id`, `payment_method` and an `Idempotency-Key` header. It creates all per-shop orders in **one transaction** and returns them; a repeated key returns the same result.

---

## 7. Phase 3 — API hardening (backend)

| ID | Sev | Evidence | Finding | Fix | Effort |
|---|---|---|---|---|---|
| BE-15 | MED | VERIFIED | **Uploads can't work as designed:** 6 base64 images (≤5 MB each) can never fit the 10 MB JSON limit; an 11 MB body returns a 413 HTML stack trace. | Upload images **directly from the browser to Cloudinary** with a signed upload preset (backend endpoint returns a signature); API receives URLs only. Also resize client-side (FE-20). | M |
| BE-16 | MED | VERIFIED | **500s that should be 400s.** If Cloudinary fails, the product row is still created (orphan) and the API returns 500. A bad category id, invalid image data, or stock above INT range also return 500. The `images[]` validator accepts non-image strings like `'not-an-image'` (C-07). | Validate each image (URL or data-URI, type, size). Check the category exists. Cap stock. Upload images **before** inserting, or do it in a transaction with cleanup. | S |
| BE-17 | MED | VERIFIED | **Unbounded input:** `/shop/shops?limit=100000` is accepted, `page=-3` returns 500, four list endpoints have no pagination, a price of ₹1e14 is accepted, and `notes` length is unchecked. | One shared pagination validator (`limit` 1–100, `page` ≥ 1) on every list. Price ≤ ₹10,00,000. `notes` ≤ 500 characters. | S |
| BE-18 | MED | VERIFIED | `PUT /shop/products/:id` requires the full body (`validateProduct`), so partial updates fail (`{stock_quantity: 4}` → 400). Fields can't be cleared either (compare-at price, category; FE-19). | Make it `PATCH` with all-optional validators. An explicit `null` clears a field. | S |
| BE-19 | MED | VERIFIED | Optional fields reject empty strings: `upi_id: ""` fails the regex because `.optional()` skips only `undefined`. "Become a seller" fails whenever UPI is left blank (FE-02). | `.optional({ values: 'falsy' })`, and the frontend strips empty strings. | S |
| BE-20 | MED | VERIFIED | `utils/fileUpload.js:44` logs the **full base64 of every upload**: log flooding, plus member photos in logs. | Delete the log line. | S |
| BE-21 | LOW | REVIEW | The Cloudinary folder is `test_photos` (`fileUpload.js:47`), but `deleteFile` targets `profile_photos/…` (`:106`), so deletes never match and assets are orphaned. | Use one folder per asset type (`cyd/profiles`, `cyd/shops`, `cyd/products`), store the Cloudinary `public_id`, and delete by it. | S |
| BE-22 | LOW | VERIFIED | Raw `<script>` is stored in titles and descriptions. React escapes it, but emails, Flutter WebViews or a future admin export may not. | Trim and strip HTML on input (or allow an explicit list), and always escape on output. | S |
| BE-23 | LOW | REVIEW | `jwt.verify` doesn't pin `algorithms`; every request does a DB user lookup; tokens last 24h with no refresh or revocation. | `algorithms: ['HS256']`. Short access token plus refresh token, or keep 24h but check a `token_version` column so logout and deactivation revoke tokens. | M |
| BE-24 | LOW | REVIEW | Admin shop review has no required reason, notification or audit trail. | Require a reason for reject and suspend. Add an `audit_log` table (who, what, when, before/after) for admin and money actions. | S |
| BE-25 | LOW | REVIEW | Migrations are `CREATE TABLE IF NOT EXISTS` plus a self-heal that adds nullable columns without FKs. There is no versioning, so schema changes can't be rolled out safely. | Adopt numbered SQL migrations with a `schema_migrations` table (`node-pg-migrate`-style runner, or a 50-line custom runner over `/migrations/*.sql`). Convert the current schema to `001_*.sql`. | M |
| BE-26 | LOW | REVIEW | List queries build `LIMIT ${limit} OFFSET ${offset}` by string interpolation (`shopController.listShops`, `productController.listProducts`, `profileController.getProfiles`). This is safe today only because the values are `parseInt`'d, so one refactor away from injection. | Bind them as parameters. `mysql2`'s `execute()` is picky about numeric `LIMIT` placeholders on MySQL 8, so use `pool.query()` for these statements or pass the values as strings. | S |

---

## 8. Phase 4 — Frontend

| ID | Sev | Evidence | Finding | Fix | Effort |
|---|---|---|---|---|---|
| FE-01 | HIGH | VERIFIED | **Partial and duplicate orders at checkout.** `Checkout.jsx` ~81–90 posts one order per shop and clears that shop's cart as it goes. If shop 2 fails, shop 1's order already exists, but the page still shows both shops (stale `useState` snapshot), so "Place Order" again created shop 1's order twice. | Use the backend `POST /shop/checkout` with an idempotency key (§6). Until then: rebuild the groups from the cart after each success, show per-shop results, and never re-post a shop that succeeded. | M |
| FE-02 | HIGH | VERIFIED | "Become a seller" fails whenever UPI is left blank (sends `upi_id: ""`; see BE-19), and the user only sees "Validation failed" (FE-03). | Strip empty strings before sending, and show field errors. | S |
| FE-03 | MED | VERIFIED | Every form error reduces to "Validation failed"; the backend's `errors[]` array is never read. | One `apiErrorMessage(err)` helper that joins `errors[]`; map errors to fields where possible. | S |
| FE-04 | HIGH | VERIFIED | **Cart shared between users.** The single localStorage key `cyd_shop_cart` survives logout, so after logout/login as another member, they saw the previous user's cart. | Key the cart by user id (`cyd_shop_cart:<userId>`) and clear it on logout. Optionally move the cart server-side. | S |
| FE-05 | HIGH | VERIFIED | **Stale prices.** The cart keeps a price snapshot and never refetches: the UI showed ₹100.00 while the server charged ₹250.00. | Revalidate price, stock and status when the cart or checkout opens (one batch endpoint `POST /shop/products/lookup {ids}`), show changes, and show **server** totals. | S–M |
| FE-06 | HIGH | VERIFIED | **Multi-shop UPI pays only the first order.** Two orders were created and payment was initiated once; My Orders shows two "Awaiting Payment" orders and no "Pay Now" button in the list, and stock stays held (BE-08). | Pay-all flow (step through each order), "Pay Now" on list rows, and backend expiry. With payment option A (§5.3) each shop's payment is separate anyway, so design the UI per shop. | M |
| FE-07 | HIGH | VERIFIED | **The "installable PWA" does not exist.** `build/index.html` has no manifest link, no theme colour, and title "React App". There is no service worker (0 occurrences in the bundle). `public/manifest.json` is the untouched CRA default. | Real manifest (name "CYD", icons 192/512 + maskable, `theme_color`, `start_url`, `display: standalone`), linked from `index.html`; Workbox service worker (CRA `cra-template-pwa` approach or `workbox-webpack-plugin`), with an app-shell cache and network-first for API calls; set `<title>` and meta description. | M |
| FE-08 | MED | VERIFIED | **Phones:** at 375px, 3 of 5 shop tabs (and 2 of 5 admin tabs) are clipped with no scroll; the cart title truncates to "Hand…"; product-dialog labels are cut ("Compare-at…", "Stock Quant…"). | `Tabs variant="scrollable" allowScrollButtonsMobile`, or a bottom navigation bar on `xs` (matches the design prompt); full-screen dialogs on `xs`; allow two-line titles. | S |
| FE-09 | MED | VERIFIED | Search has no debounce, so a stale response wins (typing "ab" showed results for "a"). | Debounce by 300 ms and cancel in-flight requests with `AbortController`. | S |
| FE-10 | MED | VERIFIED | The payment screen spins forever when the payment `failed` or the order is `cancelled`. | Stop on terminal states and show "Payment failed — retry / choose COD" or "Order cancelled". | S |
| FE-11 | HIGH | REVIEW | **Script injected from an API-supplied URL** (`PaymentProcessing.jsx` ~22–47), with the JWT in localStorage, so a compromised or misconfigured backend value means full account takeover. | Allowlist the checkout origin (env), require `https:`, prefer redirecting to `checkoutUrl` or an iframe over script injection, and add a Content-Security-Policy. Longer term, move the token to an httpOnly cookie. | S–M |
| FE-12 | MED | VERIFIED | Pre-existing: the 401 handler redirects to `/login`, which 404s in this router-less app, and leaves `user` in storage. | Clear `authToken` **and** `user`, then reload to `/` (or route to the login screen once a router exists). | S |
| FE-13 | MED | VERIFIED | No router: reload drops you to the dashboard, Back leaves the app, and there are no shareable product or order links. | Add `react-router-dom` (`HashRouter`, because of GitHub Pages). Routes: `/shop`, `/shop/p/:id`, `/shop/s/:id`, `/shop/cart`, `/shop/checkout`, `/shop/orders/:id`, `/shop/my-shop`, `/admin/shops`. This is a justified new dependency. It also fixes FE-27. | M |
| FE-14 | MED | VERIFIED | "My Shop" caches the shop status for the whole session, so after admin approval the seller still sees "pending" until a full page reload. | Refetch on tab entry and on window focus. | S |
| FE-15 | MED | VERIFIED | Cart quantity isn't bounded by stock (stock 3, quantity reached 8). | Clamp to known stock and revalidate (FE-05). | S |
| FE-16 | MED | VERIFIED | Accessibility: product and order cards aren't keyboard-focusable (40 Tab presses never reached one), the cart has unlabeled icon buttons, and the shop code has zero `aria-label`s. | Use `CardActionArea`/`ButtonBase` for clickable cards, add `aria-label` to icon buttons, `alt` on images, and a visible focus ring. Check with axe. | S |
| FE-17 | MED | VERIFIED | A new address added during checkout isn't selected: `loadAddresses()` resets the selection to the default, so the order can ship to the old address. | After creating, keep the new id selected (don't override a non-null selection). | S |
| FE-18 | MED | VERIFIED | The address form fails silently when fields are empty (no toast, no error styling). | Required-field validation with `helperText`/`error`. | S |
| FE-19 | MED | VERIFIED | Product edit can't remove all images or clear compare-at price or category, because the PUT body omits them (BE-18). | Send explicit `null`s for cleared fields once PATCH exists. | S |
| FE-20 | MED | REVIEW | No client-side image resize: two 4 MB phone photos come to about 10.7 MiB of JSON, which hits the 10 MB server limit. | Resize to about 1600px longest side, JPEG/WebP ~0.8, in a canvas before upload, and use direct-to-Cloudinary uploads (BE-15). | S |
| FE-21 | MED | VERIFIED | Destructive actions have no confirmation: "Suspend" fires immediately, "Reject" accepts an empty reason, and "Cancel" is offered on paid UPI orders with no refund path (BE-05). | Confirmation dialogs, a required reason for reject and suspend, and hide or relabel cancel for paid orders ("Request cancellation"). | S |
| FE-22 | MED | REVIEW | `baseURL` is hardcoded to the production Render URL (`src/api/apiClient.js`), so every local run hits **production data**. | `process.env.REACT_APP_API_URL` with a `.env.development` pointing to localhost. | S |
| FE-23 | MED | REVIEW | Product detail renders non-active products (paired with BE-11). | Show a "not available" state when the product isn't `active`. | S |
| FE-24 | LOW | REVIEW | Address delete on an address used by an order shows an opaque failure (BE-10). | After BE-10, show a soft-delete confirmation. | S |
| FE-25 | LOW | VERIFIED | `npm test` is red: the CRA default `App.test.js` fails and Jest can't parse ESM `axios`. There are no shop tests. | Fix the Jest config (`transformIgnorePatterns` for axios) and write tests (§10). | S |
| FE-26 | LOW | REVIEW | Dead code (`getShops`, `rupeesToPaise`, `clearCart` unused). There's no shop directory screen and no banner upload UI. | Remove the dead code or build the shop directory and banner upload. | S |
| FE-27 | LOW | REVIEW | Back buttons always go to Marketplace regardless of where you came from. | Fixed by the router (FE-13). | — |
| FE-28 | LOW | REVIEW | Money has no Indian digit grouping (₹100000.00 instead of ₹1,00,000.00), and raw enum strings like `out_of_stock` are shown. | `Intl.NumberFormat('en-IN', {style:'currency', currency:'INR'})`, plus a label map for statuses. | S |
| FE-29 | LOW | REVIEW | `ProductFormDialog` uses `try/finally` with no `catch`, so a failed save is an unhandled promise rejection. | Add a `catch` with a toast. | S |
| FE-30 | LOW | REVIEW | `banner_url` is interpolated unquoted into CSS `url()` (`ShopStorefront.jsx` ~419). | `url("${encodeURI(banner_url)}")`, or an `<img>` with `object-fit`. | S |
| FE-31 | LOW | REVIEW | Payment polling has no backoff, and the 2-minute timeout was never exercised. | Back off 3 s → 10 s and cover it in an e2e test. | S |

### Contract mismatches (FE ↔ BE)

| ID | Mismatch | Owner |
|---|---|---|
| C-01 | Blank `upi_id` rejected | BE-19 + FE-02 |
| C-02 | `PAYMENT_GATEWAY=cod` doesn't disable UPI; UI has no config endpoint | YP-08 |
| C-03 | Product detail serves non-active products | BE-11 + FE-23 |
| C-04 | Product update requires the full body and can't clear fields | BE-18 + FE-19 |
| C-05 | `errors[]` never displayed | FE-03 |
| C-06 | Address delete vs FK; no address snapshot on orders | BE-10 + FE-24 |
| C-07 | `images[]` accepts non-image strings | BE-16 |
| C-08 | No refund/restock on cancel/reject of paid orders | BE-05 + FE-21 |
| C-09 | No expiry of `pending_payment` orders | BE-08 + FE-06 |
| C-10 | `GET /shop/shops` has no UI | FE-26 |

---

## 9. Documentation that is now wrong

| File | Problem | Fix |
|---|---|---|
| `cyd_Id_BE/docs/PAYMENTS.md` | Describes the YouPI integration as working and lists wrong env vars and webhook fields | Rewrite after the §5.3 decision (a warning banner now points here) |
| `CYD_ID/docs/SHOP_MODULE.md` "UPI payment flow" | Describes `window.Youpi.pay({orderId, amount})`, which throws | Same (banner added) |
| `.claude/agents/payment-integration-guardian.md` (both repos) | Its checklist encodes the wrong YouPI contract | Update to the real contract or the chosen gateway |
| `CYD_ID/docs/design/FLUTTER_APP_BUILD_PROMPT.md` | Points the Flutter build at the broken payment flow | Update once §5.3 is decided |
| `CYD_ID/docs/design/SHOP_UI_CLAUDE_DESIGN_PROMPT.md` | The payment-processing screen assumes a gateway | Add the "pay seller's UPI ID + enter UTR" screens if option A is chosen |

---

## 10. Phase 5 — Engineering foundation

1. **Backend tests:** Jest + `supertest` against a real MySQL 8 in Docker (`docker compose` with `mysql:8`). Every VERIFIED finding above becomes a regression test, especially these races:
   - parallel cancels (BE-02);
   - accept vs cancel (BE-03);
   - duplicate lines (BE-01);
   - parallel webhooks (BE-06);
   - parallel shop applications (BE-07).
2. **Frontend tests:**
   - fix Jest (FE-25);
   - React Testing Library for cart and checkout logic;
   - **Playwright e2e** with a mocked API for the flows the audit walked: browse → cart → checkout → payment → orders → my-shop → admin, at 375px and 1280px.
3. **CI (GitHub Actions)** in both repos: lint, test and build on every PR, plus `npm audit --omit=dev`. The backend also runs the migration against MySQL 8 in CI.
4. **Environments:** `.env.example` complete in both repos, a staging backend and DB separate from production, and the frontend API URL from env (FE-22).
5. **Migrations:** versioned SQL (BE-25). Never edit production schema by hand again.
6. **Observability:** structured logs (`pino`) with request ids, an error tracker (e.g. Sentry), and alerts on webhook failures and refund-due orders.
7. **Backups:** confirm automated MySQL backups and a tested restore. The soft-delete design assumes this.
8. **Dependency hygiene:** `multer@1.x` has known vulnerabilities (npm warns at install). It's unused by the shop, so upgrade to 2.x or remove it.

---

## 11. Phase 6 — Product improvements (after the above)

- **Notifications:** sellers learn about new orders only by refreshing. Add WhatsApp, SMS or email notifications (new order, accepted, shipped, payment confirmed, refund due) and in-app badges.
- **Seller tools:** sales summary, low-stock alerts, CSV export of orders, banner upload, bulk stock edit.
- **Buyer tools:** order tracking timeline (designed in the UI prompt), reorder, wishlist, reviews and ratings (moderated).
- **Discovery:** shop directory by parish/deanery, category landing pages, better search (MySQL `FULLTEXT` on title and description).
- **Admin:** dashboard (GMV, orders by status, refunds due), user/shop audit log viewer, category management UI.
- **Flutter app:** start only after Phases 1–4 so the app is built on a stable API. Update the Flutter prompt (§9) first.

---

## 12. How to use this document in a chat

Useful prompts for a Claude chat that has this repository connected:

- *"Explain finding BE-02 and show me the exact code change to fix it."*
- *"Write the Phase 0 hotfix for S-01 and S-03 as a patch against `main`."*
- *"Help me decide between payment options A and B in §5.3 for a diocese youth marketplace."*
- *"Turn Phase 2 into GitHub issues, one per finding, with acceptance criteria."*
- *"Write the Jest + supertest regression test for BE-01."*

When a finding is fixed, update its row with the commit or PR link rather than deleting it,
so the history stays readable.
