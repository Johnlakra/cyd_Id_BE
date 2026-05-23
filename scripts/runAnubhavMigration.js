// scripts/runAnubhavMigration.js - Apply the Anubhav 2026 additive schema.
// Reads scripts/migrations/001_anubhav_event_module.sql and runs each statement
// against the configured MySQL database. Idempotent: all statements use
// IF NOT EXISTS, so re-running is safe.
//
// Usage: node scripts/runAnubhavMigration.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, testConnection } = require('../config/database');

const MIGRATION_FILE = path.join(__dirname, 'migrations', '001_anubhav_event_module.sql');

// Split a SQL file into individual statements. Naive split on `;\n` is sufficient
// here because the migration contains no triggers, procedures, or string literals
// with semicolons.
const splitStatements = (sql) => {
    return sql
        .split(/;\s*\n/)
        .map(s => s.trim())
        .filter(s => s.length > 0 && !/^--/.test(s));
};

const main = async () => {
    console.log('🚀 Running Anubhav 2026 schema migration...');

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
        console.log(`  [${i + 1}/${statements.length}] ${preview}...`);
        await query(stmt);
    }

    console.log('✅ Migration complete.');
};

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('❌ Migration failed:', err.message);
            process.exit(1);
        });
}

module.exports = { main };
