// scripts/migrate.js - Brings the shop schema up to date: baseline tables, then any pending
// numbered migrations in /migrations. Safe to run on every boot (`npm start` does).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool, query } = require('../config/database');
const { initShopTables, seedDefaultCategories } = require('../config/shopDatabase');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const LOCK_NAME = 'cyd_shop_migrations';

const runMigrations = async ({ log = console.log } = {}) => {
    // A named lock so two instances booting at once don't run the same migration twice.
    const lockConnection = await pool.getConnection();
    try {
        const [[lock]] = await lockConnection.query('SELECT GET_LOCK(?, 60) AS acquired', [LOCK_NAME]);
        if (lock.acquired !== 1) {
            throw new Error('Could not acquire the migration lock (another instance may be migrating).');
        }

        await initShopTables();
        await seedDefaultCategories();

        await query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id VARCHAR(100) PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        const appliedRows = await query('SELECT id FROM schema_migrations');
        const applied = new Set(appliedRows.map((row) => row.id));

        const files = fs
            .readdirSync(MIGRATIONS_DIR)
            .filter((file) => /^\d+_.+\.js$/.test(file))
            .sort();

        for (const file of files) {
            const migration = require(path.join(MIGRATIONS_DIR, file));
            if (applied.has(migration.id)) continue;
            log(`⏳ Applying migration ${migration.id}...`);
            await migration.up();
            await query('INSERT INTO schema_migrations (id) VALUES (?)', [migration.id]);
            log(`✅ Applied migration ${migration.id}`);
        }
    } finally {
        await lockConnection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => {});
        lockConnection.release();
    }
};

if (require.main === module) {
    runMigrations()
        .then(() => {
            console.log('🎉 Shop schema is up to date');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Migration failed:', error.message);
            process.exit(1);
        });
}

module.exports = { runMigrations };
