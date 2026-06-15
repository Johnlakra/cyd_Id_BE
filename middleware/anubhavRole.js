// middleware/anubhavRole.js - Event-role gating for the Anubhav 2026 module.
// Layered on top of authenticateToken; additive only — does not change existing auth.
const { queryOne, query } = require('../config/database');

const PLACES = ['phagwara', 'abohar', 'amritsar'];
const EVENT_ROLES = ['none', 'loc', 'dexco'];

// Deaneries assigned to each place-batch (per MASTER_PLAN.md §1).
// Names match the existing `profile.deanery` column values.
// Kept as authoritative fallback when DB lookup fails or returns empty.
const PLACE_DEANERIES = {
    phagwara: ['Hoshiarpur', 'Tanda', 'Jalandhar Cantt.', 'Jalandhar City', 'Kapurthala', 'Sahnewal', 'Ludhiana'],
    abohar:   ['Moga', 'Muktsar', 'Ferozpur'],
    amritsar: ['Tarn Taran', 'Amritsar', 'Ajnala', 'Fatehgarh Churian', 'Dhariwal', 'Gurdaspur']
};

// Load venue keys and deanery arrays from event_venues for a given event.
// Falls back to hardcoded PLACES/PLACE_DEANERIES if the query fails or is empty
// — preserves identical Anubhav behavior with zero downtime.
const loadPlacesForEvent = async (eventId) => {
    try {
        const rows = await query(
            'SELECT venue_key, deaneries FROM event_venues WHERE event_id = ?',
            [eventId]
        );
        if (!rows || rows.length === 0) {
            return { places: PLACES, placeDeaneries: PLACE_DEANERIES };
        }
        const places = rows.map(r => r.venue_key);
        const placeDeaneries = {};
        for (const row of rows) {
            const deans = row.deaneries
                ? (typeof row.deaneries === 'string' ? JSON.parse(row.deaneries) : row.deaneries)
                : [];
            placeDeaneries[row.venue_key] = deans;
        }
        return { places, placeDeaneries };
    } catch (_err) {
        // DB unavailable or event_venues table not yet migrated — fall back silently.
        return { places: PLACES, placeDeaneries: PLACE_DEANERIES };
    }
};

// Middleware: attach req.eventPlaces / req.eventPlaceDeaneries before place checks.
// Defaults to event_id=1 (Anubhav 2026). Callers may set req.eventId earlier to override.
const loadEventVenues = async (req, res, next) => {
    const eventId = req.eventId || 1;
    const { places, placeDeaneries } = await loadPlacesForEvent(eventId);
    req.eventPlaces = places;
    req.eventPlaceDeaneries = placeDeaneries;
    next();
};

// Backward-compatible: accepts optional placeDeaneries map (new callers pass it;
// legacy callers omit it and fall back to the module-level hardcoded constant).
const isDeaneryInPlace = (deanery, place, placeDeaneries) => {
    const map = placeDeaneries || PLACE_DEANERIES;
    return Array.isArray(map[place]) && map[place].includes(deanery);
};

// Fetch the caller's event_role/loc_place and attach to req.user.
// Run after authenticateToken so req.user.id is present.
const loadEventRole = async (req, res, next) => {
    try {
        const row = await queryOne(
            'SELECT event_role, loc_place FROM users WHERE id = ?',
            [req.user.id]
        );
        req.user.event_role = row?.event_role || 'none';
        req.user.loc_place = row?.loc_place || null;
        next();
    } catch (error) {
        console.error('loadEventRole error:', error);
        res.status(500).json({ success: false, message: 'Failed to load event role' });
    }
};

// Require the caller to hold one of the listed event roles.
// Usage: requireEventRole(['dexco']) or requireEventRole(['dexco', 'loc']).
// Admin users bypass this check — they have full access.
const requireEventRole = (allowedRoles) => (req, res, next) => {
    if (req.user.role === 'admin') return next();
    if (!allowedRoles.includes(req.user.event_role)) {
        return res.status(403).json({
            success: false,
            message: `Event role required: ${allowedRoles.join(' or ')}`
        });
    }
    next();
};

// Stricter guard for destructive accommodation routes: admin OR dexco only.
// LOC must be rejected explicitly. Used by DELETE /anubhav/buildings|floors|rooms
// to make the "no LOC deletes" contract obvious at the route definition.
const requireAdminOrDexco = (req, res, next) => {
    if (req.user.role === 'admin') return next();
    if (req.user.event_role === 'dexco') return next();
    return res.status(403).json({
        success: false,
        message: 'Admin or DEXCO access required'
    });
};

// For place-scoped operations: extract `place` from body/query/params and ensure
// the caller can act on it. Admin and DEXCO act on all three places; LOC only on loc_place.
// Prefers req.eventPlaces (set by loadEventVenues) over the hardcoded PLACES constant.
const requirePlaceAccess = (req, res, next) => {
    const validPlaces = req.eventPlaces || PLACES;
    const place = req.body.place || req.query.place || req.params.place;
    if (!place || !validPlaces.includes(place)) {
        return res.status(400).json({
            success: false,
            message: `place must be one of: ${validPlaces.join(', ')}`
        });
    }
    if (req.user.role !== 'admin' && req.user.event_role === 'loc' && req.user.loc_place !== place) {
        return res.status(403).json({
            success: false,
            message: 'LOC users may only act on their assigned place'
        });
    }
    req.place = place;
    next();
};

module.exports = {
    PLACES,
    EVENT_ROLES,
    PLACE_DEANERIES,
    isDeaneryInPlace,
    loadPlacesForEvent,
    loadEventVenues,
    loadEventRole,
    requireEventRole,
    requireAdminOrDexco,
    requirePlaceAccess
};
