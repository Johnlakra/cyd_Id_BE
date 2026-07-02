// routes/events.js — Generic events engine (Platform Phase 5).
// Mounted at /events. All routes are tenant-scoped (diocese from JWT).
// Legacy /anubhav routes are unaffected — they keep their own controllers.
const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { tenantScope } = require('../middleware/tenantScope');
const { requirePermission } = require('../middleware/requirePermission');
const { handleValidationErrors } = require('../middleware/validation');
const { query, queryOne } = require('../config/database');
const { isValidQrToken, findProfileByToken, venueAllowsDeanery } = require('../services/qrService');

router.use(authenticateToken, tenantScope);

// ── Validation helpers ─────────────────────────────────────────────────────
const idParam  = param('id').isInt({ min: 1 }).withMessage('id must be a positive integer');
const vidParam = param('venueId').isInt({ min: 1 }).withMessage('venueId must be a positive integer');
const canCreate  = requirePermission('events.create');
const canManage  = requirePermission('events.manage');
const canScan    = requirePermission('events.scan_register');

// ── Helper: assert event belongs to caller's diocese ──────────────────────
const loadEventForDiocese = async (eventId, dioceseId) => {
    const ev = await queryOne(
        'SELECT * FROM events WHERE id = ? AND diocese_id = ?',
        [eventId, dioceseId]
    );
    return ev;
};

// ── GET /events ────────────────────────────────────────────────────────────
// List events for caller's diocese. super_admin may pass ?diocese_id=.
router.get('/', async (req, res) => {
    try {
        const dioceseId = req.user.platform_role === 'super_admin' && req.query.diocese_id
            ? parseInt(req.query.diocese_id, 10)
            : req.dioceseId;

        const rows = await query(
            `SELECT e.*,
                    COUNT(ev.id) AS venue_count
             FROM events e
             LEFT JOIN event_venues ev ON ev.event_id = e.id
             WHERE e.diocese_id = ?
             GROUP BY e.id
             ORDER BY e.created_at DESC`,
            [dioceseId]
        );
        res.json({ success: true, data: { events: rows, count: rows.length } });
    } catch (err) {
        console.error('GET /events error:', err);
        res.status(500).json({ success: false, message: 'Failed to list events' });
    }
});

// ── POST /events ───────────────────────────────────────────────────────────
router.post('/',
    canCreate,
    [
        body('name').trim().isLength({ min: 2, max: 150 }).withMessage('name required (2-150 chars)'),
        body('scope').optional().isIn(['diocese', 'deanery', 'parish']).withMessage('scope must be diocese|deanery|parish'),
        body('fee_enabled').optional().isBoolean(),
        body('fee_amount').optional().isInt({ min: 0 }),
        body('accommodation_enabled').optional().isBoolean(),
        handleValidationErrors,
    ],
    async (req, res) => {
        try {
            const {
                name, scope = 'diocese', scope_ref = null,
                description = null, start_date = null, end_date = null,
                fee_enabled = 0, fee_amount = 0,
                accommodation_enabled = 0, timetable_enabled = 1, speakers_enabled = 1,
                status = 'draft',
            } = req.body;

            const result = await query(
                `INSERT INTO events
                 (diocese_id, name, scope, scope_ref, description, start_date, end_date,
                  fee_enabled, fee_amount, accommodation_enabled,
                  timetable_enabled, speakers_enabled, status, created_by)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [req.dioceseId, name, scope, scope_ref, description,
                 start_date, end_date, fee_enabled ? 1 : 0, fee_amount,
                 accommodation_enabled ? 1 : 0, timetable_enabled ? 1 : 0,
                 speakers_enabled ? 1 : 0, status, req.user.id]
            );
            const created = await queryOne('SELECT * FROM events WHERE id = ?', [result.insertId]);
            res.status(201).json({ success: true, data: { event: created } });
        } catch (err) {
            console.error('POST /events error:', err);
            res.status(500).json({ success: false, message: 'Failed to create event' });
        }
    }
);

// ── GET /events/:id ────────────────────────────────────────────────────────
router.get('/:id', [idParam, handleValidationErrors], async (req, res) => {
    try {
        const ev = await loadEventForDiocese(req.params.id, req.dioceseId);
        if (!ev) return res.status(404).json({ success: false, message: 'Event not found' });

        const venues = await query(
            'SELECT * FROM event_venues WHERE event_id = ? ORDER BY id',
            [ev.id]
        );
        res.json({ success: true, data: { event: { ...ev, venues } } });
    } catch (err) {
        console.error('GET /events/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to get event' });
    }
});

// ── PUT /events/:id ────────────────────────────────────────────────────────
router.put('/:id',
    canManage,
    [idParam, handleValidationErrors],
    async (req, res) => {
        try {
            const ev = await loadEventForDiocese(req.params.id, req.dioceseId);
            if (!ev) return res.status(404).json({ success: false, message: 'Event not found' });

            const allowed = [
                'name','scope','scope_ref','description','start_date','end_date',
                'fee_enabled','fee_amount','accommodation_enabled',
                'timetable_enabled','speakers_enabled','status',
            ];
            const updates = {};
            for (const key of allowed) {
                if (req.body[key] !== undefined) updates[key] = req.body[key];
            }
            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ success: false, message: 'No valid fields to update' });
            }

            const setClauses = Object.keys(updates).map(k => `\`${k}\` = ?`).join(', ');
            await query(
                `UPDATE events SET ${setClauses} WHERE id = ?`,
                [...Object.values(updates), ev.id]
            );
            const updated = await queryOne('SELECT * FROM events WHERE id = ?', [ev.id]);
            res.json({ success: true, data: { event: updated } });
        } catch (err) {
            console.error('PUT /events/:id error:', err);
            res.status(500).json({ success: false, message: 'Failed to update event' });
        }
    }
);

