# Anubhav 2026 — API Contract (shared boundary)

Base URL: same as existing (`https://cyd-id-be.onrender.com`). All new routes are
namespaced under `/anubhav` so nothing existing is touched. All require
`authenticateToken`. Place-scoped routes additionally require `requireEventRole`
(see middleware) and enforce LOC place scoping server-side.

`place` is always one of: `phagwara` | `abohar` | `amritsar`.
Standard response envelope (unchanged from existing app): `{ success, message, data }`.

## Roles / promotion
```
GET   /anubhav/me/role                      -> { event_role, loc_place }
POST  /anubhav/roles/grant   (admin; dexco may grant loc)
                             body: { profile_id|user_id, event_role, loc_place? }
                             // profile_id OR user_id — one is required
GET   /anubhav/roles                         (admin) -> list of granted users
GET   /anubhav/users/search?q=               (admin) -> search profiles by name/phone
                             -> [{ profile_id, profile_name, phone, deanery, parish, photo_url,
                                   user_id|null, username, email, system_role, event_role, loc_place }]
                             // user_id=null means no login account; cannot be promoted
```

## Lookup tables (sourced from canonical DB tables)
```
GET   /anubhav/deanery-parish-map           (any authenticated user)
      -> { success, data: { "<deaneryName>": ["<parishName>", ...] } }
      // Returns ALL 16 deaneries and their parishes from the `deanery`/`parish` DB tables.
      // parish.deanery_id is an integer FK → deanery.id.
      // Frontend filters the map client-side to only the deaneries for the selected place.
      // PLACE_DEANERIES in middleware/anubhavRole.js is the authoritative place→deanery mapping.
```

## Registration (Phase 1)
```
GET   /anubhav/eligible?place=&deanery=&parish=&search=   -> profiles eligible for that place
      // each row now includes `is_independent` (0|1) for the "Independent" badge
POST  /anubhav/registrations         { place, profile_id, chaperone_id? }
GET   /anubhav/registrations?place=&deanery=&parish=      -> registered youth + counts
      // each registration row now includes `is_independent` (0|1) for the badge
DELETE/anubhav/registrations/:id
GET   /anubhav/chaperones?place=&parish=                  -> chaperones for a parish group
POST  /anubhav/chaperones            { place, parish, name, phone, type }  // Sister | Catechist
GET   /anubhav/fees?place=           -> { perYouth:50, byParish:[{deanery,parish,count,total}], byDeanery:[{deanery,count,total}], placeTotal:number, placeCount:number, overall:number, overallCount:number }
```

## Independent entries (Option B)
Independents are stored as ordinary `profile` rows flagged `is_independent=1`. They are
managed only through the endpoints below, NEVER appear on the ID-card `/profiles` list,
and flow through eligible → register → fees → rooming like any other profile (joined on
`profile_id`). They have no `users` login row until promoted.
```
POST  /anubhav/independents          { place, deanery, parish, name, father_name?, phone?,
                                       date_of_birth?, level?, designation?, postal_address?,
                                       photo_url? }
      // required = name, deanery, parish, place. deanery must belong to place.
      // access: admin / dexco / loc (loc restricted to loc_place). 201 -> { profile_id, independent }
      // missing required field -> 400 { message, missing_fields:[...] }

GET   /anubhav/independents?place=&deanery=&parish=&search=
      // access: admin / dexco / loc (place-scoped). Returns ONLY is_independent=1 rows.
      // -> { place, independents:[{ id, name, father_name, date_of_birth, phone, deanery,
      //                             parish, level, designation, postal_address, photo_url,
      //                             is_independent, place, id_card_complete:bool }], count }

PUT   /anubhav/independents/:id       { name?, father_name?, date_of_birth?, phone?, deanery?,
                                        parish?, level?, designation?, postal_address?, photo_url? }
      // all optional; only is_independent=1 rows are editable here. loc place-checked via the row.

DELETE/anubhav/independents/:id
      // soft delete (profile.status=0). 409 { message:"Un-register from Anubhav first, then delete." }
      // if an active anubhav_registration exists for this profile. loc place-checked via the row.

POST  /anubhav/independents/:id/promote   { name?, father_name?, deanery?, parish?, date_of_birth?,
                                            phone?, postal_address?, level?, designation?, photo_url? }
      // ADMIN ONLY (loc/dexco -> 403). Body fields fill any gaps already on the row.
      // ALL ID-card-required fields must end up present (body OR existing row), else:
      //   400 { message, missing_fields:[...] }   // names in API form, e.g. ["father_name","dob"... ]
      // On success (200): atomically flips is_independent->0, fills the ID-card fields,
      // creates a `users` row (role=profile_holder; username = first 4 letters of name +
      // DDMM of DOB; password = phone digits via bcrypt; email <username>@cydidcard.com;
      // numeric suffix on username collision), and links profile.profile_user_id.
      // The profile.id never changes, so existing registrations/allotments keep working.
      // -> { profile, credentials:{ username, password_hint, message } }
      // ID-card-required fields: name, father_name, deanery, parish, date_of_birth, phone,
      //   postal_address, level, designation, photo_url.
```

