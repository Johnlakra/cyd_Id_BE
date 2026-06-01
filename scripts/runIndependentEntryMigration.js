// scripts/runIndependentEntryMigration.js - Apply the Anubhav 2026 "independent
// entries" additive schema (migration 002).
// Reads scripts/migrations/002_anubhav_independent_entry.sql and runs each
// statement against the configured MySQL database.
//
// Idempotent: column adds use IF NOT EXISTS; the FK and index are pre-checked
// against information_schema and skipped if they already exist, so re-running is
// safe.
//
// Usage: node scripts/runIndependentEntryMigration.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, queryOne, testConnection } = require('../config/database');

const MIGRATION_FILE = path.join(__dirname, 'migrations', '002_anubhav_independent_entry.sql');
const DB_NAME = process.env.DB_NAME || 'cyd_new';

// Split a SQL file into individual statements. We first strip full-line `--`
// comments so multi-line statements that are preceded by a comment block are not
// dropped, then split on `;\n` (the runAnubhavMigration.js convention). The file
// has no triggers/procedures/string literals containing semicolons.
const splitStatements = (sql) => {
    const withoutComments = sql
        .split('\n')
        .filter(line => !/^\s*--/.test(line))
        .join('\n');
    return withoutComments
        .split(/;\s*\n/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
};

// MySQL has no IF NOT EXISTS for ADD CONSTRAINT / CREATE INDEX, so guard those
// two statements by checking information_schema first.
const constraintExists = async (table, constraintName) => {
    const row = await queryOne(
        `SELECT 1 AS x FROM information_schema.table_constraints
         WHERE table_schema = ? AND table_name = ? AND constraint_name = ?`,
        [DB_NAME, table, constraintName]
    );
    return !!row;
};

const indexExists = async (table, indexName) => {
    const row = await queryOne(
        `SELECT 1 AS x FROM information_schema.statistics
         WHERE table_schema = ? AND table_name = ? AND index_name = ?`,
        [DB_NAME, table, indexName]
    );
    return !!row;
};

const columnExists = async (table, columnName) => {
    const row = await queryOne(
        `SELECT 1 AS x FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
        [DB_NAME, table, columnName]
    );
    return !!row;
};

// MySQL lacks IF NOT EXISTS for ADD COLUMN / ADD CONSTRAINT / CREATE INDEX, so
// guard each by checking information_schema first. ENGINE conversion is a no-op
// when already InnoDB, so it needs no guard.
const shouldSkip = async (stmt) => {
    if (/ADD COLUMN\s+is_independent/i.test(stmt)) {
        if (await columnExists('profile', 'is_independent')) {
            return 'Column is_independent already exists';
        }
    }
    if (/ADD COLUMN\s+independent_added_by/i.test(stmt)) {
        if (await columnExists('profile', 'independent_added_by')) {
            return 'Column independent_added_by already exists';
        }
    }
    if (/ADD CONSTRAINT\s+fk_profile_independent_added_by/i.test(stmt)) {
        if (await constraintExists('profile', 'fk_profile_independent_added_by')) {
            return 'FK fk_profile_independent_added_by already exists';
        }
    }
    if (/CREATE INDEX\s+idx_profile_is_independent/i.test(stmt)) {
        if (await indexExists('profile', 'idx_profile_is_independent')) {
            return 'Index idx_profile_is_independent already exists';
        }
    }
    return null;
};

const main = async () => {
    console.log('🚀 Running Anubhav 2026 independent-entry migration (002)...');

    const connected = await testConnection();
    if (!connected) {
        throw new Error('Database connection failed.');
    }

    const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
    const statements = splitStatements(sql);

    console.log(`📋 Applying ${statements.length} statements from ${path.basename(MIGRATION_FILE)}`);

    for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        const preview = stmt.split('\n')[0].slice(0, 80);
        const skipReason = await shouldSkip(stmt);
        if (skipReason) {
            console.log(`  [${i + 1}/${statements.length}] SKIP — ${skipReason}`);
            continue;
        }
        console.log(`  [${i + 1}/${statements.length}] ${preview}...`);
        await query(stmt);
    }

    console.log('✅ Migration 002 complete.');
};

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('❌ Migration 002 failed:', err.message);
            process.exit(1);
        });
}

module.exports = { main };
