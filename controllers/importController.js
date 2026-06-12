// controllers/importController.js - Excel bulk import (Platform Phase 2).
// Wizard backend: template download -> parse + header auto-map -> validate
// (dry run) -> transactional commit with optional login-user auto-creation.
// Files travel as base64 in JSON bodies (matches the existing photo-upload
// convention; express.json is already capped at 10mb). Every commit is logged
// to import_jobs; failed rows come back as a downloadable errors workbook.
const bcrypt = require('bcryptjs');
const { query, queryOne, pool } = require('../config/database');
const {
    COLUMNS_BY_TYPE,
    MAX_IMPORT_ROWS,
    buildTemplateWorkbook,
    readWorkbookBase64,
    suggestMapping,
    parseDateValue,
    buildErrorWorkbook,
} = require('../utils/importExcel');
const {
    generateUsername,
    getPasswordFromPhone,
    generateEmail,
    ensureUniqueUsername,
    ensureUniqueEmail,
} = require('./anubhavIndependentController');

const SALT_ROUNDS = 12;
const PREVIEW_ROW_LIMIT = 100;
const DEFAULTS = { level: 'Parish', designation: 'Member', qualification: '', involvement: '' };

const cleanPhone = (value) => String(value == null ? '' : value).replace(/[^0-9]/g, '');

