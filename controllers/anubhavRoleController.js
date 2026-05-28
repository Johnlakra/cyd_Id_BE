// controllers/anubhavRoleController.js - Event-role read/grant for Anubhav 2026.
// All routes mounted under /anubhav/me/role and /anubhav/roles.
const { query, queryOne } = require('../config/database');
const { PLACES, EVENT_ROLES } = require('../middleware/anubhavRole');

// GET /anubhav/me/role
// Returns the caller's current event role (loaded by loadEventRole middleware).
// Admin users are treated as dexco so the frontend unlocks all management views.
const getMyRole = async (req, res) => {
    res.json({
        success: true,
        message: 'Event role retrieved',
        data: {
            event_role: req.user.role === 'admin' ? 'dexco' : req.user.event_role,
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

        if ((!profile_id && !req.body.user_id) || !EVENT_ROLES.includes(event_role)) {
            return res.status(400).json({
                success: false,
                message: `profile_id or user_id, plus event_role (${EVENT_ROLES.join('|')}), are required`
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

        // Resolve to a user_id — accept either profile_id or direct user_id.
        const { user_id } = req.body;
        let targetUserId, profileName = null, resolvedProfileId = null;

        if (user_id) {
            const u = await queryOne('SELECT id, username FROM users WHERE id = ?', [user_id]);
            if (!u) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }
            targetUserId = u.id;
            profileName = u.username;
        } else {
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
            targetUserId = profile.profile_user_id;
            profileName = profile.name;
            resolvedProfileId = profile.id;
        }

        await query(
            'UPDATE users SET event_role = ?, loc_place = ?, updated_at = NOW() WHERE id = ?',
            [event_role, place, targetUserId]
        );

        const updated = await queryOne(
            'SELECT id, username, event_role, loc_place FROM users WHERE id = ?',
            [targetUserId]
        );

        res.json({
            success: true,
            message: 'Event role granted',
            data: {
                profile_id: resolvedProfileId,
                profile_name: profileName,
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

// GET /anubhav/users/search?q=   (admin only)
// Searches profiles by name or phone and returns the match along with the
// linked user's current event role. Profiles without a linked user account
// are included but flagged so the UI can show "no login account".
const searchUsers = async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q) {
            return res.status(400).json({ success: false, message: 'q (search term) is required' });
        }

        const term = `%${q.toLowerCase()}%`;
        const rows = await query(`
            SELECT
                p.id           AS profile_id,
                p.name         AS profile_name,
                p.phone,
                p.deanery,
                p.parish,
                p.photo_url,
                u.id           AS user_id,
                u.username,
                u.email,
                u.role         AS system_role,
                u.event_role,
                u.loc_place
            FROM profile p
            LEFT JOIN users u ON u.id = p.profile_user_id
            WHERE p.status = 1
              AND (LOWER(p.name) LIKE ? OR p.phone LIKE ? OR LOWER(p.father) LIKE ?)
            ORDER BY p.name
            LIMIT 30
        `, [term, term, term]);

        res.json({
            success: true,
            message: 'Users found',
            data: { results: rows, count: rows.length }
        });
    } catch (error) {
        console.error('searchUsers error:', error);
        res.status(500).json({
            success: false,
            message: 'Search failed',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// GET /anubhav/deanery-parish-map
// Returns all deaneries and their parishes sourced from the canonical DB tables.
// Any authenticated user may call this; frontend filters to the relevant place.
const getDeaneryParishMap = async (req, res) => {
    try {
        const rows = await query(`
            SELECT d.name AS deanery_name, p.name AS parish_name
            FROM parish p
            JOIN deanery d ON p.deanery_id = d.id
            ORDER BY d.name, p.name
        `);
        const map = {};
        for (const { deanery_name, parish_name } of rows) {
            if (!map[deanery_name]) map[deanery_name] = [];
            map[deanery_name].push(parish_name);
        }
        res.json({ success: true, message: 'Deanery-parish map retrieved', data: map });
    } catch (error) {
        console.error('getDeaneryParishMap error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load deanery-parish map',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    getMyRole,
    grantRole,
    listRoles,
    searchUsers,
    getDeaneryParishMap
};
