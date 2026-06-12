-- 103_platform_import_jobs.sql
-- Multi-Diocese Platform — Phase 2: Excel bulk import audit log.
-- ADDITIVE ONLY. Every import (youth or org structure) is logged here:
-- who ran it, when, row counts, and the error summary. The failed-rows
-- spreadsheet itself is returned to the client, not stored.

CREATE TABLE IF NOT EXISTS import_jobs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  diocese_id INT NOT NULL,
  type ENUM('youth','org') NOT NULL,
  file_name VARCHAR(255) NULL,
  total_rows INT NOT NULL DEFAULT 0,
  inserted_rows INT NOT NULL DEFAULT 0,
  failed_rows INT NOT NULL DEFAULT 0,
  users_created INT NOT NULL DEFAULT 0,
  status ENUM('completed','failed') NOT NULL,
  error_detail TEXT NULL,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX idx_import_jobs_diocese ON import_jobs(diocese_id);
