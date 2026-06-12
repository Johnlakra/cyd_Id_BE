-- 104_platform_permissions.sql
-- Multi-Diocese Platform — Phase 3: granular permission engine (Pillar C).
-- ADDITIVE ONLY. Legacy role checks in code are untouched; this engine gates
-- NEW screens/endpoints. Resolution order (in services/permissionService.js):
-- super_admin -> all; diocese admin -> all; else union(role perms) + per-user
-- overrides where 'deny' wins.
--
-- Two kinds of keys: `resource.action` for API enforcement and `ui.*` for
-- tab/button visibility — granting "even a particular button" is just a key.

-- 1) Global permission catalog (seeded below; same for every diocese).
CREATE TABLE IF NOT EXISTS permissions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  perm_key VARCHAR(100) NOT NULL UNIQUE,
  module VARCHAR(50) NOT NULL,
  label VARCHAR(150) NOT NULL,
  description TEXT
);

-- 2) Roles are per diocese. is_system=1 rows are seeded and undeletable.
CREATE TABLE IF NOT EXISTS roles (
  id INT PRIMARY KEY AUTO_INCREMENT,
  diocese_id INT NOT NULL,
  role_key VARCHAR(60) NOT NULL,
  label VARCHAR(100) NOT NULL,
  is_system TINYINT DEFAULT 0,
  UNIQUE KEY uniq_diocese_role (diocese_id, role_key)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INT NOT NULL,
  permission_id INT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id),
  FOREIGN KEY (permission_id) REFERENCES permissions(id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INT NOT NULL,
  role_id INT NOT NULL,
  scope_type ENUM('diocese','deanery','parish','event') NOT NULL DEFAULT 'diocese',
  scope_ref VARCHAR(100) NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE IF NOT EXISTS user_permission_overrides (
  user_id INT NOT NULL,
  permission_id INT NOT NULL,
  effect ENUM('allow','deny') NOT NULL,
  PRIMARY KEY (user_id, permission_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (permission_id) REFERENCES permissions(id)
);

CREATE INDEX idx_roles_diocese ON roles(diocese_id);

-- 3) Seed the permission catalog (INSERT IGNORE keeps re-runs safe via the
--    perm_key UNIQUE). resource.action keys first, then ui.* visibility keys.
INSERT IGNORE INTO permissions (perm_key, module, label) VALUES
  ('profiles.view',          'profiles', 'View profiles'),
  ('profiles.create',        'profiles', 'Create profiles'),
  ('profiles.update',        'profiles', 'Update profiles'),
  ('profiles.delete',        'profiles', 'Delete profiles'),
  ('independents.create',    'profiles', 'Create independent entries'),
  ('independents.manage',    'profiles', 'Manage independent entries'),
  ('idcards.view',           'idcards',  'View ID cards'),
  ('idcards.generate',       'idcards',  'Generate ID cards'),
  ('idcards.design',         'idcards',  'Design ID card templates'),
  ('org.view',               'org',      'View org structure'),
  ('org.manage',             'org',      'Manage deaneries and parishes'),
  ('imports.run',            'imports',  'Run bulk imports'),
  ('events.view',            'events',   'View events'),
  ('events.create',          'events',   'Create events'),
  ('events.manage',          'events',   'Manage events'),
  ('events.scan_register',   'events',   'Scan-desk instant registration'),
  ('permissions.manage',     'platform', 'Manage roles and permissions'),
  ('platform.manage_dioceses','platform','Manage diocese onboarding'),
  ('ui.tab.profiles',        'ui',       'Show Profiles tab'),
  ('ui.tab.idcards',         'ui',       'Show ID Cards tab'),
  ('ui.tab.events',          'ui',       'Show Events tab'),
  ('ui.tab.accommodation',   'ui',       'Show Accommodation tab'),
  ('ui.tab.timetable',       'ui',       'Show Timetable tab'),
  ('ui.tab.speakers',        'ui',       'Show Speakers tab'),
  ('ui.tab.announcements',   'ui',       'Show Announcements tab'),
  ('ui.tab.org',             'ui',       'Show Org Structure tab'),
  ('ui.tab.imports',         'ui',       'Show Imports tab'),
  ('ui.tab.permissions',     'ui',       'Show Permissions tab'),
  ('ui.button.export_xlsx',  'ui',       'Show Export to Excel button'),
  ('ui.button.bulk_import',  'ui',       'Show Bulk Import button');

-- 4) Seed diocese-1 system roles. These mirror existing behavior (legacy code
--    keeps enforcing the old checks; these exist so the matrix UI shows the
--    current state and so new dioceses can be provisioned from this template).
INSERT IGNORE INTO roles (diocese_id, role_key, label, is_system) VALUES
  (1, 'admin',          'Administrator', 1),
  (1, 'event_loc',      'Event LOC',     1),
  (1, 'event_dexco',    'Event DEXCO',   1),
  (1, 'profile_holder', 'Profile Holder',1);

-- admin system role -> every permission
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.diocese_id = 1 AND r.role_key = 'admin' AND r.is_system = 1;

-- event roles -> event module + event-related tabs
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.diocese_id = 1 AND r.is_system = 1
  AND r.role_key IN ('event_loc', 'event_dexco')
  AND p.perm_key IN ('events.view','events.manage','events.scan_register',
                     'ui.tab.events','ui.tab.accommodation','ui.tab.timetable',
                     'ui.tab.speakers','ui.tab.announcements');

-- profile_holder -> own ID card only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.diocese_id = 1 AND r.role_key = 'profile_holder' AND r.is_system = 1
  AND p.perm_key IN ('idcards.view', 'ui.tab.idcards');
