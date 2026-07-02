# CYD Platform — Multi-Diocese Master Plan

> Single source of truth for converting the CYD ID system (Diocese of Jalandhar)
> into a **multi-diocese youth platform**. Both repos read this file first.
> Branch in each repo: `feature/multi-diocese-platform`.
> **HARD RULE: existing Jalandhar design, flows, and functionality remain 100%
> unchanged. Everything is ADDITIVE. Legacy data is backfilled, never migrated
> destructively.** This mirrors the Anubhav 2026 module discipline.

---

## 0. Current State (verified from repos, branch `feature/anubhav-2026-event-module`)

**Backend** (`cyd_Id_BE` — Node/Express/MySQL):
- Routes: `/auth`, `/profiles`, `/profile-holder`, `/anubhav`, `/anubhav/public`
- Auth: JWT (`middleware/auth.js`), roles `admin | user | profile_holder`,
  additive `event_role` (`none|loc|dexco`) + `loc_place` on `users`
- `middleware/anubhavRole.js` hardcodes `PLACES` and `PLACE_DEANERIES` (Jalandhar)
- Tables: `users`, `profile` (**MyISAM — no FKs, app-enforced integrity**),
  `deanery`, `parish`, `anubhav_chaperones`, `anubhav_registrations` (keyed by
  `place`, `UNIQUE(place, profile_id)`), `anubhav_buildings/floors/rooms/
  allotments/timetable/announcements/speakers`, independent entries via
  `profile.is_independent=1`
- Login at `POST /auth/login` (NOT `/api/auth/login`)

**Frontend** (`CYD_ID` — React 18 / MUI v5):
- `IDCard.jsx`: 3 hardcoded backgrounds (Parish/Deanery/Dexco .jpg) selected by
  `data.level`, absolutely-positioned fields in mm, exported via `html-to-image`
- Static deanery/parish JSON is the FE source of truth for dropdowns
- Pages: ManageProfiles (+ Independent Entries tab), IDCardTabs, RegisterYouth,
  RoleManagement, full Anubhav suite (Registration, Accommodation, Timetable,
  Speakers, Announcements, RoomBoard, PDFs)

**Constraints carried forward**
- 12-hour time display everywhere
- Approved design skills (taste-skill / impeccable / emilkowalski) used
  conservatively, inside existing MUI design language, on NEW screens only
- Username generation: 4 letters of name + DDMM of DOB; password = phone
  (bcrypt, 12 rounds)

---

## 1. Target Architecture (six pillars)

### Pillar A — Multi-tenancy (dioceses)
```sql
CREATE TABLE dioceses (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(60) NOT NULL UNIQUE,        -- e.g. 'jalandhar'
  logo_url TEXT NULL,
  contact_email VARCHAR(150),
  contact_phone VARCHAR(30),
  address TEXT,
  settings JSON NULL,                       -- feature flags, defaults
  status ENUM('pending','active','suspended') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```
- Add `diocese_id INT NULL` (additive) to: `users`, `profile`, `deanery`,
  `parish`, every `anubhav_*` table, and all new tables.
- **Backfill**: seed `dioceses(id=1, slug='jalandhar', status='active')`, set
  `diocese_id=1` on every existing row. `NULL` is treated as 1 in legacy-compat
  reads so untouched code paths keep working.
- **Tenant resolution**: `diocese_id` claim added to JWT at login (existing
  tokens without the claim resolve to 1). New middleware `tenantScope` attaches
  `req.dioceseId`; every NEW query filters by it. Legacy Jalandhar endpoints
  untouched but pass through the same value transparently.
- **New platform role: `super_admin`** (above `admin`). `admin` becomes
  diocese-scoped. `super_admin` approves diocese registrations, can impersonate
  scope for support, manages the platform. Existing Jalandhar admin keeps
  working identically (its scope is diocese 1).

**Diocese onboarding flow** (new public screens, designed with approved skills):
1. `POST /platform/dioceses/register` — public form (diocese name, contact,
   logo) → `status='pending'`
2. `super_admin` approves → diocese admin user auto-created (existing
   username/password convention), welcome state