const serverError = (res, label, error) => {
    console.error(`${label} error:`, error);
    res.status(500).json({
        success: false,
        message: `Failed to ${label}`,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
};

// Tenant filter shared with orgController: diocese 1 also owns legacy NULL rows.
const dioceseWhere = (dioceseId) =>
    dioceseId === 1 ? '(diocese_id = 1 OR diocese_id IS NULL)' : 'diocese_id = ?';
const dioceseParams = (dioceseId) => (dioceseId === 1 ? [] : [dioceseId]);

// @route GET /imports/template?type=youth|org
const getTemplate = async (req, res) => {
    try {
        const type = req.query.type === 'org' ? 'org' : 'youth';
        const fileBase64 = await buildTemplateWorkbook(type);
        res.json({
            success: true,
            message: 'Template generated',
            data: {
                file_name: `cyd_${type}_import_template.xlsx`,
                file_base64: fileBase64,
                columns: COLUMNS_BY_TYPE[type].map(({ key, label, required }) => ({ key, label, required }))
            }
        });
    } catch (error) {
        serverError(res, 'generate template', error);
    }
};

// @route POST /imports/parse  body: { type, file_base64 }
// Step 1+2 of the wizard: read the sheet, auto-map headers, return a sample.
const parseUpload = async (req, res) => {
    try {
        const type = req.body.type === 'org' ? 'org' : 'youth';
        const { headers, rows } = await readWorkbookBase64(req.body.file_base64);
        if (rows.length > MAX_IMPORT_ROWS) {
            return res.status(400).json({
                success: false,
                message: `File has ${rows.length} rows; the maximum per import is ${MAX_IMPORT_ROWS}. Split the file and retry.`
            });
        }

        const suggestion = suggestMapping(headers, type);
        res.json({
            success: true,
            message: 'File parsed',
            data: {
                headers,
                total_rows: rows.length,
                sample_rows: rows.slice(0, 5).map(r => r.values.map(v => (v instanceof Date ? parseDateValue(v) : v))),
                suggested_mapping: suggestion.mapping,
                unmapped_required: suggestion.unmapped_required,
                unmatched_headers: suggestion.unmatched_headers
            }
        });
    } catch (error) {
        if (/zip|central directory|corrupt|worksheets/i.test(error.message)) {
            return res.status(400).json({ success: false, message: 'File is not a readable .xlsx workbook' });
        }
        serverError(res, 'parse uploaded file', error);
    }
};

// Load this diocese's org structure as Map(deaneryNameLower -> { id, name, parishes: Map(parishNameLower -> name) }).
const loadOrgIndex = async (dioceseId) => {
    const where = dioceseWhere(dioceseId);
    const params = dioceseParams(dioceseId);
    const deaneries = await query(`SELECT id, name FROM deanery WHERE ${where}`, params);
    const parishes = await query(`SELECT id, name, deanery_id FROM parish WHERE ${where}`, params);

    const index = new Map();
    const byId = new Map();
    for (const d of deaneries) {
        const entry = { id: d.id, name: d.name, parishes: new Map() };
        index.set(d.name.toLowerCase(), entry);
        byId.set(d.id, entry);
    }
    for (const p of parishes) {
        const deanery = byId.get(p.deanery_id);
        if (deanery) deanery.parishes.set(p.name.toLowerCase(), p.name);
    }
    return index;
};

// Validate + normalize every row of a mapped youth sheet against the diocese.
// Shared by validate (dry run) and commit. Returns { validRows, failedRows }.
const checkYouthRows = async (req, rows, mapping) => {
    const orgIndex = await loadOrgIndex(req.dioceseId);

    const existing = await query(
        `SELECT phone FROM profile WHERE status = 1 AND ${dioceseWhere(req.dioceseId)}`,
        dioceseParams(req.dioceseId)
    );
    const knownPhones = new Set(existing.map(r => cleanPhone(r.phone)).filter(p => p !== ''));
    const phonesInFile = new Set();

    const pick = (values, key) => {
        const idx = mapping[key];
        if (idx === undefined || idx === null) return '';
        const v = values[idx];
        if (v instanceof Date) return v;
        return String(v == null ? '' : v).trim();
    };

    const validRows = [];
    const failedRows = [];

    for (const row of rows) {
        const errors = [];
        const data = {};
        for (const column of COLUMNS_BY_TYPE.youth) data[column.key] = pick(row.values, column.key);

        if (!data.name || String(data.name).length < 2) errors.push('Name is missing');

        const dob = parseDateValue(data.dob);
        if (!dob) errors.push('DOB is missing or not a valid date');
        data.dob = dob || String(data.dob);

        const baptism = parseDateValue(data.date_of_baptism);
        // Baptism date is optional in the sheet; the profile column is NOT NULL,
        // so it falls back to the DOB.
        data.date_of_baptism = baptism || dob;

        const phone = cleanPhone(data.phone);
        if (phone.length < 7) {
            errors.push('Phone is missing or too short');
        } else if (knownPhones.has(phone)) {
            errors.push('Phone already exists in this diocese');
        } else if (phonesInFile.has(phone)) {
            errors.push('Phone is duplicated within the file');
        }
        data.phone = phone || String(data.phone);

        const deanery = orgIndex.get(String(data.deanery).toLowerCase());
        if (!data.deanery) {
            errors.push('Deanery is missing');
        } else if (!deanery) {
            errors.push(`Unknown deanery '${data.deanery}' for this diocese`);
        } else {
            data.deanery = deanery.name;
            const parishName = deanery.parishes.get(String(data.parish).toLowerCase());
            if (!data.parish) errors.push('Parish is missing');
            else if (!parishName) errors.push(`Unknown parish '${data.parish}' in deanery '${deanery.name}'`);
            else data.parish = parishName;
        }

        for (const [key, fallback] of Object.entries(DEFAULTS)) {
            if (!data[key]) data[key] = fallback;
        }

        if (errors.length) {
            failedRows.push({ row_number: row.row_number, data, errors });
        } else {
            phonesInFile.add(phone);
            validRows.push({ row_number: row.row_number, data });
        }
    }

    return { validRows, failedRows };
};

// Resolve body -> { rows, mapping } with required-column enforcement.
const readMappedSheet = async (body, type) => {
    const { headers, rows } = await readWorkbookBase64(body.file_base64);
    if (rows.length === 0) throw Object.assign(new Error('File contains no data rows'), { statusCode: 400 });
    if (rows.length > MAX_IMPORT_ROWS) {
        throw Object.assign(
            new Error(`File has ${rows.length} rows; the maximum per import is ${MAX_IMPORT_ROWS}`),
            { statusCode: 400 }
        );
    }

    const mapping = body.mapping && Object.keys(body.mapping).length
        ? body.mapping
        : suggestMapping(headers, type).mapping;
    const missing = COLUMNS_BY_TYPE[type]
        .filter(c => c.required && (mapping[c.key] === undefined || mapping[c.key] === null))
        .map(c => c.label);
    if (missing.length) {
        throw Object.assign(
            new Error(`Required columns not mapped: ${missing.join(', ')}`),
            { statusCode: 400 }
        );
    }
    return { rows, mapping };
};

// @route POST /imports/youth/validate  body: { file_base64, mapping? }
// Step 3 of the wizard: per-row errors + preview, nothing written.
const validateYouth = async (req, res) => {
    try {
        const { rows, mapping } = await readMappedSheet(req.body, 'youth');
        const { validRows, failedRows } = await checkYouthRows(req, rows, mapping);

        res.json({
            success: true,
            message: 'Validation complete',
            data: {
                total_rows: rows.length,
                valid_rows: validRows.length,
                invalid_rows: failedRows.length,
                preview: validRows.slice(0, PREVIEW_ROW_LIMIT).map(r => ({ row_number: r.row_number, ...r.data })),
                errors: failedRows.map(r => ({ row_number: r.row_number, errors: r.errors }))
            }
        });
    } catch (error) {
        if (error.statusCode === 400) return res.status(400).json({ success: false, message: error.message });
        serverError(res, 'validate import file', error);
    }
};

// @route POST /imports/youth/commit
// body: { file_base64, file_name?, mapping?, options?: { auto_create_users } }
// Inserts every valid row in ONE transaction; failed rows are returned as an
// errors workbook and never block the valid ones.
const commitYouth = async (req, res) => {
    try {
        const { rows, mapping } = await readMappedSheet(req.body, 'youth');
        const { validRows, failedRows } = await checkYouthRows(req, rows, mapping);
        const autoCreateUsers = !!(req.body.options && req.body.options.auto_create_users);

        let usersCreated = 0;
        const credentials = [];

        if (validRows.length) {
            const conn = await pool.getConnection();
            try {
                await conn.beginTransaction();

                for (const row of validRows) {
                    const d = row.data;
                    const [profileResult] = await conn.execute(
                        `INSERT INTO profile
                           (name, father, mother, dob, designation, level, date_of_baptism,
                            postal_address, parish, deanery, qualification, phone, involvement,
                            photo_url, issue_date, created_by, created_at, status, is_independent, diocese_id)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW(), 1, 0, ?)`,
                        [
                            d.name, d.father || '', d.mother || '', d.dob, d.designation, d.level,
                            d.date_of_baptism, d.postal_address || '', d.parish, d.deanery,
                            d.qualification, d.phone, d.involvement, d.photo_url || '',
                            req.user.id, req.dioceseId
                        ]
                    );

                    if (autoCreateUsers) {
                        const baseUsername = generateUsername(d.name, d.dob);
                        const username = await ensureUniqueUsername(conn, baseUsername, profileResult.insertId);
                        const email = await ensureUniqueEmail(conn, generateEmail(username));
                        const hashedPassword = await bcrypt.hash(getPasswordFromPhone(d.phone), SALT_ROUNDS);

                        const [userResult] = await conn.execute(
                            `INSERT INTO users (username, email, password, role, status, diocese_id, created_at, updated_at)
                             VALUES (?, ?, ?, 'profile_holder', 1, ?, NOW(), NOW())`,
                            [username, email, hashedPassword, req.dioceseId]
                        );
                        await conn.execute(
                            'UPDATE profile SET profile_user_id = ? WHERE id = ?',
                            [userResult.insertId, profileResult.insertId]
                        );
                        usersCreated++;
                        credentials.push({ row_number: row.row_number, name: d.name, username });
                    }
                }

                await conn.commit();
            } catch (err) {
                try { await conn.rollback(); } catch (_) { /* ignore */ }
                throw err;
            } finally {
                conn.release();
            }
        }

        await query(
            `INSERT INTO import_jobs
               (diocese_id, type, file_name, total_rows, inserted_rows, failed_rows, users_created, status, created_by)
             VALUES (?, 'youth', ?, ?, ?, ?, ?, 'completed', ?)`,
            [req.dioceseId, req.body.file_name || null, rows.length, validRows.length,
                failedRows.length, usersCreated, req.user.id]
        );

        res.status(201).json({
            success: true,
            message: `Imported ${validRows.length} of ${rows.length} rows`,
            data: {
                total_rows: rows.length,
                inserted_rows: validRows.length,
                failed_rows: failedRows.length,
                users_created: usersCreated,
                // Passwords are the registered phone numbers (existing convention).
                credentials,
                errors: failedRows.map(r => ({ row_number: r.row_number, errors: r.errors })),
                error_file_base64: failedRows.length ? await buildErrorWorkbook('youth', failedRows) : null
            }
        });
    } catch (error) {
        if (error.statusCode === 400) return res.status(400).json({ success: false, message: error.message });
        serverError(res, 'commit import', error);
    }
};

// @route POST /imports/org/commit  body: { file_base64, file_name?, mapping? }
// Org-structure import: creates missing deaneries/parishes, skips existing pairs.
const commitOrg = async (req, res) => {
    try {
        const { rows, mapping } = await readMappedSheet(req.body, 'org');
        const orgIndex = await loadOrgIndex(req.dioceseId);

        const pick = (values, key) => {
            const idx = mapping[key];
            const v = idx === undefined ? '' : values[idx];
            return String(v == null ? '' : v).trim();
        };

        let deaneriesCreated = 0, parishesCreated = 0, skipped = 0;
        const failedRows = [];

        for (const row of rows) {
            const deaneryName = pick(row.values, 'deanery');
            const parishName = pick(row.values, 'parish');
            if (!deaneryName || !parishName) {
                failedRows.push({
                    row_number: row.row_number,
                    data: { deanery: deaneryName, parish: parishName },
                    errors: ['Deanery and Parish are both required']
                });
                continue;
            }

            let deanery = orgIndex.get(deaneryName.toLowerCase());
            if (!deanery) {
                const result = await query(
                    'INSERT INTO deanery (name, created_on, diocese_id) VALUES (?, NOW(), ?)',
                    [deaneryName, req.dioceseId]
                );
                deanery = { id: result.insertId, name: deaneryName, parishes: new Map() };
                orgIndex.set(deaneryName.toLowerCase(), deanery);
                deaneriesCreated++;
            }

            if (deanery.parishes.has(parishName.toLowerCase())) {
                skipped++;
                continue;
            }
            await query(
                'INSERT INTO parish (name, deanery_id, created_on, diocese_id) VALUES (?, ?, NOW(), ?)',
                [parishName, deanery.id, req.dioceseId]
            );
            deanery.parishes.set(parishName.toLowerCase(), parishName);
            parishesCreated++;
        }

        await query(
            `INSERT INTO import_jobs
               (diocese_id, type, file_name, total_rows, inserted_rows, failed_rows, status, created_by)
             VALUES (?, 'org', ?, ?, ?, ?, 'completed', ?)`,
            [req.dioceseId, req.body.file_name || null, rows.length,
                deaneriesCreated + parishesCreated, failedRows.length, req.user.id]
        );

        res.status(201).json({
            success: true,
            message: `Org import complete: ${deaneriesCreated} deaneries, ${parishesCreated} parishes created`,
            data: {
                total_rows: rows.length,
                deaneries_created: deaneriesCreated,
                parishes_created: parishesCreated,
                skipped_existing: skipped,
                failed_rows: failedRows.length,
                errors: failedRows.map(r => ({ row_number: r.row_number, errors: r.errors })),
                error_file_base64: failedRows.length ? await buildErrorWorkbook('org', failedRows) : null
            }
        });
    } catch (error) {
        if (error.statusCode === 400) return res.status(400).json({ success: false, message: error.message });
        serverError(res, 'commit org import', error);
    }
};

// @route GET /imports/jobs — audit log for this diocese
const listJobs = async (req, res) => {
    try {
        const jobs = await query(
            `SELECT id, type, file_name, total_rows, inserted_rows, failed_rows,
                    users_created, status, created_by, created_at
             FROM import_jobs WHERE diocese_id = ?
             ORDER BY created_at DESC LIMIT 100`,
            [req.dioceseId]
        );
        res.json({ success: true, message: 'Import jobs retrieved', data: { jobs } });
    } catch (error) {
        serverError(res, 'list import jobs', error);
    }
};

module.exports = {
    getTemplate,
    parseUpload,
    validateYouth,
    commitYouth,
    commitOrg,
    listJobs
};