## Accommodation (Phase 2)
```
POST  /anubhav/buildings             { place, name }
GET   /anubhav/buildings?place=      -> buildings -> floors -> rooms (nested, with capacity & occupancy)
POST  /anubhav/floors                { building_id, name, level }
POST  /anubhav/rooms                 { floor_id, name, capacity }
POST  /anubhav/allotments            { room_id, registration_id }
DELETE/anubhav/allotments/:id
GET   /anubhav/rooming?place=&building_id?&floor_id?&room_id?  -> data shaped for PDF generation
                                     // occupants now include photo_url (for on-screen Room Board avatars)
                                     // occupants also include is_independent (0|1) — from
                                     // p.is_independent AS occupant_is_independent — for the badge

DELETE/anubhav/buildings/:id         (admin or dexco only — LOC → 403)
DELETE/anubhav/floors/:id            (admin or dexco only — LOC → 403)
DELETE/anubhav/rooms/:id             (admin or dexco only — LOC → 403)
      // Cascade order (no orphans, runs in a single DB transaction):
      //   building → allotments under its rooms → rooms → floors → building
      //   floor    → allotments under its rooms → rooms → floor
      //   room     → allotments of the room → room
      // Registrations and profile rows are NEVER touched — affected youth stay
      // registered and simply become un-allotted.
```

## Timetable + Announcements (Phase 3)
```
POST  /anubhav/timetable             { place, day, start_time, end_time, title, location, notes }
GET   /anubhav/timetable?place=      -> ordered items
PUT   /anubhav/timetable/:id
DELETE/anubhav/timetable/:id
GET   /anubhav/timetable/live?place= -> { now, next }

POST  /anubhav/announcements         { place|null, title, body }   // null place = diocese-wide (dexco only)
GET   /anubhav/announcements?place=  -> active announcements for that place + diocese-wide
DELETE/anubhav/announcements/:id
```

## Phase 4 — Participant self-view
```
GET   /anubhav/my/event                      -> self-scoped; no place param; no event-role required
      Resolves: users.id → profile (profile_user_id) → anubhav_registrations (status=1)
      Response: {
        registered: bool,
        // if registered=false, no further fields
        place: "phagwara"|"abohar"|"amritsar",
        venue: null,                          // reserved; not yet in schema
        dates: ["YYYY-MM-DD", ...],           // distinct days from timetable
        room: {
          building: string,
          floor: string,
          room: string,
          roommates: [{ name, parish }]       // name + parish ONLY — no phone (participant-facing)
        } | null,
        timetable: [...],                     // same shape as GET /anubhav/timetable
        live: { now: item|null, next: item|null },
        announcements: [...]                  // place-scoped + diocese-wide combined
      }
```
**Role deassign path:** `POST /anubhav/roles/grant` with `event_role: "none"` is the deassign
path — it clears `loc_place` to `null`. No separate deassign endpoint is needed.

## ID-card profiles — contract changes (Option B)
- `GET /profiles` (the ID-card profile list) now EXCLUDES independents: the query adds
  `AND p.is_independent = 0`. ManageProfiles must use a separate tab that calls
  `GET /anubhav/independents` for the independent list. Create / edit / delete of real
  ID-card profiles are unchanged.
- `GET /profiles/:id/idcard-data` (new) gates ID-card printing. It returns the full
  profile only when every ID-card-required field is present; otherwise:
  `400 { success:false, message, missing_fields:[...] }`. The frontend must call this
  before printing and disable the print button (with a tooltip listing `missing_fields`)
  when `id_card_complete=false` / the call returns 400. The completeness rule is the
  exact same one surfaced as `id_card_complete` on `GET /anubhav/independents` rows.
  ID-card-required fields: name, father_name (col `father`), deanery, parish,
  date_of_birth (col `dob`), phone, postal_address, level, designation, photo_url.

## Public website (NO auth)
Mounted at `/anubhav/public`. **No `authenticateToken`** on any route here — these
power the public marketing/info website. Strict privacy boundary: counts and
non-personal data only. **Never** returns youth name/phone/photo/address/email,
`created_by`, registration rows, or roommate data. A light per-IP rate limiter guards
against scraping (tunable via `ANUBHAV_PUBLIC_RATE_MAX` / `ANUBHAV_PUBLIC_RATE_WINDOW_MS`;
defaults 120 req / 60s). The authenticated `/me` page on the website reuses the existing
`GET /anubhav/my/event` endpoint with the same JWT — no new auth code.

