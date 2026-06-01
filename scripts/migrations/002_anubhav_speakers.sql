CREATE TABLE IF NOT EXISTS anubhav_speakers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  place VARCHAR(32) NULL,
  name VARCHAR(150) NOT NULL,
  role VARCHAR(150),
  bio TEXT,
  photo_url LONGTEXT,
  sort_order INT DEFAULT 0,
  status TINYINT DEFAULT 1,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Widen photo_url to LONGTEXT on tables that already exist (CREATE TABLE
-- IF NOT EXISTS above is skipped on prod, so the type change must be applied
-- explicitly). MODIFY is idempotent: re-running just re-asserts the same type.
ALTER TABLE anubhav_speakers MODIFY COLUMN photo_url LONGTEXT;

-- 002_anubhav_speakers.sql
-- Anubhav Retreat 2026 — speakers table for the public website.
-- ADDITIVE ONLY. Does not alter or drop any existing table/column.
-- Idempotent: CREATE TABLE IF NOT EXISTS. Safe to run more than once.
-- Run after 001_anubhav_event_module.sql (depends on the users table only).
--
-- Columns:
--   place      VARCHAR(32) NULL  -- NULL = appears for all places (diocese-wide)
--   name       speaker display name
--   role       title / designation (e.g. "Keynote Speaker")
--   bio        free-text biography
--   photo_url  speaker photo (speakers are presenters, NOT youth — no PII concern)
--   sort_order display ordering on the public site
--   status     1 = published, 0 = draft / soft-deleted
--   created_by FK -> users(id)