// ── DELETE /events/:id — archives (soft delete) ────────────────────────────
router.delete('/:id',
    canManage,
    [idParam, handleValidationErrors],
    async (req, res) => {
        try {
            const ev = await loadEventForDiocese(req.params.id, req.dioceseId);
            if (!ev) return res.status(404).json({ success: false, message: 'Event not found' });

            await query('UPDATE events SET status = ? WHERE id = ?', ['archived', ev.id]);
            res.json({ success: true, message: 'Event archived' });
        } catch (err) {
            console.error('DELETE /events/:id error:', err);
            res.status(500).json({ success: false, message: 'Failed to archive event' });
        }
    }
);

// ── GET /events/:id/venues ─────────────────────────────────────────────────
router.get('/:id/venues', [idParam, handleValidationErrors], async (req, res) => {
    try {
        const ev = await loadEventForDiocese(req.params.id, req.dioceseId);
        if (!ev) return res.status(404).json({ success: false, message: 'Event not found' });

        const venues = await query(
            'SELECT * FROM event_venues WHERE event_id = ? ORDER BY id',
            [ev.id]
        );
        res.json({ success: true, data: { venues, count: venues.length } });
    } catch (err) {
        console.error('GET /events/:id/venues error:', err);
        res.status(500).json({ success: false, message: 'Failed to get venues' });
    }
});

// ── POST /events/:id/venues ────────────────────────────────────────────────
router.post('/:id/venues',
    canManage,
    [
        idParam,
        body('venue_key').trim().isLength({ min: 1, max: 40 }).withMessage('venue_key required'),
        body('name').optional().trim().isLength({ max: 150 }),
        handleValidationErrors,
    ],
    async (req, res) => {
        try {
            const ev = await loadEventForDiocese(req.params.id, req.dioceseId);
            if (!ev) return res.status(404).json({ success: false, message: 'Event not found' });

            const { venue_key, name = null, address = null,
                    start_date = null, end_date = null, deaneries = null } = req.body;

            const deansJson = deaneries ? JSON.stringify(deaneries) : null;
            const result = await query(
                `INSERT INTO event_venues (event_id, venue_key, name, address, start_date, end_date, deaneries)
                 VALUES (?,?,?,?,?,?,?)`,
                [ev.id, venue_key, name, address, start_date, end_date, deansJson]
            );
            const created = await queryOne('SELECT * FROM event_venues WHERE id = ?', [result.insertId]);
            res.status(201).json({ success: true, data: { venue: created } });
        } catch (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ success: false, message: 'venue_key already exists for this event' });
            }
            console.error('POST /events/:id/venues error:', err);
            res.status(500).json({ success: false, message: 'Failed to create venue' });
        }
    }
);

