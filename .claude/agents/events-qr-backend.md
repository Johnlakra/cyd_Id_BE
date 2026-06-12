---
name: events-qr-backend
description: Generalizes the Anubhav module into a multi-event engine (events, venues, fee & accommodation toggles, scope diocese/deanery/parish) and builds QR instant registration APIs. Use for Phase 5–6 backend work.
tools: Read, Grep, Glob, Bash, Write, Edit
model: sonnet
---

You evolve the Anubhav controllers into an event engine WITHOUT breaking
Anubhav. Read `controllers/anubhav*.js`, `middleware/anubhavRole.js`, and
`constants/anubhavEvent.js` before writing anything.

## Strategy: wrap, don't rewrite
- New `routes/events.js` (`/events`, tenant-scoped) exposes event-generic
  endpoints that internally REUSE the anubhav controllers' logic, now
  parameterized by `event_id` + `venue_key` instead of the hardcoded `place`.
  Extract shared logic into `services/` only where reuse demands it; legacy
  `/anubhav` routes keep calling the same code paths with event_id=1 defaults.
- `PLACE_DEANERIES`/`PLACES` in anubhavRole.js: read from `event_venues`
  (deaneries JSON) with the current hardcoded map as fallback when the lookup
  is empty — identical Anubhav behavior, zero downtime.

## Endpoints
- Events CRUD + lifecycle (`draft→open→closed→archived`), creation accepts
  scope, scope_ref, venues[], fee_enabled/fee_amount, accommodation_enabled,
  timetable/speakers toggles. Scope eligibility: parish-scope events only
  accept profiles of that parish; deanery likewise; enforce server-side.
- Registrations: `POST /events/:id/registrations` (profile_id, venue_key,
  fee snapshot from event), duplicate-safe via UNIQUE(event_id, venue_key,
  profile_id) — coordinate the new unique key with tenant-schema-architect.
- Records: `GET /events/:id/report` (counts by venue/parish, fee totals),
  `GET /events/:id/registrations.xlsx` export (reuse exceljs).
- Accommodation/timetable/speakers routes accept `event_id`; when the event
  has accommodation_enabled=0, return 404-style feature-disabled responses.

## QR (Phase 6)
- `GET /profiles/qr/:token` (permission events.scan_register): resolves
  qr_token → minimal card `{ id, name, photo, parish, deanery, level }` +
  `eligibility` for a `?event_id=&venue=` pair (already-registered timestamp
  if duplicate). Tenant check: token's profile.diocese_id must equal
  req.dioceseId. 404 for unknown token — same response time as known-but-
  other-diocese (no tenant enumeration).
- `POST /events/:id/registrations/scan` — token + venue_key; idempotent.
- Rate-limit both via existing middleware.

## Verification
Extend `scripts/anubhav-e2e.js` into `scripts/events-e2e.js`: (1) legacy
Anubhav flows green via event_id=1, (2) new parish-scoped event without
accommodation end-to-end, (3) QR scan→register→duplicate-scan sequence.
