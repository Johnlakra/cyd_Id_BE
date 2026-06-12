-- 101_platform_dioceses.sql
-- Multi-Diocese Platform — Phase 1: tenancy core (Pillar A).
-- ADDITIVE ONLY. Does not alter or drop any existing column or table.
-- Adds the dioceses registry, a nullable diocese_id to every tenant-scoped
-- table, seeds Jalandhar as diocese 1, and backfills existing rows to 1.
-- NULL diocese_id is treated as 1 by legacy-compat reads, so untouched code
-- paths keep working even before the backfill runs.
--
-- Idempotency: CREATE TABLE IF NOT EXISTS / INSERT IGNORE are natively safe;
-- ADD COLUMN and CREATE INDEX re-runs are skipped by the runner via
-- duplicate-name errnos (1060/1061). Backfill UPDATEs only touch NULL rows.
--
-- No FKs on diocese_id: prod may lack ALTER/REFERENCES privileges (same
-- reasoning as anubhav_registrations.profile_id) — integrity is app-enforced.

-- 1) Diocese registry. status drives the onboarding flow:
--    pending (public registration) -> active (super_admin approved) -> suspended.
CREATE TABLE IF NOT EXISTS dioceses (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(60) NOT NULL UNIQUE,
  logo_url TEXT NULL,
  contact_email VARCHAR(150),
  contact_phone VARCHAR(30),
  address TEXT,
  settings JSON NULL,
  status ENUM('pending','active','suspended') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2) Seed Jalandhar as diocese 1 (the legacy tenant). INSERT IGNORE keeps
--    re-runs safe via the PK.
INSERT IGNORE INTO dioceses (id, name, slug, status)
VALUES (1, 'Diocese of Jalandhar', 'jalandhar', 'active');

-- 3) Nullable diocese_id on every tenant-scoped table (NULL == diocese 1 in
--    legacy-compat reads). One statement per table so the runner can skip
--    already-applied columns individually.
ALTER TABLE users ADD COLUMN diocese_id INT NULL;
ALTER TABLE profile ADD COLUMN diocese_id INT NULL;
ALTER TABLE deanery ADD COLUMN diocese_id INT NULL;
ALTER TABLE parish ADD COLUMN diocese_id INT NULL;
ALTER TABLE anubhav_chaperones ADD COLUMN diocese_id INT NULL;
ALTER TABLE anubhav_registrations ADD COLUMN diocese_id INT NULL;
ALTER TABLE anubhav_buildings ADD COLUMN diocese_id INT NULL;
ALTER TABLE anubhav_floors ADD COLUMN diocese_id INT NULL;
ALTER TABLE anubhav_rooms ADD COLUMN diocese_id INT NULL;
ALTER TABLE anubhav_allotments ADD COLUMN diocese_id INT NULL;
ALTER TABLE anubhav_timetable ADD COLUMN diocese_id INT NULL;
ALTER TABLE anubhav_announcements ADD COLUMN diocese_id INT NULL;
ALTER TABLE anubhav_speakers ADD COLUMN diocese_id INT NULL;

-- 4) Index every diocese_id (master plan: scalability baked in).
CREATE INDEX idx_users_diocese ON users(diocese_id);
CREATE INDEX idx_profile_diocese ON profile(diocese_id);
CREATE INDEX idx_deanery_diocese ON deanery(diocese_id);
CREATE INDEX idx_parish_diocese ON parish(diocese_id);
CREATE INDEX idx_anubhav_chaperones_diocese ON anubhav_chaperones(diocese_id);
CREATE INDEX idx_anubhav_registrations_diocese ON anubhav_registrations(diocese_id);
CREATE INDEX idx_anubhav_buildings_diocese ON anubhav_buildings(diocese_id);
CREATE INDEX idx_anubhav_floors_diocese ON anubhav_floors(diocese_id);
CREATE INDEX idx_anubhav_rooms_diocese ON anubhav_rooms(diocese_id);
CREATE INDEX idx_anubhav_allotments_diocese ON anubhav_allotments(diocese_id);
CREATE INDEX idx_anubhav_timetable_diocese ON anubhav_timetable(diocese_id);
CREATE INDEX idx_anubhav_announcements_diocese ON anubhav_announcements(diocese_id);
CREATE INDEX idx_anubhav_speakers_diocese ON anubhav_speakers(diocese_id);

-- 5) Backfill: every existing row belongs to Jalandhar. Only touches NULLs,
--    so re-runs are no-ops and rows created later for other dioceses are safe.
UPDATE users SET diocese_id = 1 WHERE diocese_id IS NULL;
UPDATE profile SET diocese_id = 1 WHERE diocese_id IS NULL;
UPDATE deanery SET diocese_id = 1 WHERE diocese_id IS NULL;
UPDATE parish SET diocese_id = 1 WHERE diocese_id IS NULL;
UPDATE anubhav_chaperones SET diocese_id = 1 WHERE diocese_id IS NULL;
UPDATE anubhav_registrations SET diocese_id = 1 WHERE diocese_id IS NULL;
UPDATE anubhav_buildings SET diocese_id = 1 WHERE diocese_id IS NULL;
UPDATE anubhav_floors SET diocese_id = 1 WHERE diocese_id IS NULL;
UPDATE anubhav_rooms SET diocese_id = 1 WHERE diocese_id IS NULL;
UPDATE anubhav_allotments SET diocese_id = 1 WHERE diocese_id IS NULL;
UPDATE anubhav_timetable SET diocese_id = 1 WHERE diocese_id IS NULL;
UPDATE anubhav_announcements SET diocese_id = 1 WHERE diocese_id IS NULL;
UPDATE anubhav_speakers SET diocese_id = 1 WHERE diocese_id IS NULL;