3. **Setup wizard** (first login): ① add deaneries & parishes (CRUD or Excel
   import) → ② upload ID card backgrounds / pick template → ③ invite roles →
   ④ done — full functionality instantly live.

### Pillar B — Org structure + Excel bulk import
- Deanery/parish become fully DB-driven **per diocese** with admin CRUD
  (the canonical map endpoint pattern already exists — extend it with
  `diocese_id`). Jalandhar's static JSON is seeded into the DB; the FE keeps
  the static JSON for diocese 1 untouched, all other dioceses read the API.
- **Excel import wizard** (3 steps, used for youth profiles AND org structure):
  1. **Upload** `.xlsx/.csv` (backend parse with `exceljs`; FE offers a
     downloadable pre-formatted template: Name, Father, Mother, DOB, Date of
     Baptism, Phone, Postal Address, Deanery, Parish, Qualification,
     Designation, Level, Involvement, Photo URL optional)
  2. **Map columns** — auto-detect headers (fuzzy match), manual override per
     column, choose defaults for missing columns
  3. **Validate & preview** — per-row errors (missing name/DOB, bad date,
     duplicate phone within file or DB, unknown deanery/parish with
     "create it" option) → commit valid rows in a transaction; failed rows
     downloadable as an errors .xlsx
- `import_jobs` table logs every import (who, when, counts, error file).
- Imported youth = normal `profile` rows; promotion to login users follows the
  existing independent-entry promotion convention. Optional "auto-create user
  accounts" toggle at commit time.

### Pillar C — Permission engine (granular RBAC)
```sql
CREATE TABLE permissions (              -- global catalog, seeded
  id INT PRIMARY KEY AUTO_INCREMENT,
  perm_key VARCHAR(100) NOT NULL UNIQUE, -- 'profiles.create', 'ui.tab.accommodation'
  module VARCHAR(50) NOT NULL,           -- 'profiles','events','idcards','org','platform'
  label VARCHAR(150) NOT NULL,
  description TEXT
);
CREATE TABLE roles (
  id INT PRIMARY KEY AUTO_INCREMENT,
  diocese_id INT NOT NULL,
  role_key VARCHAR(60) NOT NULL,         -- 'admin','parish_president','event_loc',custom...
  label VARCHAR(100) NOT NULL,
  is_system TINYINT DEFAULT 0,
  UNIQUE KEY uniq_diocese_role (diocese_id, role_key)
);
CREATE TABLE role_permissions (role_id INT, permission_id INT, PRIMARY KEY(role_id, permission_id));
CREATE TABLE user_roles (user_id INT, role_id INT, scope_type ENUM('diocese','deanery','parish','event') DEFAULT 'diocese', scope_ref VARCHAR(100) NULL, PRIMARY KEY(user_id, role_id));
CREATE TABLE user_permission_overrides (user_id INT, permission_id INT, effect ENUM('allow','deny') NOT NULL, PRIMARY KEY(user_id, permission_id));
```
- **Resolution order**: super_admin → all; diocese admin → all within diocese;
  else union(role perms) + overrides, `deny` wins. Result cached per request;
  `/auth/me/permissions` returns the flat key list for the FE.
- **Two kinds of keys**: `resource.action` (API enforcement via
  `requirePermission('events.create')`) and `ui.*` keys (`ui.tab.X`,
  `ui.button.Y`) for tab/button visibility — this is how admin grants "even a
  particular button" cleanly without inventing per-component logic.
- **FE**: `usePermissions()` hook + `<Can perm="...">` wrapper. Existing
  role checks remain; `<Can>` wraps NEW UI only. **Permission Matrix screen**:
  roles × permissions grid grouped by module, checkbox toggles, search,
  "duplicate role", per-user override drawer. Parish-president independent-entry
  rights become simply `independents.create` granted at parish scope.
- Existing roles map to seeded system roles so current behavior is identical.

