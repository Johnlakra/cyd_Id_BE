// controllers/anubhavTimetableController.js - Per-place timetable + "Live Now /
// Up Next" view for Anubhav 2026. Mounted under /anubhav/timetable.
// Mutations are restricted to LOC/DEXCO. Reads are open to any authenticated user
// (every youth must see their place's schedule).
const { query, queryOne } = require('../config/database');

const locScopeBlocked = (req, place) =>
    req.user.event_role === 'loc' && req.user.loc_place !== place;

// Each place's retreat starts on a fixed date; day 1-3 maps to start+0, +1, +2.
const PLACE_START_DATES = {
    phagwara: '2026-06-02',
    abohar:   '2026-06-04',
    amritsar: '2026-06-06',
};

// Accepts integer 1-3 or YYYY-MM-DD string. Returns YYYY-MM-DD for DB storage.
const resolveDay = (place, day) => {
    const n = Number(day);
    if (Number.isInteger(n) && n >= 1 && n <= 3) {
        const start = new Date(PLACE_START_DATES[place] || PLACE_START_DATES.phagwara);
        start.setUTCDate(start.getUTCDate() + n - 1);
        return start.toISOString().slice(0, 10);
    }
    return String(day);
};

// Converts a stored YYYY-MM-DD date back to day number 1-3 (or 0 if out of range).
const dateToDay = (place, dateStr) => {
    const start = PLACE_START_DATES[place];
    if (!start || !dateStr) return 0;
    const diff = Math.round(
        (new Date(dateStr) - new Date(start)) / (1000 * 60 * 60 * 24)
    ) + 1;
    return diff >= 1 && diff <= 3 ? diff : 0;
};

// Lightweight body validators shared by POST and PUT.
const validateTimetableBody = ({ day, start_time, title, end_time }) => {
    const n = Number(day);
    const isIntDay = Number.isInteger(n) && n >= 1 && n <= 3;
    const isDateDay = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day);
    if (!day || (!isIntDay && !isDateDay)) {
        return 'day is required as an integer 1-3 or YYYY-MM-DD';
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

        const dayDate = resolveDay(place, day);
        const result = await query(
            `INSERT INTO anubhav_timetable
                (place, day, start_time, end_time, title, location, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                place, dayDate, start_time, end_time || null,
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
            data: { item: { ...created, day: dateToDay(place, created.day) || created.day } }
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

        const rows = await query(
            `SELECT * FROM anubhav_timetable
             WHERE place = ?
             ORDER BY day ASC, start_time ASC`,
            [place]
        );
        const items = rows.map(r => ({ ...r, day: dateToDay(place, r.day) || r.day }));

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

        const dayDate = resolveDay(existing.place, day);
        await query(
            `UPDATE anubhav_timetable
             SET day = ?, start_time = ?, end_time = ?, title = ?, location = ?, notes = ?
             WHERE id = ?`,
            [dayDate, start_time, end_time || null, title.trim(), location || null, notes || null, id]
        );

        const updated = await queryOne('SELECT * FROM anubhav_timetable WHERE id = ?', [id]);
        res.json({
            success: true,
            message: 'Timetable item updated',
            data: { item: { ...updated, day: dateToDay(existing.place, updated.day) || updated.day } }
        });
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

        const toItem = (r) => r ? { ...r, day: dateToDay(place, r.day) || r.day } : null;
        res.json({
            success: true,
            message: 'Live timetable retrieved',
            data: { place, now: toItem(now), next: toItem(next) }
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
