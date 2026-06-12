// scripts/seedJalandharTemplates.js - Seed diocese 1's three legacy ID card
// layouts as templates (Platform Phase 4). The geometry is transcribed 1:1
// from CYD_ID/src/components/IDCard.jsx (utils/idCardLayout.js) so template-
// driven rendering is pixel-identical; the legacy FE branch stays as the
// safety net. background_url uses the 'legacy:<level>' sentinel, which the FE
// maps to its bundled Parish/Deanery/Dexco .jpg assets.
//
// Idempotent: skips any (diocese 1, level) that already has a legacy seed.
// Usage: node scripts/seedJalandharTemplates.js
require('dotenv').config();
const { query, queryOne, testConnection } = require('../config/database');
const { buildLegacyJalandharLayout, CARD_WIDTH_MM, CARD_HEIGHT_MM } = require('../utils/idCardLayout');

const SEEDS = [
    { level: 'parish', name: 'Legacy Parish' },
    { level: 'deanery', name: 'Legacy Deanery' },
    { level: 'dexco', name: 'Legacy Dexco' },
];

const main = async () => {
    const connected = await testConnection();
    if (!connected) throw new Error('Database connection failed.');

    const layout = buildLegacyJalandharLayout();

    for (const seed of SEEDS) {
        const existing = await queryOne(
            'SELECT id FROM id_card_templates WHERE diocese_id = 1 AND level = ? AND name = ?',
            [seed.level, seed.name]
        );
        if (existing) {
            console.log(`ℹ️  '${seed.name}' already seeded (id ${existing.id}), skipping`);
            continue;
        }

        const result = await query(
            `INSERT INTO id_card_templates
               (diocese_id, level, name, background_url, width_mm, height_mm, layout_json, is_default, status)
             VALUES (1, ?, ?, ?, ?, ?, ?, 1, 1)`,
            [seed.level, seed.name, `legacy:${seed.level}`, CARD_WIDTH_MM, CARD_HEIGHT_MM, JSON.stringify(layout)]
        );
        console.log(`✅ Seeded '${seed.name}' (id ${result.insertId})`);
    }
    console.log('✅ Jalandhar legacy templates seeded.');
};

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch(err => { console.error('❌', err.message); process.exit(1); });
}

module.exports = { main };
