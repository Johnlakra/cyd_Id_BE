// scripts/backfillQrTokens.js — Phase 6 backfill: give every existing profile
// a qr_token (UUID v4). Idempotent: only touches rows where qr_token IS NULL.
// Run AFTER applying scripts/migrations/107_platform_qr.sql.
//
// SAFETY: uses config/database (reads .env). The effective DB host is printed
// first — abort with Ctrl-C if it is not the DB you intend to write to.
// Force local regardless of .env:
//   DB_HOST=localhost DB_PORT=3306 DB_SSL=false DB_NAME=cyd_new node scripts/backfillQrTokens.js
require('dotenv').config();
const crypto = require('crypto');
const { query } = require('../config/database');

const BATCH_SIZE = 500;

async function run() {
    console.log(`Target DB: ${process.env.DB_HOST}/${process.env.DB_NAME}`);

    let total = 0;
    for (;;) {
        // BATCH_SIZE is a trusted constant — LIMIT placeholders are unreliable
        // with prepared statements (pool.execute), so it is inlined.
        const rows = await query(
            `SELECT id FROM profile WHERE qr_token IS NULL LIMIT ${BATCH_SIZE}`
        );
        if (rows.length === 0) break;

        for (const row of rows) {
            await query(
                'UPDATE profile SET qr_token = ? WHERE id = ? AND qr_token IS NULL',
                [crypto.randomUUID(), row.id]
            );
        }
        total += rows.length;
        console.log(`  backfilled ${total} profiles...`);
    }

    console.log(`Done. ${total} profiles received a qr_token.`);
    process.exit(0);
}

run().catch(err => {
    console.error('Backfill failed:', err.message);
    process.exit(1);
});
