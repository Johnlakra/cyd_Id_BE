-- 106_platform_events.sql
-- Multi-Diocese Platform — Phase 5: generalized events engine.
-- ADDITIVE ONLY. Anubhav 2026 is seeded as event id=1, diocese 1.
-- Venue deanery arrays mirror the hardcoded PLACE_DEANERIES in
-- middleware/anubhavRole.js (phagwara/abohar/amritsar).
--
-- Idempotency: CREATE TABLE IF NOT EXISTS, INSERT IGNORE, ON DUPLICATE KEY UPDATE,
-- CREATE INDEX IF NOT EXISTS are natively safe. ALTER TABLE ADD COLUMN is one-shot
-- (MySQL error 1060 on re-run) — same pattern as migrations 101-105.
-- Backfill UPDATEs only touch NULL rows so re-runs are no-ops.

-- 1) Events table — one row per event across all dioceses.
CREATE TABLE IF NOT EXISTS events (
  id INT PRIMARY KEY AUTO_INCREMENT,
  diocese_id INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  scope ENUM('diocese','deanery','parish') NOT NULL DEFAULT 'diocese',
  scope_ref VARCHAR(100) NULL,
  description TEXT,
  start_date DATE,
  end_date DATE,
  fee_enabled TINYINT DEFAULT 0,
  fee_amount INT DEFAULT 0,
  accommodation_enabled TINYINT DEFAULT 0,
  timetable_enabled TINYINT DEFAULT 1,
  speakers_enabled TINYINT DEFAULT 1,
  status ENUM('draft','open','closed','archived') DEFAULT 'draft',
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2) Event venues — generalizes the anubhav 'place' concept.
--    deaneries JSON column holds the array that was hardcoded in anubhavRole.js.
CREATE TABLE IF NOT EXISTS event_venues (
  id INT PRIMARY KEY AUTO_INCREMENT,
  event_id INT NOT NULL,
  venue_key VARCHAR(40) NOT NULL,
  name VARCHAR(150),
  address TEXT,
  start_date DATE,
  end_date DATE,
  deaneries JSON NULL,
  UNIQUE KEY uniq_event_venue (event_id, venue_key)
);

-- 3) Add event_id to anubhav tables (additive; one statement per table so the runner
--    can skip already-applied columns individually — same approach as migration 101).
ALTER TABLE anubhav_registrations ADD COLUMN event_id INT NULL;
ALTER TABLE anubhav_buildings     ADD COLUMN event_id INT NULL;
ALTER TABLE anubhav_timetable     ADD COLUMN event_id INT NULL;
ALTER TABLE anubhav_announcements ADD COLUMN event_id INT NULL;
ALTER TABLE anubhav_speakers      ADD COLUMN event_id INT NULL;
ALTER TABLE anubhav_chaperones    ADD COLUMN event_id INT NULL;

-- 4) Indexes (one-shot; consistent with migration 101 index approach).
CREATE INDEX idx_events_diocese     ON events(diocese_id);
CREATE INDEX idx_events_status      ON events(status);
CREATE INDEX idx_event_venues_event ON event_venues(event_id);

-- 5) Seed Anubhav 2026 as event id=1 for diocese 1.
INSERT INTO events
  (id, diocese_id, name, scope, description, fee_enabled, fee_amount,
   accommodation_enabled, timetable_enabled, speakers_enabled, status, created_at)
VALUES
  (1, 1, 'Anubhav 2026', 'diocese',
   'CYD Jalandhar annual youth retreat 2026', 1, 50, 1, 1, 1, 'open', NOW())
ON DUPLICATE KEY UPDATE name = name;

-- 6) Seed the 3 Anubhav venues.
--    Keys and deanery arrays match PLACES / PLACE_DEANERIES in middleware/anubhavRole.js exactly.
INSERT IGNORE INTO event_venues (event_id, venue_key, name, start_date, end_date, deaneries)
VALUES
  (1, 'phagwara', 'St. Joseph''s Catholic Church, Phagwara',
   '2026-06-02', '2026-06-04',
   JSON_ARRAY('Hoshiarpur','Tanda','Jalandhar Cantt.','Jalandhar City','Kapurthala','Sahnewal','Ludhiana')),
  (1, 'abohar', 'St. Joseph''s Catholic Church, Abohar',
   '2026-06-04', '2026-06-06',
   JSON_ARRAY('Moga','Muktsar','Ferozpur')),
  (1, 'amritsar', 'St. Francis Church, Amritsar',
   '2026-06-06', '2026-06-08',
   JSON_ARRAY('Tarn Taran','Amritsar','Ajnala','Fatehgarh Churian','Dhariwal','Gurdaspur'));

-- 7) Backfill event_id=1 on all existing anubhav rows (only touches NULLs — re-run safe).
UPDATE anubhav_registrations SET event_id = 1 WHERE event_id IS NULL;
UPDATE anubhav_buildings     SET event_id = 1 WHERE event_id IS NULL;
UPDATE anubhav_timetable     SET event_id = 1 WHERE event_id IS NULL;
UPDATE anubhav_announcements SET event_id = 1 WHERE event_id IS NULL;
UPDATE anubhav_speakers      SET event_id = 1 WHERE event_id IS NULL;
UPDATE anubhav_chaperones    SET event_id = 1 WHERE event_id IS NULL;
