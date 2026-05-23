// controllers/anubhavAnnouncementController.js - Per-place + diocese-wide
// announcements for Anubhav 2026. Mounted under /anubhav/announcements.
// Diocese-wide (place = NULL) is DEXCO-only. Reads are open to any authenticated
// user — every youth sees their place's banner + any diocese-wide notice.
const { query, queryOne } = require('../config/database');
const { PLACES } = require('../middleware/anubhavRole');

const locScopeBlocked = (req, place) =>
    req.user.event_role === 'loc' && req.user.loc_place !== place;

// POST /anubhav/announcements  { place|null, title, body }
// place === null  -> diocese-wide (DEXCO only).
// place set       -> place-scoped; LOC restricted to loc_place.
const createAnnouncement = async (req, res) => {
    try {
        const { place, title, body } = req.body;
        if (!title || !title.trim()) {
            return res.status(400).json({ success: false, message: 'title is required' });
        }

        if (place === null || typeof place === 'undefined') {
            if (req.user.event_role !== 'dexco') {
                return res.status(403).json({
                    success: false,
                    message: 'Only DEXCO may post diocese-wide announcements'
                });
            }
        } else {
            if (!PLACES.includes(place)) {
                return res.status(400).json({
                    success: false,
                    message: `place must be one of: ${PLACES.join(', ')} (or null for diocese-wide)`
                });
            }
            if (locScopeBlocked(req, place)) {
                return res.status(403).json({
                    success: false,
                    message: 'LOC users may only post in their assigned place'
                });
            }
        }

        const result = await query(
            `INSERT INTO anubhav_announcements (place, title, body, created_by)
             VALUES (?, ?, ?, ?)`,
            [place || null, title.trim(), body || null, req.user.id]
        );
        const created = await queryOne(
            'SELECT * FROM anubhav_announcements WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Announcement created',
            data: { announcement: created }
        });
    } catch (error) {
        console.error('createAnnouncement error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create announcement',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// GET /anubhav/announcements?place=
// Returns active (status=1) announcements for that place plus all diocese-wide
// ones. Open to any authenticated user.
const listAnnouncements = async (req, res) => {
    try {
        const place = req.query.place;
        if (!place || !PLACES.includes(place)) {
            return res.status(400).json({
                success: false,
                message: `place must be one of: ${PLACES.join(', ')}`
            });
        }

        const rows = await query(
            `SELECT * FROM anubhav_announcements
             WHERE status = 1 AND (place = ? OR place IS NULL)
             ORDER BY created_at DESC`,
            [place]
        );

        res.json({
            success: true,
            message: 'Announcements retrieved',
            data: { place, announcements: rows, count: rows.length }
        });
    } catch (error) {
        console.error('listAnnouncements error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve announcements',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// DELETE /anubhav/announcements/:id  (soft delete; status = 0)
const deleteAnnouncement = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) {
            return res.status(400).json({ success: false, message: 'Invalid announcement id' });
        }

        const existing = await queryOne(
            'SELECT id, place FROM anubhav_announcements WHERE id = ? AND status = 1',
            [id]
        );
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Announcement not found' });
        }

        // Diocese-wide entries (place IS NULL) are DEXCO-only to remove.
        if (existing.place === null) {
            if (req.user.event_role !== 'dexco') {
                return res.status(403).json({
                    success: false,
                    message: 'Only DEXCO may remove diocese-wide announcements'
                });
            }
        } else if (locScopeBlocked(req, existing.place)) {
            return res.status(403).json({
                success: false,
                message: 'LOC users may only remove announcements in their assigned place'
            });
        }

        await query('UPDATE anubhav_announcements SET status = 0 WHERE id = ?', [id]);
        res.json({ success: true, message: 'Announcement removed' });
    } catch (error) {
        console.error('deleteAnnouncement error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to remove announcement',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    createAnnouncement,
    listAnnouncements,
    deleteAnnouncement
};
