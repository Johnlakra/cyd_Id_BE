// controllers/anubhavIndependentController.js - "Independent entries" (Option B).
//
// Independents are ordinary `profile` rows flagged is_independent=1. They flow
// through every existing Anubhav path (eligible/registrations/fees/rooming) by
// virtue of being profile rows joined on profile_id. They are NOT shown on the
// ID-card profile screens (the /profiles list filters them out).
//
// Endpoints (mounted under /anubhav/independents):
//   POST   /                create independent (admin/dexco/loc, place-scoped)
//   GET    /                list independents (admin/dexco/loc, place-scoped)
//   PUT    /:id             update an independent
//   DELETE /:id             soft-delete an independent
//   POST   /:id/promote     promote -> full ID-card profile + login (admin only)
//
// Column-name mapping: the profile table stores father's name as `father` and
// DOB as `dob`. The API accepts father_name / date_of_birth and maps them.
const bcrypt = require('bcryptjs');
const { query, queryOne, pool } = require('../config/database');
const { PLACE_DEANERIES, isDeaneryInPlace } = require('../middleware/anubhavRole');
const {
    ID_CARD_REQUIRED_FIELDS,
    ANUBHAV_INDEPENDENT_REQUIRED_FIELDS,
    isPresent,
    isIdCardComplete
} = require('./anubhavConstants');

const SALT_ROUNDS = 12;
const EMAIL_DOMAIN = 'cydidcard.com';

// ── Username / password helpers — mirror scripts/migrateProfileUsers.js exactly.
// (That script cannot be imported because it requires a wrong relative path; the
// pure transforms below are copied verbatim so output matches byte-for-byte.)

// First 4 letters of name (letters only, lowercased, padded with 'x') + DDMM.
const generateUsername = (name, dateOfBirth) => {
    if (!name || name.trim() === '') return null;

    const cleanName = name.toLowerCase()
        .replace(/[^a-z]/g, '')
        .substring(0, 4)
        .padEnd(4, 'x');

    let dayMonth = '';
    if (dateOfBirth) {
        try {
            const date = new Date(dateOfBirth);
            if (!isNaN(date.getTime())) {
                const day = date.getDate().toString().padStart(2, '0');
                const month = (date.getMonth() + 1).toString().padStart(2, '0');
                dayMonth = day + month;
            } else {
                const now = new Date();
                dayMonth = now.getDate().toString().padStart(2, '0') +
                    (now.getMonth() + 1).toString().padStart(2, '0');
            }
        } catch (_) {
            const now = new Date();
            dayMonth = now.getDate().toString().padStart(2, '0') +
                (now.getMonth() + 1).toString().padStart(2, '0');
        }
    } else {
        const now = new Date();
        dayMonth = now.getDate().toString().padStart(2, '0') +
            (now.getMonth() + 1).toString().padStart(2, '0');
    }

    return `${cleanName}${dayMonth}`;
};

const generateEmail = (username) => `${username}@${EMAIL_DOMAIN}`;

// Cleaned phone is the password (matches migrateProfileUsers.getPasswordFromPhone).
const getPasswordFromPhone = (phone) => {
    if (!phone || phone.toString().trim() === '') return 'default123';
    const cleanPhone = phone.toString().replace(/[^0-9]/g, '');
    if (cleanPhone.length < 6) return cleanPhone.padEnd(8, '0');
    return cleanPhone;
};

// Username collision resolution — mirrors the migrate script's suffix strategy:
// first try `${base}${counter}`, then `${base}${counter}${profileId}`. Uses the
// provided connection so it participates in the promotion transaction.
const ensureUniqueUsername = async (conn, baseUsername, profileId) => {
    let username = baseUsername;
    let counter = 1;
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
        attempts++;
        const [rows] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return username;

        username = attempts === 1
            ? `${baseUsername}${counter}`
            : `${baseUsername}${counter}${profileId}`;
        counter++;
    }
    const timestamp = Date.now().toString().slice(-6);
    return `${baseUsername.substring(0, 3)}${profileId}${timestamp}`;
};

const ensureUniqueEmail = async (conn, baseEmail) => {
    let email = baseEmail;
    let counter = 1;
    let attempts = 0;
    const maxAttempts = 100;
    const [localPart, domain] = baseEmail.split('@');

    while (attempts < maxAttempts) {
        attempts++;
        const [rows] = await conn.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (rows.length === 0) return email;
        email = `${localPart}${counter}@${domain}`;
        counter++;
    }
    const timestamp = Date.now().toString().slice(-6);
    return `${localPart}${timestamp}@${domain}`;
};

