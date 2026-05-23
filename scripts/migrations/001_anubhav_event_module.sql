-- 001_anubhav_event_module.sql
-- Anubhav Retreat 2026 — event module schema.
-- ADDITIVE ONLY. Does not alter or drop any existing table/column.
-- Safe to run once on the existing cyd database. Run on the feature branch's DB first.

-- 1) Extend users with event capabilities (no new login accounts).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS event_role ENUM('none','loc','dexco') NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS loc_place  VARCHAR(32) NULL;

-- 2) Place is a fixed enum used everywhere: 'phagwara' | 'abohar' | 'amritsar'.

CREATE TABLE IF NOT EXISTS anubhav_chaperones (
  id INT PRIMARY KEY AUTO_INCREMENT,
  place VARCHAR(32) NOT NULL,
  parish VARCHAR(100) NOT NULL,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  type ENUM('Sister','Catechist') NOT NULL,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS anubhav_registrations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  place VARCHAR(32) NOT NULL,
  profile_id INT NOT NULL,
  chaperone_id INT NULL,
  fee_amount INT NOT NULL DEFAULT 50,
  status TINYINT DEFAULT 1,            -- soft delete, matches existing pattern
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_place_profile (place, profile_id),
  FOREIGN KEY (profile_id) REFERENCES profile(id),
  FOREIGN KEY (chaperone_id) REFERENCES anubhav_chaperones(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS anubhav_buildings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  place VARCHAR(32) NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS anubhav_floors (
  id INT PRIMARY KEY AUTO_INCREMENT,
  building_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  level INT DEFAULT 0,
  FOREIGN KEY (building_id) REFERENCES anubhav_buildings(id)
);

CREATE TABLE IF NOT EXISTS anubhav_rooms (
  id INT PRIMARY KEY AUTO_INCREMENT,
  floor_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  capacity INT NOT NULL DEFAULT 4,
  FOREIGN KEY (floor_id) REFERENCES anubhav_floors(id)
);

CREATE TABLE IF NOT EXISTS anubhav_allotments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  room_id INT NOT NULL,
  registration_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_registration (registration_id),   -- a youth lives in one room
  FOREIGN KEY (room_id) REFERENCES anubhav_rooms(id),
  FOREIGN KEY (registration_id) REFERENCES anubhav_registrations(id)
);

CREATE TABLE IF NOT EXISTS anubhav_timetable (
  id INT PRIMARY KEY AUTO_INCREMENT,
  place VARCHAR(32) NOT NULL,
  day DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME,
  title VARCHAR(200) NOT NULL,
  location VARCHAR(150),
  notes TEXT,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS anubhav_announcements (
  id INT PRIMARY KEY AUTO_INCREMENT,
  place VARCHAR(32) NULL,               -- NULL = diocese-wide (dexco only)
  title VARCHAR(200) NOT NULL,
  body TEXT,
  status TINYINT DEFAULT 1,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