// ── PUT /events/:id/venues/:venueId ───────────────────────────────────────
router.put('/:id/venues/:venueId',
    canManage,
    [idParam, vidParam, handleValidationErrors],
    async (req, res) => {
        try {
            const ev = await loadEventForDiocese(req.params.id, req.dioceseId);
            if (!ev) return res.status(404).json({ success: false, message: 'Event not found' });

            const venue = await queryOne(
                'SELECT * FROM event_venues WHERE id = ? AND event_id = ?',
                [req.params.venueId, ev.id]
            );
            if (!venue) return res.status(404).json({ success: false, message: 'Venue not found' });

            const allowed = ['venue_key','name','address','start_date','end_date'];
            const updates = {};
            for (const key of allowed) {
                if (req.body[key] !== undefined) updates[key] = req.body[key];
            }
            if (req.body.deaneries !== undefined) {
                updates.deaneries = JSON.stringify(req.body.deaneries);
            }
            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ success: false, message: 'No valid fields to update' });
            }

            const setClauses = Object.keys(updates).map(k => `\`${k}\` = ?`).join(', ');
            await query(
                `UPDATE event_venues SET ${setClauses} WHERE id = ?`,
                [...Object.values(updates), venue.id]
            );
            const updated = await queryOne('SELECT * FROM event_venues WHERE id = ?', [venue.id]);
            res.json({ success: true, data: { venue: updated } });
        } catch (err) {
            console.error('PUT /events/:id/venues/:venueId error:', err);
            res.status(500).json({ success: false, message: 'Failed to update venue' });
        }
    }
);

// ── DELETE /events/:id/venues/:venueId ────────────────────────────────────
router.delete('/:id/venues/:venueId',
    canManage,
    [idParam, vidParam, handleValidationErrors],
    async (req, res) => {
        try {
            const ev = await loadEventForDiocese(req.params.id, req.dioceseId);
            if (!ev) return res.status(404).json({ success: false, message: 'Event not found' });

            const venue = await queryOne(
                'SELECT id FROM event_venues WHERE id = ? AND event_id = ?',
                [req.params.venueId, ev.id]
            );
            if (!venue) return res.status(404).json({ success: false, message: 'Venue not found' });

            await query('DELETE FROM event_venues WHERE id = ?', [venue.id]);
            res.json({ success: true, message: 'Venue deleted' });
        } catch (err) {
            console.error('DELETE /events/:id/venues/:venueId error:', err);
            res.status(500).json({ success: false, message: 'Failed to delete venue' });
        }
    }
);

