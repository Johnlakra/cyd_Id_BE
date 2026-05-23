// middleware/anubhavRole.js - Event-role gating for the Anubhav 2026 module.
// Layered on top of authenticateToken; additive only — does not change existing auth.
const { queryOne } = require('../config/database');

const PLACES = ['phagwara', 'abohar', 'amritsar'];
const EVENT_ROLES = ['none', 'loc', 'dexco'];

// Deaneries assigned to each place-batch (per MASTER_PLAN.md §1).
// Names match the existing `profile.deanery` column values.
const PLACE_DEANERIES = {
    phagwara: ['Hoshiarpur', 'Tanda', 'Jalandhar Cantt.', 'Jalandhar City', 'Kapurthala', 'Sahnewal', 'Ludhiana'],
    abohar:   ['Moga', 'Muktsar', 'Ferozpur'],
    amritsar: ['Tarn Taran', 'Amritsar', 'Ajnala', 'Fatehgarh Churian', 'Dhariwal', 'Gurdaspur']
};

const isDeaneryInPlace = (deanery, place) =>
    Array.isArray(PLACE_DEANERIES[place]) && PLACE_DEANERIES[place].includes(deanery);

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
const requireEventRole = (allowedRoles) => (req, res, next) => {
    if (!allowedRoles.includes(req.user.event_role)) {
        return res.status(403).json({
            success: false,
            message: `Event role required: ${allowedRoles.join(' or ')}`
        });
    }
    next();
};

// For place-scoped operations: extract `place` from body/query/params and ensure
// the caller can act on it. DEXCO acts on all three places; LOC only on loc_place.
const requirePlaceAccess = (req, res, next) => {
    const place = req.body.place || req.query.place || req.params.place;
    if (!place || !PLACES.includes(place)) {
        return res.status(400).json({
            success: false,
            message: `place must be one of: ${PLACES.join(', ')}`
        });
    }
    if (req.user.event_role === 'loc' && req.user.loc_place !== place) {
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
    loadEventRole,
    requireEventRole,
    requirePlaceAccess
};
