// controllers/anubhavAllotmentController.js - Room allotments for Anubhav 2026.
// Mounted under /anubhav/allotments. Place is derived from the room because the
// request body / URL does not carry it explicitly.
const { query, queryOne } = require('../config/database');

const locScopeBlocked = (req, place) =>
    req.user.event_role === 'loc' && req.user.loc_place !== place;

// POST /anubhav/allotments  { room_id, registration_id }
// Validates that:
//   - room exists and (if LOC) is in the user's loc_place
//   - registration exists, is active, and is for the same place as the room
//   - room is not full (occupancy < capacity)
const createAllotment = async (req, res) => {
    try {
        const { room_id, registration_id } = req.body;
        if (!room_id || !registration_id) {
            return res.status(400).json({
                success: false,
                message: 'room_id and registration_id are required'
            });
        }

        // Pull room, its place, and current occupancy in one go.
        const room = await queryOne(`
            SELECT
                r.id, r.capacity, b.place,
                (SELECT COUNT(*) FROM anubhav_allotments WHERE room_id = r.id) AS occupancy
            FROM anubhav_rooms r
            JOIN anubhav_floors f    ON f.id = r.floor_id
            JOIN anubhav_buildings b ON b.id = f.building_id
            WHERE r.id = ?
        `, [room_id]);
        if (!room) {
            return res.status(404).json({ success: false, message: 'Room not found' });
        }
        if (locScopeBlocked(req, room.place)) {
            return res.status(403).json({
                success: false,
                message: 'LOC users may only allot rooms within their assigned place'
            });
        }
        if (Number(room.occupancy) >= Number(room.capacity)) {
            return res.status(409).json({ success: false, message: 'Room is already full' });
        }

        const registration = await queryOne(
            'SELECT id, place FROM anubhav_registrations WHERE id = ? AND status = 1',
            [registration_id]
        );
        if (!registration) {
            return res.status(404).json({ success: false, message: 'Registration not found' });
        }
        if (registration.place !== room.place) {
            return res.status(400).json({
                success: false,
                message: 'Registration and room must belong to the same place'
            });
        }

        // UNIQUE KEY uniq_registration enforces one-room-per-youth at the DB
        // layer; surface that as a clean 409.
        const existing = await queryOne(
            'SELECT id, room_id FROM anubhav_allotments WHERE registration_id = ?',
            [registration_id]
        );
        if (existing) {
            return res.status(409).json({
                success: false,
                message: `Youth already allotted to room ${existing.room_id}`
            });
        }

        const result = await query(
            'INSERT INTO anubhav_allotments (room_id, registration_id) VALUES (?, ?)',
            [room_id, registration_id]
        );
        const created = await queryOne(
            'SELECT * FROM anubhav_allotments WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Allotment created',
            data: { allotment: created }
        });
    } catch (error) {
        console.error('createAllotment error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create allotment',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// DELETE /anubhav/allotments/:id
const deleteAllotment = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) {
            return res.status(400).json({ success: false, message: 'Invalid allotment id' });
        }

        const allotment = await queryOne(`
            SELECT a.id, b.place
            FROM anubhav_allotments a
            JOIN anubhav_rooms r     ON r.id = a.room_id
            JOIN anubhav_floors f    ON f.id = r.floor_id
            JOIN anubhav_buildings b ON b.id = f.building_id
            WHERE a.id = ?
        `, [id]);
        if (!allotment) {
            return res.status(404).json({ success: false, message: 'Allotment not found' });
        }
        if (locScopeBlocked(req, allotment.place)) {
            return res.status(403).json({
                success: false,
                message: 'LOC users may only remove allotments within their assigned place'
            });
        }

        await query('DELETE FROM anubhav_allotments WHERE id = ?', [id]);
        res.json({ success: true, message: 'Allotment removed' });
    } catch (error) {
        console.error('deleteAllotment error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to remove allotment',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// POST /anubhav/allotments/batch  { room_id, registration_ids: [] }
// Allots multiple youth to a room in one call. Validates capacity upfront, then
// loops — each insertion is independent so partial success is reported.
const createAllotmentBatch = async (req, res) => {
    try {
        const { room_id, registration_ids } = req.body;
        if (!room_id || !Array.isArray(registration_ids) || !registration_ids.length) {
            return res.status(400).json({
                success: false,
                message: 'room_id and registration_ids[] are required'
            });
        }

        const room = await queryOne(`
            SELECT r.id, r.capacity, b.place,
                (SELECT COUNT(*) FROM anubhav_allotments WHERE room_id = r.id) AS occupancy
            FROM anubhav_rooms r
            JOIN anubhav_floors f    ON f.id = r.floor_id
            JOIN anubhav_buildings b ON b.id = f.building_id
            WHERE r.id = ?
        `, [room_id]);
        if (!room) {
            return res.status(404).json({ success: false, message: 'Room not found' });
        }
        if (locScopeBlocked(req, room.place)) {
            return res.status(403).json({
                success: false,
                message: 'LOC users may only allot rooms within their assigned place'
            });
        }

        const vacant = Number(room.capacity) - Number(room.occupancy);
        if (registration_ids.length > vacant) {
            return res.status(409).json({
                success: false,
                message: `Room only has ${vacant} vacant slot(s); ${registration_ids.length} requested`
            });
        }

        const succeeded = [], failed = [];
        for (const registration_id of registration_ids) {
            const reg = await queryOne(
                'SELECT id, place FROM anubhav_registrations WHERE id = ? AND status = 1',
                [registration_id]
            );
            if (!reg) { failed.push({ registration_id, reason: 'Registration not found' }); continue; }
            if (reg.place !== room.place) { failed.push({ registration_id, reason: 'Registration belongs to a different place' }); continue; }

            const existing = await queryOne(
                'SELECT id FROM anubhav_allotments WHERE registration_id = ?',
                [registration_id]
            );
            if (existing) { failed.push({ registration_id, reason: 'Already allotted to a room' }); continue; }

            try {
                const result = await query(
                    'INSERT INTO anubhav_allotments (room_id, registration_id) VALUES (?, ?)',
                    [room_id, registration_id]
                );
                succeeded.push({ id: result.insertId, room_id: Number(room_id), registration_id: Number(registration_id) });
            } catch (err) {
                failed.push({ registration_id, reason: err.message });
            }
        }

        res.status(201).json({
            success: true,
            message: `${succeeded.length} allotted, ${failed.length} failed`,
            data: { succeeded, failed }
        });
    } catch (error) {
        console.error('createAllotmentBatch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create allotments',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    createAllotment,
    createAllotmentBatch,
    deleteAllotment
};