### Pillar D — ID Card Template Designer
```sql
CREATE TABLE id_card_templates (
  id INT PRIMARY KEY AUTO_INCREMENT,
  diocese_id INT NOT NULL,
  level VARCHAR(40) NOT NULL,             -- 'parish','deanery','dexco', custom levels
  name VARCHAR(100) NOT NULL,
  background_url TEXT NOT NULL,           -- uploaded PNG/JPG (Cloudinary, existing util)
  width_mm DECIMAL(6,2) DEFAULT 146.30,
  height_mm DECIMAL(6,2) DEFAULT 221.80,
  layout_json JSON NOT NULL,
  is_default TINYINT DEFAULT 0,
  status TINYINT DEFAULT 1,
  created_by INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```
`layout_json` element schema:
```json
{ "elements": [{
    "id": "el_1", "type": "text|photo|qr|logo|static_text|line",
    "field": "name|father|mother|dob|parish|deanery|phone|designation|...",
    "x": 10.0, "y": 42.5, "w": 58, "h": 67,          // mm
    "fontFamily": "inherit", "fontSize": 14, "fontWeight": 600,
    "color": "#1a1a1a", "align": "center", "rotation": 0,
    "borderRadius": 14, "border": "1px solid #8D8D8D",
    "label": null, "uppercase": true
}]}
```
- **Designer UI** (new page, `react-rnd` — drag + resize absolutely-positioned
  DOM boxes over the background image; DOM-based on purpose so the designer and
  the final card share ONE render path through the existing `html-to-image`
  pipeline). Features: zoom, snap-to-grid + alignment guides, field palette
  (every profile field + photo + QR + diocese logo + free static text), property
  panel (font size/weight/color/align/radius), layer order, live preview with a
  sample profile, undo (keep last N states in memory), save/duplicate/set-default
  per level. Konva/Polotno rejected: heavier, second render path = drift risk.
- **Template gallery**: 3–4 seeded starter layouts ("Classic", "Modern",
  "Minimal", "Photo-left") where the diocese only uploads a background and logo
  — exactly your "template option" idea. Plus blank-canvas mode.
- **Render path**: `IDCard.jsx` gets a template-driven branch — if a template
  exists for (diocese, level) render from `layout_json`; else fall back to the
  legacy hardcoded layout. **Jalandhar's three current layouts are transcribed
  into seed templates so output is pixel-identical**; legacy branch stays as
  safety net.

### Pillar E — Generalized Events module (+ fees, optional accommodation)
```sql
CREATE TABLE events (
  id INT PRIMARY KEY AUTO_INCREMENT,
  diocese_id INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  scope ENUM('diocese','deanery','parish') NOT NULL DEFAULT 'diocese',
  scope_ref VARCHAR(100) NULL,            -- deanery/parish name when scoped
  description TEXT, start_date DATE, end_date DATE,
  fee_enabled TINYINT DEFAULT 0, fee_amount INT DEFAULT 0,
  accommodation_enabled TINYINT DEFAULT 0,
  timetable_enabled TINYINT DEFAULT 1, speakers_enabled TINYINT DEFAULT 1,
  status ENUM('draft','open','closed','archived') DEFAULT 'draft',
  created_by INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE event_venues (               -- generalizes Anubhav's 'place'
  id INT PRIMARY KEY AUTO_INCREMENT,
  event_id INT NOT NULL,
  venue_key VARCHAR(40) NOT NULL,         -- 'phagwara' etc. for legacy
  name VARCHAR(150), address TEXT,
  start_date DATE, end_date DATE,
  deaneries JSON NULL,                    -- replaces hardcoded PLACE_DEANERIES
  UNIQUE KEY uniq_event_venue (event_id, venue_key)
);
```
- Add `event_id INT NULL` (additive) to `anubhav_registrations`, `_buildings`,
  `_timetable`, `_announcements`, `_speakers`, `_chaperones`. **Backfill**: seed
  `events(id=1, 'Anubhav 2026', diocese_id=1, accommodation_enabled=1,
  fee_enabled=1, fee_amount=50)` + its 3 venues with their deanery lists; set
  `event_id=1` everywhere. `PLACE_DEANERIES` middleware reads from
  `event_venues` with the hardcoded map as fallback — Anubhav behaves
  identically.
- Event creation wizard: scope → venues (1..n) → toggles (fee + amount,
  accommodation, timetable, speakers) → publish. Disabled modules simply hide
  their tabs (`ui.tab.*` permission keys do the gating). Event records/history
  page: per-event participant lists, fee collection totals, export to xlsx.

