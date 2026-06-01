-- 002_anubhav_independent_entry.sql
-- Anubhav Retreat 2026 — "independent entries" feature (Option B).
-- Independents are stored as ordinary `profile` rows flagged is_independent=1.
-- ADDITIVE ONLY: adds two columns + one index + one FK. Does not alter or drop
-- any existing column or table. Safe to run once on the feature branch's DB.
--
-- NOTE on engine: the FK on independent_added_by -> users(id) requires InnoDB on
-- both tables. `profile` ships as MyISAM in this database, so we convert it to
-- InnoDB first. This is non-destructive (data preserved, no columns changed) and
-- aligns `profile` with the rest of the schema (`users` is already InnoDB), which
-- also makes the existing anubhav_registrations.profile_id FK enforceable.

-- 1) Ensure profile is InnoDB so the new FK can be enforced.
ALTER TABLE profile ENGINE = InnoDB;

-- 2) Flag column: 1 = independent entry, 0 = real ID-card profile (default).
--    (MySQL has no IF NOT EXISTS for ADD COLUMN; the runner guards re-runs by
--     checking information_schema before applying each ADD COLUMN.)
ALTER TABLE profile
  ADD COLUMN is_independent TINYINT NOT NULL DEFAULT 0;

-- 3) Who created the independent entry (NULL for real ID-card profiles).
ALTER TABLE profile
  ADD COLUMN independent_added_by INT NULL;

-- 4) FK: independent_added_by -> users(id).
ALTER TABLE profile
  ADD CONSTRAINT fk_profile_independent_added_by
    FOREIGN KEY (independent_added_by) REFERENCES users(id);

-- 5) Index for fast filtering of independents vs real profiles.
CREATE INDEX idx_profile_is_independent ON profile(is_independent);
