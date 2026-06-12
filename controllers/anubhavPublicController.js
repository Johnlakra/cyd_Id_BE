// controllers/anubhavPublicController.js - PUBLIC (no-auth) read endpoints for the
// Anubhav 2026 website. Strict privacy boundary: ONLY counts and non-personal data
// are exposed here. NEVER select name/phone/photo of youth, created_by, or any
// registration/roommate rows. Mounted under /anubhav/public (no authenticateToken).
const { query, queryOne } = require('../config/database');
const { PLACES } = require('../middleware/anubhavRole');
const { buildEventSummary, PER_YOUTH_FEE } = require('../constants/anubhavEvent');
const { dateToDay } = require('../utils/anubhavDay');
const { formatDateLong, formatDateShort, formatTime } = require('../utils/anubhavDate');

// Validate an optional ?place= query param. Returns { ok, place, error }.
const parseOptionalPlace = (raw) => {
    if (raw === undefined || raw === null || raw === '') return { ok: true, place: null };
    if (!PLACES.includes(raw)) {
        return { ok: false, error: `place must be one of: ${PLACES.join(', ')}` };
    }
    return { ok: true, place: raw };
};

// Validate a required ?place= query param.
const parseRequiredPlace = (raw) => {
    if (!raw || !PLACES.includes(raw)) {
        return { ok: false, error: `place is required and must be one of: ${PLACES.join(', ')}` };
    }
    return { ok: true, place: raw };
};

const fail = (res, error) => res.status(500).json({
    success: false,
    message: 'Failed to retrieve data',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined,
});

// GET /anubhav/public/event-summary
// Venues, dates, and deanery groups for the 3 places. All non-personal constants.
const getEventSummary = async (req, res) => {
    try {
        const summary = buildEventSummary();
        // Add human-readable dates per place without dropping the raw YYYY-MM-DD.
        const data = {
            ...summary,
            places: summary.places.map(p => ({
                ...p,
                datesFormatted: (p.dates || []).map(formatDateLong),
            })),
        };
        res.json({
            success: true,
            message: 'Event summary retrieved',
            data,
        });
    } catch (error) {
        console.error('public getEventSummary error:', error);
        fail(res, error);
    }
};

// GET /anubhav/public/announcements?place=
// Active announcements for the place (optional) PLUS diocese-wide (place IS NULL).
// NEVER selects created_by / contact data.
const getAnnouncements = async (req, res) => {
    try {
        const parsed = parseOptionalPlace(req.query.place);
        if (!parsed.ok) {
            return res.status(400).json({ success: false, message: parsed.error });
        }

        const rows = parsed.place
            ? await query(
                `SELECT title, body, place, created_at FROM anubhav_announcements
                 WHERE status = 1 AND (place = ? OR place IS NULL)
                 ORDER BY created_at DESC`,
                [parsed.place]
            )
            : await query(
                `SELECT title, body, place, created_at FROM anubhav_announcements
                 WHERE status = 1
                 ORDER BY created_at DESC`
            );

        const announcements = rows.map(r => ({
            ...r,
            created_at_formatted: formatDateLong(r.created_at),
            created_at_short: formatDateShort(r.created_at),
        }));

        res.json({
            success: true,
            message: 'Announcements retrieved',
            data: { place: parsed.place, announcements, count: announcements.length },
        });
    } catch (error) {
        console.error('public getAnnouncements error:', error);
        fail(res, error);
    }
};

// GET /anubhav/public/announcements/latest
// The single most recent active announcement (same non-PII fields).
const getLatestAnnouncement = async (req, res) => {
    try {
        const latest = await queryOne(
            `SELECT title, body, place, created_at FROM anubhav_announcements
             WHERE status = 1
             ORDER BY created_at DESC
             LIMIT 1`
        );
        const announcement = latest
            ? {
                ...latest,
                created_at_formatted: formatDateLong(latest.created_at),
                created_at_short: formatDateShort(latest.created_at),
            }
            : null;

        res.json({
            success: true,
            message: 'Latest announcement retrieved',
            data: { announcement },
        });
    } catch (error) {
        console.error('public getLatestAnnouncement error:', error);
        fail(res, error);
    }
};

