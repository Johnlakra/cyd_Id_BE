// controllers/anubhavRegistrationController.js - Registration, eligibility, and fees
// for Anubhav 2026. Mounted under /anubhav/eligible, /anubhav/registrations,
// /anubhav/fees. All endpoints are place-scoped; LOC users restricted to their
// loc_place upstream by requirePlaceAccess.
const { query, queryOne } = require('../config/database');
const { PLACES, PLACE_DEANERIES, isDeaneryInPlace } = require('../middleware/anubhavRole');

const PER_YOUTH_FEE = 50;            // Plan §1: ₹50 per youth.
const SOFT_CAP_PER_PARISH = 15;      // Plan §3: ~15 per parish, soft warn-only.

// GET /anubhav/eligible?place=&deanery=&parish=&search=
// Youth from the deaneries assigned to `place` who are not already registered
// at that place. Excludes anyone already on anubhav_registrations for the place.
const listEligible = async (req, res) => {
    try {
        const place = req.place;
        const { deanery, parish, search } = req.query;

        const allowedDeaneries = PLACE_DEANERIES[place];
        const params = [];
        const conditions = [
            'p.status = 1',
            `p.deanery IN (${allowedDeaneries.map(() => '?').join(',')})`
        ];
        params.push(...allowedDeaneries);

        // Exclude profiles already registered for this place.
        conditions.push(`NOT EXISTS (
            SELECT 1 FROM anubhav_registrations r
            WHERE r.profile_id = p.id AND r.place = ? AND r.status = 1
        )`);
        params.push(place);

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
            conditions.push(`(LOWER(p.name) LIKE ? OR p.phone LIKE ? OR LOWER(p.parish) LIKE ? OR LOWER(p.deanery) LIKE ? OR LOWER(p.father) LIKE ?)`);
            params.push(term, term, term, term, term);
        }

        const profiles = await query(`
            SELECT p.id, p.name, p.father AS father_name, p.phone, p.deanery, p.parish,
                   p.level, p.designation, p.photo_url
            FROM profile p
            WHERE ${conditions.join(' AND ')}
            ORDER BY p.deanery, p.parish, p.name
            LIMIT 500
        `, params);

        res.json({
            success: true,
            message: 'Eligible youth retrieved',
            data: profiles
        });
    } catch (error) {
        console.error('listEligible error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to list eligible youth',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// POST /anubhav/registrations
// Body: { place, profile_id, chaperone_id? }
// Validates that the profile's deanery is assigned to `place`. Returns a soft
// warning (non-blocking) when the parish exceeds SOFT_CAP_PER_PARISH.
const createRegistration = async (req, res) => {
    try {
        const place = req.place;
        const { profile_id, chaperone_id } = req.body;

        if (!profile_id) {
            return res.status(400).json({ success: false, message: 'profile_id is required' });
        }

        const profile = await queryOne(
            'SELECT id, name, deanery, parish FROM profile WHERE id = ? AND status = 1',
            [profile_id]
        );
        if (!profile) {
            return res.status(404).json({ success: false, message: 'Profile not found' });
        }
        if (!isDeaneryInPlace(profile.deanery, place)) {
            return res.status(400).json({
                success: false,
                message: `Profile's deanery '${profile.deanery}' is not assigned to place '${place}'`
            });
        }

        // Check for any existing registration (active or soft-deleted).
        // Active → 409. Soft-deleted → re-activate rather than insert (avoids unique-key 500).
        const existing = await queryOne(
            'SELECT id, status FROM anubhav_registrations WHERE place = ? AND profile_id = ?',
            [place, profile_id]
        );
        if (existing) {
            if (existing.status === 1) {
                return res.status(409).json({
                    success: false,
                    message: 'Profile is already registered for this place'
                });
            }
            // Re-activate the soft-deleted row.
            await query(
                'UPDATE anubhav_registrations SET status=1, chaperone_id=?, created_by=?, created_at=NOW() WHERE id=?',
                [chaperone_id || null, req.user.id, existing.id]
            );
            const reactivated = await queryOne('SELECT * FROM anubhav_registrations WHERE id=?', [existing.id]);
            return res.status(201).json({
                success: true,
                message: 'Registration re-activated',
                data: { registration: reactivated, warnings: [] }
            });
        }

        // If chaperone provided, validate it matches place + parish.
        if (chaperone_id) {
            const chap = await queryOne(
                'SELECT id, place, parish FROM anubhav_chaperones WHERE id = ?',
                [chaperone_id]
            );
            if (!chap) {
                return res.status(404).json({ success: false, message: 'Chaperone not found' });
            }
            if (chap.place !== place || chap.parish !== profile.parish) {
                return res.status(400).json({
                    success: false,
                    message: 'Chaperone must belong to the same place and parish as the profile'
                });
            }
        }

        const result = await query(
            `INSERT INTO anubhav_registrations (place, profile_id, chaperone_id, fee_amount, created_by)
             VALUES (?, ?, ?, ?, ?)`,
            [place, profile_id, chaperone_id || null, PER_YOUTH_FEE, req.user.id]
        );

        // Soft cap check (warn only — never block).
        const parishCountRow = await queryOne(
            `SELECT COUNT(*) AS c FROM anubhav_registrations
             WHERE place = ? AND status = 1 AND profile_id IN (
               SELECT id FROM profile WHERE parish = ?
             )`,
            [place, profile.parish]
        );
        const warnings = [];
        if (parishCountRow.c > SOFT_CAP_PER_PARISH) {
            warnings.push(
                `Parish '${profile.parish}' now has ${parishCountRow.c} registered youth ` +
                `(soft cap is ${SOFT_CAP_PER_PARISH}).`
            );
        }

        const created = await queryOne(
            'SELECT * FROM anubhav_registrations WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Registration created',
            data: { registration: created, warnings }
        });
    } catch (error) {
        console.error('createRegistration error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create registration',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// GET /anubhav/registrations?place=&deanery=&parish=
// Lists registered youth for a place (joined with their profile + chaperone info)
// plus simple counts and fee total.
const listRegistrations = async (req, res) => {
    try {
        const place = req.place;
        const { deanery, parish } = req.query;
        const allowedDeaneries = PLACE_DEANERIES[place];

        const params = [place];
        const conditions = ['r.place = ?', 'r.status = 1'];

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

        const rows = await query(`
            SELECT
                r.id            AS registration_id,
                r.place,
                r.fee_amount,
                r.created_at,
                p.id            AS profile_id,
                p.name,
                p.father        AS father_name,
                p.phone,
                p.deanery,
                p.parish,
                p.level,
                p.photo_url,
                c.id            AS chaperone_id,
                c.name          AS chaperone_name,
                c.phone         AS chaperone_phone,
                c.type          AS chaperone_type
            FROM anubhav_registrations r
            JOIN profile p              ON p.id = r.profile_id
            LEFT JOIN anubhav_chaperones c ON c.id = r.chaperone_id
            WHERE ${conditions.join(' AND ')}
            ORDER BY p.deanery, p.parish, p.name
        `, params);

        const placeTotal = rows.reduce((sum, r) => sum + (r.fee_amount || 0), 0);

        res.json({
            success: true,
            message: 'Registrations retrieved',
            data: {
                place,
                registrations: rows,
                count: rows.length,
                feeTotal: placeTotal
            }
        });
    } catch (error) {
        console.error('listRegistrations error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to list registrations',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// DELETE /anubhav/registrations/:id
// Soft-deletes the registration (status = 0). LOC users may only delete within
// their loc_place; the row's place is checked after fetch since the contract
// does not include `place` in the URL.
const deleteRegistration = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) {
            return res.status(400).json({ success: false, message: 'Invalid registration id' });
        }

        const row = await queryOne(
            'SELECT id, place FROM anubhav_registrations WHERE id = ? AND status = 1',
            [id]
        );
        if (!row) {
            return res.status(404).json({ success: false, message: 'Registration not found' });
        }

        if (req.user.event_role === 'loc' && req.user.loc_place !== row.place) {
            return res.status(403).json({
                success: false,
                message: 'LOC users may only un-register within their assigned place'
            });
        }

        // Any allotment for this registration must be removed first (FK without CASCADE).
        await query('DELETE FROM anubhav_allotments WHERE registration_id = ?', [id]);
        await query('UPDATE anubhav_registrations SET status = 0 WHERE id = ?', [id]);

        res.json({ success: true, message: 'Registration removed' });
    } catch (error) {
        console.error('deleteRegistration error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to remove registration',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// GET /anubhav/fees?place=
// Returns fee math for the place + an overall total across all three places.
// Aggregates from r.fee_amount so any future per-row variation is respected.
const getFees = async (req, res) => {
    try {
        const place = req.place;

        const byParish = await query(`
            SELECT p.deanery, p.parish, COUNT(*) AS count, SUM(r.fee_amount) AS total
            FROM anubhav_registrations r
            JOIN profile p ON p.id = r.profile_id
            WHERE r.place = ? AND r.status = 1
            GROUP BY p.deanery, p.parish
            ORDER BY p.deanery, p.parish
        `, [place]);

        const byDeanery = await query(`
            SELECT p.deanery, COUNT(*) AS count, SUM(r.fee_amount) AS total
            FROM anubhav_registrations r
            JOIN profile p ON p.id = r.profile_id
            WHERE r.place = ? AND r.status = 1
            GROUP BY p.deanery
            ORDER BY p.deanery
        `, [place]);

        const placeTotalRow = await queryOne(
            `SELECT COUNT(*) AS youth, COALESCE(SUM(fee_amount), 0) AS total
             FROM anubhav_registrations WHERE place = ? AND status = 1`,
            [place]
        );
        const overallRow = await queryOne(
            `SELECT COUNT(*) AS youth, COALESCE(SUM(fee_amount), 0) AS total
             FROM anubhav_registrations WHERE status = 1`
        );

        res.json({
            success: true,
            message: 'Fees calculated',
            data: {
                place,
                perYouth: PER_YOUTH_FEE,
                byParish,
                byDeanery,
                placeTotal: Number(placeTotalRow.total),
                placeCount: Number(placeTotalRow.youth),
                overall: Number(overallRow.total),
                overallCount: Number(overallRow.youth),
            }
        });
    } catch (error) {
        console.error('getFees error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to calculate fees',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    listEligible,
    createRegistration,
    listRegistrations,
    deleteRegistration,
    getFees,
    PER_YOUTH_FEE,
    SOFT_CAP_PER_PARISH
};