// Reject a LOC user acting outside their loc_place (used after we resolve the
// row's place from its deanery, for routes whose URL carries no `place`).
const locScopeBlocked = (req, place) =>
    req.user.role !== 'admin' && req.user.event_role === 'loc' && req.user.loc_place !== place;

// Resolve the place a deanery belongs to (independents have no `place` column).
const placeOfDeanery = (deanery) => {
    for (const place of Object.keys(PLACE_DEANERIES)) {
        if (PLACE_DEANERIES[place].includes(deanery)) return place;
    }
    return null;
};

// Shape a profile row into the independent API representation.
const toIndependentDto = (p) => ({
    id: p.id,
    name: p.name,
    father_name: p.father || null,
    date_of_birth: p.dob || null,
    phone: p.phone || null,
    deanery: p.deanery || null,
    parish: p.parish || null,
    level: p.level || null,
    designation: p.designation || null,
    postal_address: p.postal_address || null,
    photo_url: p.photo_url || null,
    is_independent: p.is_independent,
    independent_added_by: p.independent_added_by || null,
    place: placeOfDeanery(p.deanery)
});

// ── POST /anubhav/independents ──────────────────────────────────────────────
// Body: { place, deanery, parish, name, father_name?, phone?, age?, gender?,
//         photo_url? }. Required = name, deanery, parish + place.
const createIndependent = async (req, res) => {
    try {
        const place = req.place; // set by requirePlaceAccess
        const {
            deanery, parish, name, father_name,
            date_of_birth, phone, photo_url, level, designation, postal_address
        } = req.body;

        // Required field validation.
        const missing = ANUBHAV_INDEPENDENT_REQUIRED_FIELDS.filter(f => !isPresent(req.body[f]));
        if (missing.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Missing required fields: ${missing.join(', ')}`,
                missing_fields: missing
            });
        }

        // deanery must belong to place.
        if (!isDeaneryInPlace(deanery, place)) {
            return res.status(400).json({
                success: false,
                message: `deanery '${deanery}' is not assigned to place '${place}'`
            });
        }

        // The `profile` table has several NOT NULL columns with no DB default
        // (father, mother, dob, designation, level, date_of_baptism,
        //  postal_address, qualification, phone, involvement, photo_url,
        //  issue_date). Independents only collect a minimal set, so we fill the
        //  omitted NOT NULL columns with safe placeholders: '' for text columns
        //  and a sentinel date for the NOT NULL date columns. These placeholders
        //  are intentionally "blank" so isIdCardComplete() still reports false
        //  until the row is promoted with real data.
        const SENTINEL_DATE = '1900-01-01';
        const txt = (v) => (isPresent(v) ? v : '');

        const result = await query(
            `INSERT INTO profile
               (name, father, mother, dob, designation, level, date_of_baptism,
                postal_address, parish, deanery, qualification, phone, involvement,
                photo_url, issue_date, status, is_independent,
                independent_added_by, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, NOW(), NOW())`,
            [
                name.trim(),
                txt(father_name),
                '',                                          // mother (not collected)
                isPresent(date_of_birth) ? date_of_birth : SENTINEL_DATE,
                txt(designation),
                txt(level),
                SENTINEL_DATE,                               // date_of_baptism
                txt(postal_address),
                parish.trim(),
                deanery.trim(),
                '',                                          // qualification
                txt(phone),
                '',                                          // involvement
                txt(photo_url),
                SENTINEL_DATE,                               // issue_date
                req.user.id, req.user.id
            ]
        );

        const created = await queryOne('SELECT * FROM profile WHERE id = ?', [result.insertId]);
        res.status(201).json({
            success: true,
            message: 'Independent entry created',
            data: { profile_id: result.insertId, independent: toIndependentDto(created) }
        });
    } catch (error) {
        console.error('createIndependent error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create independent entry',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ── GET /anubhav/independents ───────────────────────────────────────────────
// Query: { place?, deanery?, parish?, search? }. Lists is_independent=1 rows,
// place-scoped via PLACE_DEANERIES. LOC is restricted to its place upstream by
// requirePlaceAccess (place is required). Each row carries id_card_complete.
const listIndependents = async (req, res) => {
    try {
        const place = req.place; // requirePlaceAccess guarantees a valid place
        const { deanery, parish, search } = req.query;

        const allowedDeaneries = PLACE_DEANERIES[place];
        const params = [];
        const conditions = [
            'p.is_independent = 1',
            'p.status = 1',
            `p.deanery IN (${allowedDeaneries.map(() => '?').join(',')})`
        ];
        params.push(...allowedDeaneries);

        if (deanery && deanery.trim()) {
            if (!allowedDeaneries.includes(deanery.trim())) {
                return res.status(400).json({
                    success: false,
                    message: `deanery '${deanery}' is not assigned to place '${place}'`
                });
            }
            conditions.push('p.deanery = ?');
            params.push(deanery.trim());
        }
        if (parish && parish.trim()) {
            conditions.push('p.parish = ?');
            params.push(parish.trim());
        }
        if (search && search.trim()) {
            const term = `%${search.trim().toLowerCase()}%`;
            conditions.push('(LOWER(p.name) LIKE ? OR p.phone LIKE ? OR LOWER(p.parish) LIKE ? OR LOWER(p.deanery) LIKE ?)');
            params.push(term, term, term, term);
        }

        const rows = await query(
            `SELECT * FROM profile p WHERE ${conditions.join(' AND ')} ORDER BY p.deanery, p.parish, p.name LIMIT 500`,
            params
        );

        const independents = rows.map(r => ({
            ...toIndependentDto(r),
            id_card_complete: isIdCardComplete(r)
        }));

        res.json({
            success: true,
            message: 'Independent entries retrieved',
            data: { place, independents, count: independents.length }
        });
    } catch (error) {
        console.error('listIndependents error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to list independent entries',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Load an independent row by id (only is_independent=1, status=1). Returns null
// for missing / non-independent / deleted rows.
const loadIndependent = async (id) =>
    queryOne('SELECT * FROM profile WHERE id = ? AND is_independent = 1 AND status = 1', [id]);

// ── PUT /anubhav/independents/:id ───────────────────────────────────────────
// Same field set as create, all optional. Only is_independent=1 rows.
const updateIndependent = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) {
            return res.status(400).json({ success: false, message: 'Invalid independent id' });
        }

        const existing = await loadIndependent(id);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Independent entry not found' });
        }

        // LOC scope check via the row's current deanery -> place.
        const rowPlace = placeOfDeanery(existing.deanery);
        if (rowPlace && locScopeBlocked(req, rowPlace)) {
            return res.status(403).json({
                success: false,
                message: 'LOC users may only act within their assigned place'
            });
        }

        const {
            name, father_name, date_of_birth, phone, deanery, parish,
            postal_address, level, designation, photo_url
        } = req.body;

        // If deanery changes, it must remain within an LOC's place (re-check).
        const nextDeanery = isPresent(deanery) ? deanery.trim() : existing.deanery;
        const nextPlace = placeOfDeanery(nextDeanery);
        if (nextPlace && locScopeBlocked(req, nextPlace)) {
            return res.status(403).json({
                success: false,
                message: 'LOC users may only assign deaneries within their place'
            });
        }

        await query(
            `UPDATE profile SET
               name = ?, father = ?, dob = ?, phone = ?, deanery = ?, parish = ?,
               postal_address = ?, level = ?, designation = ?, photo_url = ?,
               updated_at = NOW()
             WHERE id = ? AND is_independent = 1`,
            [
                isPresent(name) ? name.trim() : existing.name,
                isPresent(father_name) ? father_name : existing.father,
                isPresent(date_of_birth) ? date_of_birth : existing.dob,
                isPresent(phone) ? phone : existing.phone,
                nextDeanery,
                isPresent(parish) ? parish.trim() : existing.parish,
                isPresent(postal_address) ? postal_address : existing.postal_address,
                isPresent(level) ? level : existing.level,
                isPresent(designation) ? designation : existing.designation,
                isPresent(photo_url) ? photo_url : existing.photo_url,
                id
            ]
        );

        const updated = await queryOne('SELECT * FROM profile WHERE id = ?', [id]);
        res.json({
            success: true,
            message: 'Independent entry updated',
            data: { independent: { ...toIndependentDto(updated), id_card_complete: isIdCardComplete(updated) } }
        });
    } catch (error) {
        console.error('updateIndependent error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update independent entry',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ── DELETE /anubhav/independents/:id ────────────────────────────────────────
// Soft delete (status=0). Blocked (409) if an active registration exists.
const deleteIndependent = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) {
            return res.status(400).json({ success: false, message: 'Invalid independent id' });
        }

        const existing = await loadIndependent(id);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Independent entry not found' });
        }

        const rowPlace = placeOfDeanery(existing.deanery);
        if (rowPlace && locScopeBlocked(req, rowPlace)) {
            return res.status(403).json({
                success: false,
                message: 'LOC users may only act within their assigned place'
            });
        }

        const activeReg = await queryOne(
            'SELECT id FROM anubhav_registrations WHERE profile_id = ? AND status = 1',
            [id]
        );
        if (activeReg) {
            return res.status(409).json({
                success: false,
                message: 'Un-register from Anubhav first, then delete.'
            });
        }

        await query('UPDATE profile SET status = 0, updated_at = NOW() WHERE id = ? AND is_independent = 1', [id]);
        res.json({ success: true, message: 'Independent entry deleted', data: { id } });
    } catch (error) {
        console.error('deleteIndependent error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete independent entry',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Map an API field name to its profile column name (for promote validation).
const API_TO_COLUMN = {
    name: 'name',
    father_name: 'father',
    deanery: 'deanery',
    parish: 'parish',
    date_of_birth: 'dob',
    phone: 'phone',
    postal_address: 'postal_address',
    level: 'level',
    designation: 'designation',
    photo_url: 'photo_url'
};
// API field names the promote endpoint accepts, ordered to mirror ID-card fields.
const PROMOTE_API_FIELDS = Object.keys(API_TO_COLUMN);

// ── POST /anubhav/independents/:id/promote ──────────────────────────────────
// Admin only. Flips is_independent->0, fills any ID-card fields from the body,
// creates a profile_holder users row (username/password per migrateProfileUsers),
// and links it. Atomic. Returns the updated profile + generated username.
const promoteIndependent = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) {
            return res.status(400).json({ success: false, message: 'Invalid independent id' });
        }

        const existing = await loadIndependent(id);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Independent entry not found' });
        }

        // Build the post-promotion field values: body value if present, else the
        // value already on the row.
        const resolved = {};
        for (const apiField of PROMOTE_API_FIELDS) {
            const column = API_TO_COLUMN[apiField];
            resolved[column] = isPresent(req.body[apiField]) ? req.body[apiField] : existing[column];
        }

        // All ID-card-required columns must end up present.
        const missing = ID_CARD_REQUIRED_FIELDS.filter(col => !isPresent(resolved[col]));
        if (missing.length > 0) {
            // Report back in API field names where they differ from columns.
            const columnToApi = Object.fromEntries(Object.entries(API_TO_COLUMN).map(([a, c]) => [c, a]));
            return res.status(400).json({
                success: false,
                message: 'Cannot promote: missing ID-card-required fields',
                missing_fields: missing.map(c => columnToApi[c] || c)
            });
        }

        const username = await promoteInTransaction(id, resolved);

        const updated = await queryOne('SELECT * FROM profile WHERE id = ?', [id]);
        res.json({
            success: true,
            message: 'Independent promoted to full ID-card profile',
            data: {
                profile: updated,
                credentials: {
                    username,
                    password_hint: 'The phone number (digits only) is the password.',
                    message: `User created — username: ${username}, password is the phone number.`
                }
            }
        });
    } catch (error) {
        console.error('promoteIndependent error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to promote independent entry',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Atomic promotion: UPDATE profile + INSERT users + link profile_user_id.
// Returns the generated username. Rolls back fully on any error.
const promoteInTransaction = async (profileId, resolved) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // 1) Fill ID-card fields + flip is_independent off.
        await conn.execute(
            `UPDATE profile SET
               name = ?, father = ?, deanery = ?, parish = ?, dob = ?, phone = ?,
               postal_address = ?, level = ?, designation = ?, photo_url = ?,
               is_independent = 0, independent_added_by = NULL, updated_at = NOW()
             WHERE id = ? AND is_independent = 1`,
            [
                resolved.name, resolved.father, resolved.deanery, resolved.parish,
                resolved.dob, resolved.phone, resolved.postal_address, resolved.level,
                resolved.designation, resolved.photo_url, profileId
            ]
        );

        // 2) Create the login user (matches migrateProfileUsers.js scheme).
        const baseUsername = generateUsername(resolved.name, resolved.dob);
        const username = await ensureUniqueUsername(conn, baseUsername, profileId);
        const email = await ensureUniqueEmail(conn, generateEmail(username));
        const password = getPasswordFromPhone(resolved.phone);
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        const [userResult] = await conn.execute(
            `INSERT INTO users (username, email, password, role, created_at, updated_at)
             VALUES (?, ?, ?, 'profile_holder', NOW(), NOW())`,
            [username, email, hashedPassword]
        );
        const userId = userResult.insertId;

        // 3) Link the profile to the new user.
        await conn.execute(
            'UPDATE profile SET profile_user_id = ?, updated_at = NOW() WHERE id = ?',
            [userId, profileId]
        );

        await conn.commit();
        return username;
    } catch (err) {
        try { await conn.rollback(); } catch (_) { /* ignore */ }
        throw err;
    } finally {
        conn.release();
    }
};

module.exports = {
    createIndependent,
    listIndependents,
    updateIndependent,
    deleteIndependent,
    promoteIndependent,
    // exported for tests / reuse
    generateUsername,
    getPasswordFromPhone,
    placeOfDeanery,
    // user-provisioning helpers reused by the bulk import pipeline (Phase 2)
    generateEmail,
    ensureUniqueUsername,
    ensureUniqueEmail
};
