// config/migrationHelpers.js - Schema helpers for versioned migrations.
// Unlike the baseline's ensureColumn/createIndexSafely these THROW on failure, so a broken step
// stops the migration instead of being recorded as applied. They look tables up in DATABASE()
// (the connection's current schema), which is right even when DB_NAME isn't set in env.
const { query, queryOne } = require('./database');

const tableExists = async (table) => {
    const row = await queryOne(
        'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
        [table]
    );
    return row.count > 0;
};

const columnInfo = (table, column) =>
    queryOne(
        `SELECT COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable
         FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
        [table, column]
    );

const addColumnIfMissing = async (table, column, definition) => {
    if (await columnInfo(table, column)) return false;
    await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    return true;
};

const indexExists = async (table, indexName) => {
    const row = await queryOne(
        'SELECT COUNT(*) AS count FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
        [table, indexName]
    );
    return row.count > 0;
};

const addIndexIfMissing = async (indexName, table, columns, { unique = false } = {}) => {
    if (await indexExists(table, indexName)) return false;
    await query(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${indexName} ON ${table} (${columns})`);
    return true;
};

const foreignKeyFor = (table, column) =>
    queryOne(
        `SELECT k.CONSTRAINT_NAME AS name, r.DELETE_RULE AS deleteRule
         FROM information_schema.KEY_COLUMN_USAGE k
         JOIN information_schema.REFERENTIAL_CONSTRAINTS r
           ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
         WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = ? AND k.COLUMN_NAME = ?
           AND k.REFERENCED_TABLE_NAME IS NOT NULL`,
        [table, column]
    );

const checkConstraintExists = async (table, name) => {
    const row = await queryOne(
        `SELECT COUNT(*) AS count FROM information_schema.TABLE_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'CHECK'`,
        [table, name]
    );
    return row.count > 0;
};

module.exports = {
    tableExists,
    columnInfo,
    addColumnIfMissing,
    indexExists,
    addIndexIfMissing,
    foreignKeyFor,
    checkConstraintExists,
};
