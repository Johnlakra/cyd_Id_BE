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

## Registration (Phase 1)
```
GET   /anubhav/eligible?place=&deanery=&parish=&search=   -> profiles eligible for that place
POST  /anubhav/registrations         { place, profile_id, chaperone_id? }
GET   /anubhav/registrations?place=&deanery=&parish=      -> registered youth + counts
DELETE/anubhav/registrations/:id
GET   /anubhav/chaperones?place=&parish=                  -> chaperones for a parish group
POST  /anubhav/chaperones            { place, parish, name, phone, type }  // Sister | Catechist
GET   /anubhav/fees?place=           -> { perYouth:50, byParish:[], byDeanery:[], placeTotal, overall }
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

## Notes for the frontend session
- All list endpoints already return counts where useful; do fee math display only,
  never recompute authoritative totals client-side.
- `/anubhav/rooming` returns everything jsPDF needs (place, building, floor, room,
  occupant name/parish/phone) so PDFs need no extra calls.
- 401 handling, token header, and `baseURL` reuse the existing `apiClient`.