### Pillar F — QR instant registration
- Add `qr_token CHAR(36) NULL UNIQUE` to `profile` (UUID v4, generated on
  promotion/creation; backfill script for existing profiles).
- QR payload: `CYD:<diocese_slug>:<qr_token>` (opaque token, no PII; server
  verifies, so no signature complexity needed — simplest legal/safe option).
- QR surfaces: ① a `qr` element type in the ID card template (rendered with
  the `qrcode` npm lib client-side), ② profile-holder dashboard "My QR" card.
- **Scan-desk page** (permission `events.scan_register`): camera scanning via
  `html5-qrcode` (free, no backend dependency) → `GET /profiles/qr/:token`
  (returns name/photo/parish/eligibility for the selected event+venue) → big
  confirm card → `POST /events/:id/registrations` → success flash, ready for
  next scan in <2s. Duplicate scan shows "already registered" with timestamp.
  Manual phone-number fallback search on the same screen.

---

## 2. Phases (each = checkpoint; verify before proceeding)

| Phase | Scope | Exit criteria | Status |
|---|---|---|---|
| 0 | Baseline: run existing E2E (`scripts/anubhav-e2e.js`), snapshot key screens, record current behavior | Baseline doc committed | ✅ DONE 2026-06-12 (`ca6d5ab`) — 181/181 baseline |
| 1 | Multi-tenancy core: dioceses, backfill, JWT claim, tenantScope, super_admin, onboarding + approval + setup wizard skeleton | New diocese can register & be approved; Jalandhar untouched (E2E green) | ✅ BE DONE 2026-06-12 (`ece5196`) — smoke 17/17, E2E 181/181 |
| 2 | Org structure CRUD + Excel import wizard (org + youth) | Fresh diocese imports an xlsx of youth; profiles + optional users created | ✅ BE DONE 2026-06-12 (`0af53a3`) — smoke 35/35, E2E 181/181 |
| 3 | Permission engine + matrix UI + ui.* gating on new screens | Admin can grant/revoke any permission incl. a specific tab/button; legacy roles unchanged | ✅ BE DONE 2026-06-12 (`7d4d0aa`) — smoke 38/38, E2E 181/181; matrix UI = FE repo |
| 4 | ID card designer + templates + gallery + Jalandhar seed templates | Designer card output pixel-matches legacy for diocese 1; new diocese designs a card end-to-end | ✅ BE DONE 2026-06-12 (`df25c3b`) — smoke 28/28, E2E 181/181; designer UI = FE repo |
| 5 | Events generalization + venues + fee/accommodation toggles + Anubhav backfill | Anubhav E2E green via events tables; new parish-scoped event w/o accommodation works | ✅ BE DONE 2026-06-15 (`bc425da`) — smoke 37/37, E2E 181/181; anubhavRole reads venues from DB |
| 6 | QR tokens + scan desk + instant registration | Scan→registered round trip < 2s; duplicates handled | ✅ BE DONE 2026-07-02 — smoke 37/37 (`scripts/qr-smoke.js`, round trip <2s, duplicate→409+timestamp), E2E 181/181; scan-desk UI = FE repo |
| 7 | Full cross-repo E2E, docs, API_CONTRACT update | All phases' checks green in one pass | ⬜ (incl. FE halves of 1–4 and /platform, /org, /imports, /permissions, /idcard-templates contract docs) |

Rules: one phase per session where possible; update `.claude/sessions/` log +
this plan's checkboxes; `/compact` between phases; never skip the exit check.

## 3. Scalability & best practices baked in
- Every future youth module = `module key + tables(diocese_id) + permission
  keys + ui.tab key + route file + page` — documented as a "module recipe" in
  the API contract so anything youth-related plugs in the same way.
- Indices on every `diocese_id` and `event_id` column; keyset pagination on
  list endpoints; transactions on imports; rate limits reused from existing
  middleware; no secrets in repo; uploaded files via existing Cloudinary util.
- Excel parsing server-side only (never trust client-parsed rows).
- All new times 12-hour format. All new UI within MUI v5 design language.