// GET /anubhav/public/timetable?place=
// Ordered timetable for a place. NO created_by. Day returned as integer 1-3 (or date).
const getTimetable = async (req, res) => {
    try {
        const parsed = parseRequiredPlace(req.query.place);
        if (!parsed.ok) {
            return res.status(400).json({ success: false, message: parsed.error });
        }

        const rows = await query(
            `SELECT day, start_time, end_time, title, location, notes
             FROM anubhav_timetable
             WHERE place = ?
             ORDER BY day ASC, start_time ASC`,
            [parsed.place]
        );
        const items = rows.map(r => ({
            ...r,
            day: dateToDay(parsed.place, r.day) || r.day,
            date_formatted: formatDateLong(r.day),
            date_short: formatDateShort(r.day),
            start_time_formatted: formatTime(r.start_time),
            end_time_formatted: formatTime(r.end_time),
        }));

        res.json({
            success: true,
            message: 'Timetable retrieved',
            data: { place: parsed.place, items, count: items.length },
        });
    } catch (error) {
        console.error('public getTimetable error:', error);
        fail(res, error);
    }
};

// GET /anubhav/public/stats
// Aggregate COUNTS ONLY across all places. Never includes name/phone/photo or any row.
const getStats = async (req, res) => {
    try {
        const regRows = await query(
            `SELECT place, COUNT(*) AS registered
             FROM anubhav_registrations
             WHERE status = 1
             GROUP BY place`
        );
        // Allotted = distinct active registrations that have a room allotment.
        const allotRows = await query(
            `SELECT r.place AS place, COUNT(DISTINCT a.registration_id) AS allotted
             FROM anubhav_allotments a
             JOIN anubhav_registrations r ON r.id = a.registration_id AND r.status = 1
             GROUP BY r.place`
        );

        const regMap = new Map(regRows.map(r => [r.place, Number(r.registered)]));
        const allotMap = new Map(allotRows.map(r => [r.place, Number(r.allotted)]));

        const byPlace = PLACES.map(place => ({
            place,
            registered: regMap.get(place) || 0,
            allotted: allotMap.get(place) || 0,
        }));

        const totals = byPlace.reduce(
            (acc, p) => ({
                registered: acc.registered + p.registered,
                allotted: acc.allotted + p.allotted,
            }),
            { registered: 0, allotted: 0 }
        );

        res.json({
            success: true,
            message: 'Stats retrieved',
            data: { byPlace, totals, perYouthFee: PER_YOUTH_FEE },
        });
    } catch (error) {
        console.error('public getStats error:', error);
        fail(res, error);
    }
};

// GET /anubhav/public/speakers?place=
// Published speakers (status=1). place filter optional; NULL-place speakers always
// appear. Returns name, role, bio, photo_url, place (speakers are non-youth presenters).
const getSpeakers = async (req, res) => {
    try {
        const parsed = parseOptionalPlace(req.query.place);
        if (!parsed.ok) {
            return res.status(400).json({ success: false, message: parsed.error });
        }

        const rows = parsed.place
            ? await query(
                `SELECT name, role, bio, photo_url, place FROM anubhav_speakers
                 WHERE status = 1 AND (place = ? OR place IS NULL)
                 ORDER BY sort_order ASC, name ASC`,
                [parsed.place]
            )
            : await query(
                `SELECT name, role, bio, photo_url, place FROM anubhav_speakers
                 WHERE status = 1
                 ORDER BY sort_order ASC, name ASC`
            );

        res.json({
            success: true,
            message: 'Speakers retrieved',
            data: { place: parsed.place, speakers: rows, count: rows.length },
        });
    } catch (error) {
        console.error('public getSpeakers error:', error);
        fail(res, error);
    }
};

module.exports = {
    getEventSummary,
    getAnnouncements,
    getLatestAnnouncement,
    getTimetable,
    getStats,
    getSpeakers,
};
