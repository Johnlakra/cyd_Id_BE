// services/qrService.js — QR token helpers (Platform Phase 6, Pillar F).
// QR payload format: CYD:<diocese_slug>:<qr_token> — opaque UUID v4, no PII;
// the server verifies the token, so no signature is needed.
const crypto = require('crypto');
const { query, queryOne } = require('../config/database');
const { LEGACY_DIOCESE_ID } = require('../middleware/tenantScope');

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidQrToken = (token) => typeof token === 'string' && UUID_V4_RE.test(token);

// Returns the profile's qr_token, generating and persisting one if missing.
// Retries once on the (astronomically rare) UNIQUE collision.
const ensureQrToken = async (profileId) => {
    const profile = await queryOne(
        'SELECT id, qr_token FROM profile WHERE id = ? AND status = 1',
        [profileId]
    );
    if (!profile) return null;
    if (profile.qr_token) return profile.qr_token;

    for (let attempt = 0; attempt < 2; attempt++) {
        const token = crypto.randomUUID();
        try {
            await query('UPDATE profile SET qr_token = ? WHERE id = ?', [token, profileId]);
            return token;
        } catch (err) {
            if (err.code !== 'ER_DUP_ENTRY') throw err;
        }
    }
    throw new Error('Failed to generate a unique qr_token');
};

// Tenant-scoped token lookup. Legacy rows with NULL diocese_id belong to
// diocese 1 (same compat rule as tenantScope).
const findProfileByToken = async (token, dioceseId) => {
    return queryOne(
        `SELECT id, name, photo_url, parish, deanery, level, designation, diocese_id, qr_token
         FROM profile
         WHERE qr_token = ? AND status = 1
           AND (diocese_id = ? OR (diocese_id IS NULL AND ? = ?))`,
        [token, dioceseId, dioceseId, LEGACY_DIOCESE_ID]
    );
};

const getDioceseSlug = async (dioceseId) => {
    const row = await queryOne(
        'SELECT slug FROM dioceses WHERE id = ?',
        [dioceseId || LEGACY_DIOCESE_ID]
    );
    return row ? row.slug : null;
};

const buildQrPayload = (slug, token) => `CYD:${slug}:${token}`;

// event_venues.deaneries is a JSON column — mysql2 usually returns it parsed,
// but be defensive and accept a raw string too. NULL means "no restriction".
const parseVenueDeaneries = (venue) => {
    if (!venue || venue.deaneries == null) return null;
    if (Array.isArray(venue.deaneries)) return venue.deaneries;
    try { return JSON.parse(venue.deaneries); } catch { return null; }
};

const venueAllowsDeanery = (venue, deanery) => {
    const list = parseVenueDeaneries(venue);
    if (!list || list.length === 0) return true;
    return list.includes(deanery);
};

module.exports = {
    isValidQrToken,
    ensureQrToken,
    findProfileByToken,
    getDioceseSlug,
    buildQrPayload,
    parseVenueDeaneries,
    venueAllowsDeanery,
};
