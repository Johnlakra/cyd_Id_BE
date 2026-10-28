# Payment Integration — Risk Notes & How to Swap Gateways

## The honest summary

The Shop module's default payment gateway is
[**YouPI-PG**](https://github.com/youpi-pg/YouPI-PG), wired in exactly as requested. Its own
README is explicit that it is **"not represented as a certified, bank-approved, NPCI-approved,
audited, or production-ready payment gateway."** Before relying on it for money that matters,
understand what it actually does:

- It does **not** call any bank or NPCI API to confirm a payment happened.
- It detects payment by having an Android "observer" app (or a Gmail/Google-Messages web
  observer) read the **text of the incoming bank SMS/push notification** and match an amount.
- Its own docs say: *"Bank alert parsing can be wrong or delayed"* and *"amount matching is not
  a complete payment identity check."*
- The project's own guidance is to keep to roughly **20 payment attempts/day** per receiving
  account as a conservative experimental limit — not an NPCI rule, but a signal of how far from
  production-hardened this is meant to be used.
- It is self-hosted — there is no shared/public YouPI-PG instance; whoever runs this app has to
  stand up and operate the YouPI-PG server themselves (`YOUPI_BASE_URL` points at it).

**Recommendation:** fine for a low-volume, internal diocese/youth-group marketplace while
testing this out, where a missed or duplicate payment detection is an inconvenience you can fix
by messaging the customer, not a financial/compliance incident. Not something to point real
strangers' money at without independent security review — the README says the same thing.

## What this codebase does to make the best of it

See `services/payments/youpiGateway.js` and `controllers/paymentController.js`
(`handleYoupiWebhook`) for the implementation. Defensive measures in place:

1. **Signature verification over raw bytes.** Every webhook must carry a valid
   `X-Gateway-Signature: sha256=<hmac>` computed over the *exact raw request bytes* (captured
   via the `verify` hook on `express.json()` in `server.js`, stored as `req.rawBody`) using
   `YOUPI_WEBHOOK_SECRET`. A request that fails this check is rejected with 401 before any of
   its fields are trusted.
2. **Idempotency on `deliveryId`.** `shop_payments.delivery_id` is `UNIQUE`; a webhook retry
   (YouPI resends on non-2xx, and reuses the original timestamp) is recognized and acknowledged
   without being re-applied.
3. **Amount cross-check.** The webhook's reported `amountPaise` is compared against the amount
   *we* recorded when the payment was initiated (`shop_payments.amount_paise`), not just trusted
   from the payload. A mismatch is stored (for manual reconciliation) but does **not** mark the
   order paid.
4. **Prices are never taken from the client.** Order totals are computed server-side from
   `shop_products.price_paise` at order-creation time; a payment can only ever be "initiated"
   for the amount the database says the order costs.
5. **Atomic updates.** The payment row and the order row are updated together inside one
   `withTransaction` call — no path leaves one updated and not the other.
6. **A `cod` (cash-on-delivery) gateway exists** as a zero-risk fallback that needs no external
   service — set `PAYMENT_GATEWAY=cod` to disable online payment entirely and have every order
   settle in cash on delivery.

## Swapping to a certified gateway later

Nothing outside `services/payments/` should ever change. Write a new file,
e.g. `services/payments/razorpayGateway.js`, exporting the same shape:

```js
module.exports = {
  name: 'razorpay',
  initiatePayment: async ({ order }) => { /* return whatever the frontend needs to start checkout */ },
  verifySignature: (rawBody, signatureHeader) => { /* true/false */ },
};
```

Register it in `services/payments/index.js`'s `GATEWAYS` map, add a matching webhook route in
`routes/paymentRoutes.js` (mirroring `POST /shop/payments/webhook/youpi`), and flip
`PAYMENT_GATEWAY=razorpay` in `.env`. `paymentController.js`, `orderController.js`, and every
frontend screen are written against the gateway-agnostic contract and don't need to change.

## Required environment variables

See `.env.example`:

```
PAYMENT_GATEWAY=youpi            # or "cod"
YOUPI_BASE_URL=http://localhost:7000
YOUPI_MERCHANT_PUBLIC_KEY=       # safe to expose to the frontend
YOUPI_WEBHOOK_SECRET=            # NEVER expose this - server-side only
```
