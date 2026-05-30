CREATE TABLE IF NOT EXISTS anubhav_speakers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  place VARCHAR(32) NULL,
  name VARCHAR(150) NOT NULL,
  role VARCHAR(150),
  bio TEXT,
  photo_url VARCHAR(255),
  sort_order INT DEFAULT 0,
  status TINYINT DEFAULT 1,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

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