```
GET /anubhav/public/event-summary
    -> { event, perYouthFee:50, places:[{ place, venue, dates:[...], deaneries:[...] }] }
       // Venues/dates/deanery groups for the 3 places (codified in constants/anubhavEvent.js).

GET /anubhav/public/announcements?place=
    -> { place, announcements:[{ title, body, place, created_at }], count }
       // status=1, ordered created_at DESC, INCLUDING diocese-wide (place IS NULL).
       // place is optional; omitted = all active announcements. NEVER created_by.

GET /anubhav/public/announcements/latest
    -> { announcement: { title, body, place, created_at } | null }
       // Single most recent active announcement.

GET /anubhav/public/timetable?place=     (place REQUIRED)
    -> { place, items:[{ day, start_time, end_time, title, location, notes }], count }
       // Ordered by day/start_time. NO created_by. day is integer 1-3 (or date string).

GET /anubhav/public/stats
    -> { byPlace:[{ place, registered, allotted }], totals:{ registered, allotted }, perYouthFee:50 }
       // COUNTS ONLY from anubhav_registrations (status=1) + anubhav_allotments.
       // Never name/phone/photo or any row data.

GET /anubhav/public/speakers?place=
    -> { place, speakers:[{ name, role, bio, photo_url, place }], count }
       // status=1 only, ordered by sort_order then name. place optional;
       // NULL-place speakers always appear. Speakers are presenters, not youth (no PII concern).
```

## Speaker management (admin + dexco only — LOC → 403)
Authenticated CRUD on the speaker catalogue, mounted in the existing `/anubhav` router.
Gated by `requireAdminOrDexco` (admin or dexco; LOC rejected with 403). Public reads of
published speakers use `GET /anubhav/public/speakers` above.
```
POST   /anubhav/speakers       { place?, name, role, bio, photo_url, sort_order }
       -> { speaker }   // status defaults to 1 (published)
GET    /anubhav/speakers       -> { speakers:[...full rows...], count }
       // Full list INCLUDING drafts (status=0).
PUT    /anubhav/speakers/:id   { place?, name?, role?, bio?, photo_url?, sort_order?, status? }
       -> { speaker }   // partial update; status 0/1 toggles publish state
DELETE /anubhav/speakers/:id   -> soft delete (status=0)
```

## Notes for the frontend session
- All list endpoints already return counts where useful; do fee math display only,
  never recompute authoritative totals client-side.
- `/anubhav/rooming` returns everything jsPDF needs (place, building, floor, room,
  occupant name/parish/phone) so PDFs need no extra calls.
- 401 handling, token header, and `baseURL` reuse the existing `apiClient`.

---

## Phase 5 — Generic Events Engine (`/events`)

All endpoints require `authenticateToken` + `tenantScope`. Diocese is resolved
from the caller's JWT; super_admin may override with `?diocese_id=`.
Anubhav 2026 is seeded as `event_id=1`, diocese 1, with 3 pre-seeded venues.

Standard envelope: `{ success, data, message }`.

### Events CRUD
```
GET    /events                         -> { events:[...], count }
       // each row includes venue_count. super_admin may add ?diocese_id=
POST   /events                         (permission: events.create)
       body: { name*, scope?, scope_ref?, description?, start_date?, end_date?,
               fee_enabled?, fee_amount?, accommodation_enabled?,
               timetable_enabled?, speakers_enabled?, status? }
       -> 201 { event }
GET    /events/:id                     -> { event: { ...fields, venues:[] } }
PUT    /events/:id                     (permission: events.manage)
       body: any subset of POST fields
       -> { event }
DELETE /events/:id                     (permission: events.manage)
       // soft delete: sets status='archived'. Returns 200 { message }.
```

### Venue management
```
GET    /events/:id/venues              -> { venues:[], count }
POST   /events/:id/venues             (permission: events.manage)
       body: { venue_key*, name?, address?, start_date?, end_date?, deaneries?:[...] }
       -> 201 { venue }   // 409 if venue_key already exists for this event
PUT    /events/:id/venues/:venueId    (permission: events.manage)
       body: { venue_key?, name?, address?, start_date?, end_date?, deaneries?:[...] }
       -> { venue }
DELETE /events/:id/venues/:venueId   (permission: events.manage)
       -> { message }
```

### Stats
```
GET    /events/:id/stats               -> { event_id, by_venue:[{ venue_key, registrations }],
                                            total_registrations }
       // counts from anubhav_registrations where event_id matches and status=1
```

### Event lifecycle
`status` transitions: `draft` -> `open` -> `closed` -> `archived`.
`DELETE /events/:id` is a soft archive (status='archived'); rows remain queryable.

### Venue deanery DB source (Phase 5 upgrade)
`middleware/anubhavRole.js` now reads `event_venues.deaneries` (JSON array) for
place validation instead of hardcoded constants. Falls back to the hardcoded
`PLACE_DEANERIES` map if the query returns empty or fails — Anubhav behavior
is 100% identical with no downtime.
