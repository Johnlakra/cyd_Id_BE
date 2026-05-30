// scripts/runAnubhavMigration.js - Apply the Anubhav 2026 additive schema.
// Reads the migration SQL files under scripts/migrations/ and runs each statement
// against the configured MySQL database, in filename order. Idempotent: all
// statements use IF NOT EXISTS, so re-running is safe.
//
// Usage: node scripts/runAnubhavMigration.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, testConnection } = require('../config/database');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// All .sql migration files, applied in filename order (001, 002, ...). Each file
// is idempotent (CREATE TABLE IF NOT EXISTS + already-exists errno skipping), so
// re-running the whole set is safe.
const MIGRATION_FILES = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => path.join(MIGRATIONS_DIR, f));

// MySQL error numbers that mean "this object already exists" — safe to skip so
// the migration stays idempotent on re-run (MySQL lacks ADD COLUMN IF NOT EXISTS).
const ALREADY_EXISTS_ERRNOS = new Set([
    1050, // ER_TABLE_EXISTS_ERROR
    1060, // ER_DUP_FIELDNAME (column already added)
    1061, // ER_DUP_KEYNAME (index already added)
    1826, // ER_FK_DUP_NAME (foreign key already added)
]);

// Split a SQL file into individual statements. Naive split on `;\n` is sufficient
// here because the migration contains no triggers, procedures, or string literals
// with semicolons. Full-line `--` comments are stripped from each chunk so a
// statement preceded by a comment line is not mistaken for a comment-only chunk
// (inline trailing comments are kept — MySQL executes them fine).
const splitStatements = (sql) => {
    return sql
        .split(/;\s*\n/)
        .map(s => s
            .split('\n')
            .filter(line => !/^\s*--/.test(line))
            .join('\n')
            .trim())
        .filter(s => s.length > 0);
};

const main = async () => {
    console.log('🚀 Running Anubhav 2026 schema migration...');

    const connected = await testConnection();
    if (!connected) {
        throw new Error('Database connection failed.');
    }

    for (const migrationFile of MIGRATION_FILES) {
        const sql = fs.readFileSync(migrationFile, 'utf8');
        const statements = splitStatements(sql);

        console.log(`📋 Applying ${statements.length} statements from ${path.basename(migrationFile)}`);

        for (let i = 0; i < statements.length; i++) {
            const stmt = statements[i];
            const preview = stmt.split('\n')[0].slice(0, 80);
            console.log(`  [${i + 1}/${statements.length}] ${preview}...`);
            try {
                await query(stmt);
            } catch (err) {
                if (ALREADY_EXISTS_ERRNOS.has(err.errno)) {
                    console.log(`      ↳ already applied (${err.code}), skipping`);
                } else {
                    throw err;
                }
            }
        }
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
