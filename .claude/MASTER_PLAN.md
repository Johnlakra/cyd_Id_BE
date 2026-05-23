# Anubhav Retreat 2026 — Event Management Module: Master Plan

> Single source of truth for the Anubhav 2026 feature work. Both the backend
> (`cyd_Id_BE`) and frontend (`CYD_ID`) Claude Code sessions read this file first.
> **Work happens on a new branch in each repo. Existing design and functionality
> must remain 100% unchanged — everything here is ADDITIVE.**

---

## 1. Context

The Diocese of Jalandhar Youth Commission runs the **Anubhav Retreat for Youth 2026**.
Youth already exist in the CYD ID system (table `profile`, keyed by `deanery` + `parish`).
The retreat runs as **three separate place-batches**, each at its own venue, dates, and
set of deaneries:

| Place key | Venue                              | Dates           | Deaneries covered |
|-----------|------------------------------------|-----------------|-------------------|
| `phagwara`| St. Joseph's Catholic Church, Phagwara | 02–04 Jun 2026 | Hoshiarpur, Tanda, Jalandhar Cantt., Jalandhar City, Kapurthala, Sahnewal, Ludhiana |
| `abohar`  | St. Joseph's Catholic Church, Abohar   | 04–06 Jun 2026 | Moga, Muktsar, Ferozpur |
| `amritsar`| St. Francis Church, Amritsar           | 06–08 Jun 2026 | Tarn Taran, Amritsar, Ajnala, Fatehgarh Churian, Dhariwal, Gurdaspur |

Arrival 4:00 PM, departure 11:00 AM. Registration fee **₹50 per youth**.
Each parish may send ~15 youth (soft cap — warn, do not block). A Sister/Catechist
(chaperone) accompanies each parish's group.

### Hard rule: everything is partitioned by `place`
Registrations, buildings/floors/rooms, room allotments, timetable items, and
announcements **all belong to exactly one place** (`phagwara` | `abohar` | `amritsar`)
and must never bleed across places in any query, view, or PDF.

---

## 2. Roles

Existing roles (unchanged): `admin`, `user`, `profile_holder`.

New event-scoped capabilities (added without breaking existing login):

| Capability | Who | Scope | Powers |
|-----------|-----|-------|--------|
| **DEXCO** | Youth promoted by admin | All three places | Full event management: register youth, create/allot rooms, build timetable, post announcements, generate PDFs. |
| **LOC** (Local Organising Committee) | Youth promoted by admin or DEXCO | **One place only** | Assist within their assigned place: register youth, allot rooms, view timetable/announcements. Cannot manage other places. Cannot post diocese-wide announcements. |

**Implementation:** do NOT create parallel login accounts. A youth keeps their
`profile_holder` account and gains event powers via two new columns on `users`:
- `event_role` ENUM('none','loc','dexco') DEFAULT 'none'
- `loc_place` VARCHAR(32) NULL  — only meaningful when event_role='loc'

Admin promotes/demotes. DEXCO may promote a youth to LOC for a given place.
This avoids the privilege-escalation risk of self-enabling and keeps one identity per youth.

---

## 3. Feature scope & build phases

### Phase 1 — Registration + Fees (must-have for June)
- Register an already-existing youth into a place-batch (search by deanery → parish → youth).
- Chaperone (Sister/Catechist) entry per parish group.
- Soft 15-per-parish warning (configurable, non-blocking).
- Live fee calculation: ₹50 × registered youth, with totals per parish, per deanery,
  per place, and overall.
- **Paired View/Manage page**: "Registered Youth" list per place with filters, counts,
  fee totals, and un-register.

### Phase 2 — Accommodation
- Create **Building → Floor → Room** hierarchy per place (capacities per room).
- Allot registered youth (same or different parish) into rooms; live occupancy/capacity.
- **Paired View/Manage page**: room board per place showing occupancy.
- **PDF generation (pure frontend, jsPDF — must work in mobile browsers):**
  per-room sheet, per-floor sheet, per-building sheet, and full-place rooming list.

### Phase 3 — Timetable + Announcements + Live view
- Timetable items per place (day, start/end, title, location, notes).
- **Paired View/Manage page**: timetable per place.
- "Live Now / Up Next" view every logged-in youth sees on login for their place.
- Announcements per place (and diocese-wide for DEXCO) shown as a front-page banner.

> Every CREATE surface in all phases ships with its paired VIEW/MANAGE surface in the
> same PR. No create-only screens.

---

## 4. Data location decision
**Server-side (new MySQL tables + Express APIs).** Rationale: multiple DEXCO/LOC users
register and allot rooms concurrently across devices; localStorage cannot keep room
occupancy consistent or survive a device switch. PDFs remain pure-frontend (jsPDF) so
mobile browsers render them with no server PDF dependency — the API only returns JSON.

See `backend/migrations/001_anubhav_event_module.sql` for the additive schema.

---

## 5. Repo split & how the two sessions coordinate
- **Branch name (both repos):** `feature/anubhav-2026-event-module`
- Backend session owns: migration, routes, controllers, middleware, API contract.
- Frontend session owns: new pages, sidebar entries, PDF rendering, role-gated views.
- The **shared API contract** (`shared/API_CONTRACT.md`) is the interface boundary.
  Backend implements it; frontend consumes it. Neither edits existing endpoints.
- The **Manager agent** (`MANAGER_AGENT.md`) is run in whichever repo you're in; it
  reads this plan + the contract, decides the next task, and dispatches the right
  specialist agent. It keeps a session log so the two repos stay in step.

## 6. Non-negotiables (enforced by every agent)
1. New branch only; never push to `main`/`master`.
2. Additive only — do not alter existing tables, endpoints, components, or styles.
3. Match existing MUI v5 look exactly (default theme, existing card/drawer patterns).
4. Every place-scoped query is filtered by `place`; no cross-place leakage.
5. Every create page ships with its view/manage page.
6. PDFs are client-side jsPDF, verified to work on mobile-width viewports.
7. Read-before-write: analyze current code before editing (repo-analyzer agent).
