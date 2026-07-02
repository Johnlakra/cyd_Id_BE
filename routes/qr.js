// routes/qr.js — QR scan-desk lookup + token provisioning (Platform Phase 6).
// Mounted at /profiles/qr BEFORE the legacy /profiles router so the legacy
// profile routes stay 100% untouched. Tenant-scoped via JWT diocese claim.
const express = require('express');
const { param } = require('express-validator');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { tenantScope } = require('../middleware/tenantScope');
const { requirePermission } = require('../middleware/requirePermission');
const { handleValidationErrors } = require('../middleware/validation');
const { queryOne } = require('../config/database');
const {
    isValidQrToken, ensureQrToken, findProfileByToken,
    getDioceseSlug, buildQrPayload, venueAllowsDeanery,
} = require('../services/qrService');

router.use(authenticateToken, tenantScope);

// ── GET /profiles/qr/:token ─────────────────────────────────────────────────
// Scan-desk lookup: resolves a scanned token to a profile summary. When
// ?event_id=&venue_key= are supplied, also returns eligibility for that
// event+venue (deanery match + already-registered status with timestamp).
router.get('/:token',
    requirePermission('events.scan_register'),
    async (req, res) => {
        try {
            const { token } = req.params;
            if (!isValidQrToken(token)) {
                return res.status(400).json({ success: false, message: 'Invalid QR token format' });
            }

            const profile = await findProfileByToken(token, req.dioceseId);
            if (!profile) {
                return res.status(404).json({ success: false, message: 'No profile matches this QR code' });
            }

            const payload = {
                profile: {
                    id: profile.id,
                    name: profile.name,
                    photo_url: profile.photo_url,
                    parish: profile.parish,
                    deanery: profile.deanery,
                    level: profile.level,
                    designation: profile.designation,
                },
            };

            const eventId = parseInt(req.query.event_id, 10);
            const venueKey = req.query.venue_key;
            if (eventId && venueKey) {
                const ev = await queryOne(
                    'SELECT * FROM events WHERE id = ? AND diocese_id = ?',
                    [eventId, req.dioceseId]
                );
                if (!ev) {
                    return res.status(404).json({ success: false, message: 'Event not found' });
                }
                const venue = await queryOne(
                    'SELECT * FROM event_venues WHERE event_id = ? AND venue_key = ?',
                    [eventId, venueKey]
                );
                if (!venue) {
                    return res.status(404).json({ success: false, message: 'Venue not found for this event' });
                }

                const existing = await queryOne(
                    `SELECT id, status, created_at FROM anubhav_registrations
                     WHERE place = ? AND profile_id = ?`,
                    [venueKey, profile.id]
                );
                const alreadyRegistered = !!existing && existing.status === 1;
                const deaneryOk = venueAllowsDeanery(venue, profile.deanery);

                payload.eligibility = {
                    event_id: eventId,
                    venue_key: venueKey,
                    event_open: ev.status === 'open',
                    deanery_allowed: deaneryOk,
                    already_registered: alreadyRegistered,
                    registered_at: alreadyRegistered ? existing.created_at : null,
                    eligible: ev.status === 'open' && deaneryOk && !alreadyRegistered,
                    reason: !deaneryOk
                        ? `Deanery '${profile.deanery}' is not assigned to venue '${venueKey}'`
                        : alreadyRegistered ? 'Already registered'
                        : ev.status !== 'open' ? 'Event is not open'
                        : null,
                };
            }

            res.json({ success: true, data: payload });
        } catch (err) {
            console.error('GET /profiles/qr/:token error:', err);
            res.status(500).json({ success: false, message: 'Failed to look up QR token' });
        }
    }
);

// ── POST /profiles/qr/ensure/:profileId ────────────────────────────────────
// Returns the profile's QR token + payload string, generating the token if
// missing (covers profiles created after the backfill). Used by the ID card
// render path, so it's gated by idcards.generate.
router.post('/ensure/:profileId',
    requirePermission('idcards.generate'),
    [
        param('profileId').isInt({ min: 1 }).withMessage('profileId must be a positive integer'),
        handleValidationErrors,
    ],
    async (req, res) => {
        try {
            const profileId = parseInt(req.params.profileId, 10);
            const profile = await queryOne(
                `SELECT id, diocese_id FROM profile
                 WHERE id = ? AND status = 1
                   AND (diocese_id = ? OR (diocese_id IS NULL AND ? = 1))`,
                [profileId, req.dioceseId, req.dioceseId]
            );
            if (!profile) {
                return res.status(404).json({ success: false, message: 'Profile not found' });
            }

            const token = await ensureQrToken(profileId);
            const slug = await getDioceseSlug(profile.diocese_id || req.dioceseId);
            res.json({
                success: true,
                data: { qr_token: token, payload: buildQrPayload(slug, token) },
            });
        } catch (err) {
            console.error('POST /profiles/qr/ensure/:profileId error:', err);
            res.status(500).json({ success: false, message: 'Failed to ensure QR token' });
        }
    }
);

module.exports = router;
