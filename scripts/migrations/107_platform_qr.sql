-- 107_platform_qr.sql
-- Multi-Diocese Platform — Phase 6: QR instant registration (Pillar F).
-- ADDITIVE ONLY. profile is MyISAM — no FKs, app-enforced integrity.
--
-- qr_token is an opaque UUID v4 (no PII in the QR payload; the server verifies).
-- Tokens are generated in Node (crypto.randomUUID) — MySQL's UUID() is v1
-- (time-based, predictable) which is wrong for a scan credential. Existing
-- profiles are backfilled by scripts/backfillQrTokens.js; new profiles get a
-- token lazily on first QR use (my-qr / ensure endpoints).
--
-- Idempotency: ALTER TABLE ADD COLUMN and CREATE INDEX are one-shot
-- (MySQL errors 1060/1061 on re-run) — same pattern as migrations 101-106.

ALTER TABLE profile ADD COLUMN qr_token CHAR(36) NULL;

CREATE UNIQUE INDEX uniq_profile_qr_token ON profile (qr_token);
