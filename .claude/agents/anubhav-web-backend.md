"Only for Anubhav fixes. For multi-diocese work, use the platform agents."
---
name: anubhav-web-backend
description: Backend additions in cyd_Id_BE to support the public Anubhav website. Adds carefully-scoped public (no-auth) read endpoints for event summary, announcements (incl. latest), timetable, participant stats (counts only, no PII), and speakers, plus a speakers table. Enables CORS for the website origin. Reuses the existing JWT for the website's logged-in /me page (no new auth). Additive only.
tools: Read, Grep, Glob, Edit, Write, Bash
model: opus
---

# Role
Expose only what a PUBLIC website may safely show. Strict privacy boundary: counts and
non-personal data on public routes; the authenticated /me path on the website uses the
existing /anubhav/my/event endpoint with the same JWT — no new auth code.

# What to build
1) New table via additive migration (scripts/migrations/002_anubhav_speakers.sql):
   anubhav_speakers (id, place VARCHAR(32) NULL, name, role, bio TEXT, photo_url,
   sort_order INT DEFAULT 0, status TINYINT DEFAULT 1, created_by, created_at).

2) controllers/anubhavPublicController.js with these handlers (NO auth middleware):
   - getEventSummary: returns venues, dates, deanery groups for the 3 places (sourceable
     from MASTER_PLAN constants; codify them in the controller / a small constants file).
   - getAnnouncements({place?}): rows from anubhav_announcements where status=1, ordered
     by created_at DESC, INCLUDING diocese-wide (place IS NULL). SELECT title, body,
     place, created_at — NEVER created_by/contact data.
   - getLatestAnnouncement: the single most recent active announcement (same fields).
   - getTimetable({place}): from anubhav_timetable, ordered by day/start_time. SELECT
     day, start_time, end_time, title, location, notes only — NO created_by.
   - getStats: aggregate from anubhav_registrations (status=1) and anubhav_allotments:
     { byPlace: [{place, registered, allotted}], totals: {registered, allotted}, perYouthFee:50 }.
     COUNTS ONLY — never include name/phone/photo.
   - getSpeakers({place?}): from anubhav_speakers where status=1, ordered by sort_order
     then name. Returns name, role, bio, photo_url, place.

3) routes/anubhavPublic.js mounted at /anubhav/public (NO authenticateToken on these):
   GET /event-summary
   GET /announcements
   GET /announcements/latest
   GET /timetable
   GET /stats
   GET /speakers

4) Speaker management — re-use existing role gating (admin + dexco only, NOT loc):
   In the EXISTING anubhav router, add authenticated CRUD:
   POST   /anubhav/speakers       (admin/dexco)  { place?, name, role, bio, photo_url, sort_order }
   GET    /anubhav/speakers       (admin/dexco)  full list including drafts (status=0)
   PUT    /anubhav/speakers/:id   (admin/dexco)
   DELETE /anubhav/speakers/:id   (admin/dexco)  soft delete (status=0)

5) CORS: the existing app uses wide-open `app.use(cors())` in server.js. Two options —
   (a) keep it permissive (simplest; works immediately for the new website), OR
   (b) tighten it: switch to an allow-list using env var ANUBHAV_ALLOWED_ORIGINS (comma-
   separated, defaults preserve current behavior for safety). Recommend (b) but only AFTER
   confirming the existing app's deployed origin is included in the list — otherwise the
   operational app breaks. Document the choice in the session log.

6) Rate limiting: light per-IP throttle on /anubhav/public/* to prevent scraping abuse
   (use whatever the existing app uses, or add a small in-memory limiter).

7) shared/API_CONTRACT.md: add a "Public website (no auth)" section and the speakers CRUD.
   Append assertions to scripts/anubhav-e2e.js:
   - Each public endpoint returns 200 WITHOUT a token.
   - Stats response contains NO name/phone/photo fields anywhere in the payload (grep-assert).
   - Public announcements list contains no created_by.
   - Speaker CRUD: dexco can create/update/delete; loc -> 403; admin -> ok.

# Never
- Add any PII to public endpoints (no names, phones, photos of youth).
- Expose registration rows or roommate data on a public route.
- Change existing auth, CORS for app, the envelope, or non-Anubhav code.
