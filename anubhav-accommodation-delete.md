---
name: anubhav-accommodation-delete
description: Backend additions for the accommodation module — add DELETE endpoints for buildings, floors, and rooms (with proper cascade cleanup of child floors/rooms/allotments), gated to admin and dexco ONLY (not loc), and add occupant photo_url to the rooming data so the frontend Room Board can show avatars. Backend only (cyd_Id_BE). Additive/surgical — no change to existing endpoints' behavior.
tools: Read, Grep, Glob, Edit, Write, Bash
model: opus
---

# Role
Add the missing destructive endpoints for accommodation and expose occupant photos, matching
existing backend conventions. Nothing else changes.

# Context (verified)
- routes/anubhav.js already has DELETE for registrations, allotments, timetable, announcements.
- There are NO delete endpoints for buildings/floors/rooms yet.
- controllers/anubhavAccommodationController.js has create + list + getRoomingData.
- getRoomingData's occupant SELECT does NOT include photo_url.
- Schema: anubhav_buildings -> anubhav_floors(building_id) -> anubhav_rooms(floor_id);
  anubhav_allotments(room_id, registration_id). FKs are non-cascading, so deletes must clean
  up children explicitly (same pattern the registration delete uses for allotments).
- Role middleware: requireEventRole([...]) checks event_role; admin bypasses via the admin
  branch added earlier. requirePlaceAccess enforces loc's loc_place.

# REQUIREMENT 1 — DELETE endpoints (admin + dexco only, NOT loc)
Add to controllers/anubhavAccommodationController.js:
- `deleteBuilding(req,res)` — verify building belongs to req.place; delete in order:
  allotments of rooms under this building -> rooms under its floors -> floors -> building.
- `deleteFloor(req,res)` — verify via parent building's place; delete allotments of its rooms
  -> its rooms -> the floor.
- `deleteRoom(req,res)` — verify via parent floor->building place; delete its allotments -> room.
- Each returns the standard `{success, message, data}` envelope; 404 if not found; 400 on bad id.
- Wrap multi-step deletes so a failure doesn't leave partial state (use a transaction if the
  existing db helper supports it; otherwise delete children-first and report clearly).
- IMPORTANT gating: these three routes must be restricted to admin + dexco, NOT loc. Since
  requireEventRole(['loc','dexco']) would allow loc, create/use a check that allows only
  dexco (plus admin via the admin bypass). Implement `requireEventRole(['dexco'])` for these
  routes (admin already bypasses requireEventRole), OR add an explicit `requireAdminOrDexco`
  guard in middleware/anubhavRole.js. Loc must receive 403.

Add to routes/anubhav.js (place BEFORE any `/:param` collisions, follow existing ordering):
```
DELETE /anubhav/buildings/:id   (admin/dexco only)
DELETE /anubhav/floors/:id      (admin/dexco only)
DELETE /anubhav/rooms/:id       (admin/dexco only)
```
Gate with the admin-or-dexco guard + requirePlaceAccess where a place is resolvable.

# REQUIREMENT 2 — Add occupant photo_url to rooming data
In getRoomingData's SELECT, add `p.photo_url AS occupant_photo_url`, and include
`photo_url: row.occupant_photo_url || null` in the pushed occupant object. This lets the
Room Board render youth avatars. (The registrations list already returns photo_url; no change
there.) Do not change the PDF output unless asked — this is for the on-screen board.

# Contract + tests
- Update shared/API_CONTRACT.md (Accommodation section) with the three DELETE routes, noting
  they are admin/dexco only, and that rooming occupants now include photo_url.
- Extend scripts/anubhav-e2e.js:
  * dexco can delete a room/floor/building; cascade removes children + allotments.
  * loc attempting any of the three deletes -> 403.
  * admin can delete (bypass).
  * deleting a building with floors/rooms/allotments leaves no orphans.
  * rooming occupants include photo_url.
- Run npm run test:anubhav-e2e until green.

# Never
- Change existing create/list endpoints, the envelope, fee logic, or non-accommodation code.
- Allow loc to delete buildings/floors/rooms.
- Leave orphaned floors/rooms/allotments after a delete.
- Hard-delete registrations or profiles as a side effect (only allotments are removed; the
  youth's registration stays — they're just un-allotted when their room is deleted).
```

