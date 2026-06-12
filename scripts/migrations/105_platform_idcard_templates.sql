-- 105_platform_idcard_templates.sql
-- Multi-Diocese Platform — Phase 4: ID card template designer (Pillar D).
-- ADDITIVE ONLY. Stores per-diocese, per-level card layouts. The FE renders
-- from layout_json when a template resolves for (diocese, level); otherwise it
-- falls back to the legacy hardcoded layout — Jalandhar's three current
-- layouts are seeded as templates by scripts/seedJalandharTemplates.js so
-- output is pixel-identical (background_url uses the 'legacy:<level>'
-- sentinel, which the FE maps to its bundled .jpg assets).

CREATE TABLE IF NOT EXISTS id_card_templates (
  id INT PRIMARY KEY AUTO_INCREMENT,
  diocese_id INT NOT NULL,
  level VARCHAR(40) NOT NULL,
  name VARCHAR(100) NOT NULL,
  background_url TEXT NOT NULL,
  width_mm DECIMAL(6,2) DEFAULT 146.30,
  height_mm DECIMAL(6,2) DEFAULT 221.80,
  layout_json JSON NOT NULL,
  is_default TINYINT DEFAULT 0,
  status TINYINT DEFAULT 1,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX idx_idcard_templates_diocese_level ON id_card_templates(diocese_id, level);
