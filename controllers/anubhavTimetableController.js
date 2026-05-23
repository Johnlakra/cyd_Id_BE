// controllers/anubhavTimetableController.js - Per-place timetable + "Live Now /
// Up Next" view for Anubhav 2026. Mounted under /anubhav/timetable.
// Mutations are restricted to LOC/DEXCO. Reads are open to any authenticated user
// (every youth must see their place's schedule).
const { query, queryOne } = require('../config/database');

const locScopeBlocked = (req, place) =>
    req.user.event_role === 'loc' && req.user.loc_place !== place;

// Lightweight body validators shared by POST and PUT.
const validateTimetableBody = ({ day, start_time, title, end_time }) => {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        return 'day is required in YYYY-MM-DD format';
    }
    if (!start_time || !/^\d{2}:\d{2}(:\d{2})?$/.test(start_time)) {
        return 'start_time is required in HH:MM or HH:MM:SS';
    }
    if (end_time && !/^\d{2}:\d{2}(:\d{2})?$/.test(end_time)) {
        return 'end_time must be in HH:MM or HH:MM:SS';
    }
    if (end_time && end_time <= start_time) {
        return 'end_time must be after start_time';
    }
    if (!title || !title.trim()) {
        return 'title is required';
    }
    return null;
};

// POST /anubhav/timetable  { place, day, start_time, end_time, title, location, notes }
const createItem = async (req, res) => {
    try {
        const place = req.place;
        const { day, start_time, end_time, title, location, notes } = req.body;

        const validationError = validateTimetableBody({ day, start_time, title, end_time });
        if (validationError) {
            return res.status(400).json({ success: false, message: validationError });
        }

        const result = await query(
            `INSERT INTO anubhav_timetable
                (place, day, start_time, end_time, title, location, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                place, day, start_time, end_time || null,
                title.trim(), location || null, notes || null, req.user.id
            ]
        );
        const created = await queryOne(
            'SELECT * FROM anubhav_timetable WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Timetable item created',
            data: { item: created }
        });
    } catch (error) {
        console.error('createItem error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create timetable item',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// GET /anubhav/timetable?place=
const listItems = async (req, res) => {
    try {
        const place = req.query.place;
        if (!place) {
            return res.status(400).json({ success: false, message: 'place is required' });
        }

        const items = await query(
            `SELECT * FROM anubhav_timetable
             WHERE place = ?
             ORDER BY day ASC, start_time ASC`,
            [place]
        );

        res.json({
            success: true,
            message: 'Timetable retrieved',
            data: { place, items, count: items.length }
        });
    } catch (error) {
        console.error('listItems error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve timetable',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// PUT /anubhav/timetable/:id  (full replace using same body shape as POST,
// minus place — place is fixed at creation time and cannot move between places).
const updateItem = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) {
            return res.status(400).json({ success: false, message: 'Invalid timetable id' });
        }

        const existing = await queryOne(
            'SELECT id, place FROM anubhav_timetable WHERE id = ?',
            [id]
        );
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Timetable item not found' });
        }
        if (locScopeBlocked(req, existing.place)) {
            return res.status(403).json({
                success: false,
                message: 'LOC users may only edit items in their assigned place'
            });
        }

        const { day, start_time, end_time, title, location, notes } = req.body;
        const validationError = validateTimetableBody({ day, start_time, title, end_time });
        if (validationError) {
            return res.status(400).json({ success: false, message: validationError });
        }

        await query(
            `UPDATE anubhav_timetable
             SET day = ?, start_time = ?, end_time = ?, title = ?, location = ?, notes = ?
             WHERE id = ?`,
            [day, start_time, end_time || null, title.trim(), location || null, notes || null, id]
        );

        const updated = await queryOne('SELECT * FROM anubhav_timetable WHERE id = ?', [id]);
        res.json({ success: true, message: 'Timetable item updated', data: { item: updated } });
    } catch (error) {
        console.error('updateItem error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update timetable item',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// DELETE /anubhav/timetable/:id  (hard delete; the schema has no status column)
const deleteItem = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) {
            return res.status(400).json({ success: false, message: 'Invalid timetable id' });
        }

        const existing = await queryOne(
            'SELECT id, place FROM anubhav_timetable WHERE id = ?',
            [id]
        );
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Timetable item not found' });
        }
        if (locScopeBlocked(req, existing.place)) {
            return res.status(403).json({
                success: false,
                message: 'LOC users may only delete items in their assigned place'
            });
        }

        await query('DELETE FROM anubhav_timetable WHERE id = ?', [id]);
        res.json({ success: true, message: 'Timetable item deleted' });
    } catch (error) {
        console.error('deleteItem error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete timetable item',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// GET /anubhav/timetable/live?place=
// Returns the item currently in progress (if any) and the next upcoming item.
// Time math is done in SQL via TIMESTAMP(day, start_time) so the DB timezone
// is authoritative — matches NOW() in the same query.
const getLive = async (req, res) => {
    try {
        const place = req.query.place;
        if (!place) {
            return res.status(400).json({ success: false, message: 'place is required' });
        }

        const now = await queryOne(
            `SELECT *
             FROM anubhav_timetable
             WHERE place = ?
               AND TIMESTAMP(day, start_time) <= NOW()
               AND (end_time IS NULL OR TIMESTAMP(day, end_time) > NOW())
             ORDER BY TIMESTAMP(day, start_time) DESC
             LIMIT 1`,
            [place]
        );

        const next = await queryOne(
            `SELECT *
             FROM anubhav_timetable
             WHERE place = ?
               AND TIMESTAMP(day, start_time) > NOW()
             ORDER BY TIMESTAMP(day, start_time) ASC
             LIMIT 1`,
            [place]
        );

        res.json({
            success: true,
            message: 'Live timetable retrieved',
            data: { place, now: now || null, next: next || null }
        });
    } catch (error) {
        console.error('getLive error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve live timetable',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    createItem,
    listItems,
    updateItem,
    deleteItem,
    getLive
};
