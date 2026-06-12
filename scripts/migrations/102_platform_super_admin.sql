-- 102_platform_super_admin.sql
-- Multi-Diocese Platform — Phase 1: super_admin platform role.
-- ADDITIVE ONLY. Follows the event_role precedent: a separate column instead of
-- extending the users.role ENUM, because the ENUM's value set differs between
-- environments (e.g. local has 'buyer') and a MODIFY could silently drop values.
-- platform_role sits ABOVE role: 'super_admin' approves diocese registrations
-- and manages the platform; existing role checks are untouched.

ALTER TABLE users
  ADD COLUMN platform_role ENUM('none','super_admin') NOT NULL DEFAULT 'none';