// ── POST /events/:id/registrations ─────────────────────────────────────────
// Scan-desk instant registration (Phase 6, Pillar F). Accepts a scanned
// qr_token OR an explicit profile_id (manual phone-search fallback path).
// Duplicate scans return 409 with the original registration timestamp.
// Writes to anubhav_registrations — the shared registration store since
// Phase 5 backfilled it with event_id.
router.post('/:id/registrations',
    canScan,
    [
        idParam,
        body('venue_key').trim().isLength({ min: 1, max: 40 }).withMessage('venue_key required'),
        body('profile_id').optional().isInt({ min: 1 }),
        handleValidationErrors,
    ],
    async (req, res) => {
        try {
            const ev = await loadEventForDiocese(req.params.id, req.dioceseId);
            if (!ev) return res.status(404).json({ success: false, message: 'Event not found' });
            if (ev.status !== 'open') {
                return res.status(400).json({ success: false, message: 'Event is not open for registration' });
            }

            const { venue_key, qr_token, profile_id } = req.body;
            if (!qr_token && !profile_id) {
                return res.status(400).json({ success: false, message: 'qr_token or profile_id is required' });
            }

            const venue = await queryOne(
                'SELECT * FROM event_venues WHERE event_id = ? AND venue_key = ?',
                [ev.id, venue_key]
            );
            if (!venue) return res.status(404).json({ success: false, message: 'Venue not found for this event' });

            let profile;
            if (qr_token) {
                if (!isValidQrToken(qr_token)) {
                    return res.status(400).json({ success: false, message: 'Invalid QR token format' });
                }
                profile = await findProfileByToken(qr_token, req.dioceseId);
            } else {
                profile = await queryOne(
                    `SELECT id, name, photo_url, parish, deanery FROM profile
                     WHERE id = ? AND status = 1
                       AND (diocese_id = ? OR (diocese_id IS NULL AND ? = 1))`,
                    [profile_id, req.dioceseId, req.dioceseId]
                );
            }
            if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });

            if (!venueAllowsDeanery(venue, profile.deanery)) {
                return res.status(400).json({
                    success: false,
                    message: `Profile's deanery '${profile.deanery}' is not assigned to venue '${venue_key}'`,
                });
            }

            // Duplicate handling mirrors the legacy Anubhav controller:
            // active row → 409 with timestamp; soft-deleted row → re-activate.
            const existing = await queryOne(
                'SELECT id, status, created_at FROM anubhav_registrations WHERE place = ? AND profile_id = ?',
                [venue_key, profile.id]
            );
            if (existing && existing.status === 1) {
                return res.status(409).json({
                    success: false,
                    message: 'Already registered',
                    data: { already_registered: true, registered_at: existing.created_at },
                });
            }

            const feeAmount = ev.fee_enabled ? ev.fee_amount : 0;
            let registrationId;
            if (existing) {
                await query(
                    `UPDATE anubhav_registrations
                     SET status = 1, event_id = ?, fee_amount = ?, created_by = ?, created_at = NOW()
                     WHERE id = ?`,
                    [ev.id, feeAmount, req.user.id, existing.id]
                );
                registrationId = existing.id;
            } else {
                try {
                    const result = await query(
                        `INSERT INTO anubhav_registrations (place, profile_id, event_id, fee_amount, created_by)
                         VALUES (?, ?, ?, ?, ?)`,
                        [venue_key, profile.id, ev.id, feeAmount, req.user.id]
                    );
                    registrationId = result.insertId;
                } catch (err) {
                    if (err.code === 'ER_DUP_ENTRY') {
                        return res.status(409).json({
                            success: false,
                            message: 'Already registered',
                            data: { already_registered: true, registered_at: null },
                        });
                    }
                    throw err;
                }
            }

            const registration = await queryOne(
                'SELECT * FROM anubhav_registrations WHERE id = ?',
                [registrationId]
            );
            res.status(201).json({
                success: true,
                message: 'Registered',
                data: {
                    registration,
                    profile: {
                        id: profile.id,
                        name: profile.name,
                        photo_url: profile.photo_url,
                        parish: profile.parish,
                        deanery: profile.deanery,
                    },
                },
            });
        } catch (err) {
            console.error('POST /events/:id/registrations error:', err);
            res.status(500).json({ success: false, message: 'Failed to register' });
        }
    }
);

// ── GET /events/:id/stats ──────────────────────────────────────────────────
// Registration counts per venue from anubhav_registrations (event_id column).
router.get('/:id/stats', [idParam, handleValidationErrors], async (req, res) => {
    try {
        const ev = await loadEventForDiocese(req.params.id, req.dioceseId);
        if (!ev) return res.status(404).json({ success: false, message: 'Event not found' });

        const byVenue = await query(
            `SELECT ar.place AS venue_key, COUNT(*) AS registrations
             FROM anubhav_registrations ar
             WHERE ar.event_id = ? AND ar.status = 1
             GROUP BY ar.place`,
            [ev.id]
        );

        const total = byVenue.reduce((sum, r) => sum + Number(r.registrations), 0);
        res.json({ success: true, data: { event_id: ev.id, by_venue: byVenue, total_registrations: total } });
    } catch (err) {
        console.error('GET /events/:id/stats error:', err);
        res.status(500).json({ success: false, message: 'Failed to get stats' });
    }
});

module.exports = router;
