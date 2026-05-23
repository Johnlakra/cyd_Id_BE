// controllers/anubhavRoleController.js - Event-role read/grant for Anubhav 2026.
// All routes mounted under /anubhav/me/role and /anubhav/roles.
const { query, queryOne } = require('../config/database');
const { PLACES, EVENT_ROLES } = require('../middleware/anubhavRole');

// GET /anubhav/me/role
// Returns the caller's current event role (loaded by loadEventRole middleware).
const getMyRole = async (req, res) => {
    res.json({
        success: true,
        message: 'Event role retrieved',
        data: {
            event_role: req.user.event_role,
            loc_place: req.user.loc_place
        }
    });
};

// POST /anubhav/roles/grant
// Body: { profile_id, event_role, loc_place? }
// Admin may grant any role. DEXCO may only grant LOC and must specify a place.
// Profile -> user resolution uses profile.profile_user_id.
const grantRole = async (req, res) => {
    try {
        const { profile_id, event_role, loc_place } = req.body;

        if (!profile_id || !EVENT_ROLES.includes(event_role)) {
            return res.status(400).json({
                success: false,
                message: `profile_id and event_role (${EVENT_ROLES.join('|')}) are required`
            });
        }

        const isAdmin = req.user.role === 'admin';
        const isDexco = req.user.event_role === 'dexco';

        if (!isAdmin && !isDexco) {
            return res.status(403).json({
                success: false,
                message: 'Only admin or DEXCO may grant event roles'
            });
        }

        // DEXCO is limited to granting LOC.
        if (!isAdmin && event_role !== 'loc') {
            return res.status(403).json({
                success: false,
                message: 'DEXCO may only grant the LOC role'
            });
        }

        // LOC role must be tied to a valid place; other roles must not carry one.
        let place = null;
        if (event_role === 'loc') {
            if (!loc_place || !PLACES.includes(loc_place)) {
                return res.status(400).json({
                    success: false,
                    message: `loc_place required for LOC role; must be one of ${PLACES.join(', ')}`
                });
            }
            place = loc_place;
        }

        // Resolve profile -> linked user.
        const profile = await queryOne(
            'SELECT id, name, profile_user_id FROM profile WHERE id = ? AND status = 1',
            [profile_id]
        );
        if (!profile) {
            return res.status(404).json({ success: false, message: 'Profile not found' });
        }
        if (!profile.profile_user_id) {
            return res.status(400).json({
                success: false,
                message: 'Profile has no linked user account'
            });
        }

        await query(
            'UPDATE users SET event_role = ?, loc_place = ?, updated_at = NOW() WHERE id = ?',
            [event_role, place, profile.profile_user_id]
        );

        const updated = await queryOne(
            'SELECT id, username, event_role, loc_place FROM users WHERE id = ?',
            [profile.profile_user_id]
        );

        res.json({
            success: true,
            message: 'Event role granted',
            data: {
                profile_id: profile.id,
                profile_name: profile.name,
                user: updated
            }
        });
    } catch (error) {
        console.error('grantRole error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to grant event role',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// GET /anubhav/roles  (admin)
// Lists every user currently holding an event role (loc or dexco).
const listRoles = async (req, res) => {
    try {
        const rows = await query(`
            SELECT
                u.id           AS user_id,
                u.username,
                u.email,
                u.event_role,
                u.loc_place,
                p.id           AS profile_id,
                p.name         AS profile_name,
                p.deanery,
                p.parish
            FROM users u
            LEFT JOIN profile p ON p.profile_user_id = u.id AND p.status = 1
            WHERE u.event_role IN ('loc', 'dexco')
            ORDER BY u.event_role DESC, u.username ASC
        `);

        res.json({
            success: true,
            message: 'Event roles retrieved',
            data: { roles: rows }
        });
    } catch (error) {
        console.error('listRoles error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to list event roles',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    getMyRole,
    grantRole,
    listRoles
};
