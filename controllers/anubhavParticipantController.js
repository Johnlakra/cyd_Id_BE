// controllers/anubhavParticipantController.js - Participant self-view for Anubhav 2026.
// GET /anubhav/my/event — any authenticated user sees their own registration,
// room location, roommates (name + parish only, no phone), timetable, and announcements.
const { query, queryOne } = require('../config/database');

// GET /anubhav/my/event
const getMyEvent = async (req, res) => {
    try {
        // Resolve logged-in user → linked profile
        const profile = await queryOne(
            'SELECT id, parish, deanery FROM profile WHERE profile_user_id = ? AND status = 1',
            [req.user.id]
        );
        if (!profile) {
            return res.json({
                success: true,
                message: 'Not registered for this event',
                data: { registered: false }
            });
        }

        // Find active registration (one profile can only be registered once per place)
        const registration = await queryOne(
            'SELECT id, place FROM anubhav_registrations WHERE profile_id = ? AND status = 1',
            [profile.id]
        );
        if (!registration) {
            return res.json({
                success: true,
                message: 'Not registered for this event',
                data: { registered: false }
            });
        }

        const { place, id: registrationId } = registration;

        // Room allocation — traverse allotments → rooms → floors → buildings
        let roomInfo = null;
        const allotment = await queryOne(`
            SELECT
                aa.room_id,
                r.name       AS room_name,
                f.name       AS floor_name,
                f.level,
                b.name       AS building_name
            FROM anubhav_allotments aa
            JOIN anubhav_rooms    r ON r.id = aa.room_id
            JOIN anubhav_floors   f ON f.id = r.floor_id
            JOIN anubhav_buildings b ON b.id = f.building_id
            WHERE aa.registration_id = ?
        `, [registrationId]);

        if (allotment) {
            // Roommates: other active registrations in the same room, name + parish only (no phone)
            const roommates = await query(`
                SELECT p.name, p.parish
                FROM anubhav_allotments    aa
                JOIN anubhav_registrations ar ON ar.id = aa.registration_id AND ar.status = 1
                JOIN profile               p  ON p.id  = ar.profile_id      AND p.status  = 1
                WHERE aa.room_id = ?
                  AND ar.id != ?
            `, [allotment.room_id, registrationId]);

            roomInfo = {
                building: allotment.building_name,
                floor: allotment.floor_name,
                room: allotment.room_name,
                roommates
            };
        }

        // Timetable ordered by day + start_time
        const timetable = await query(
            `SELECT * FROM anubhav_timetable
             WHERE place = ?
             ORDER BY day ASC, start_time ASC`,
            [place]
        );

        // Live view: currently running item + next upcoming
        const liveNow = await queryOne(
            `SELECT * FROM anubhav_timetable
             WHERE place = ?
               AND TIMESTAMP(day, start_time) <= NOW()
               AND (end_time IS NULL OR TIMESTAMP(day, end_time) > NOW())
             ORDER BY TIMESTAMP(day, start_time) DESC
             LIMIT 1`,
            [place]
        );
        const liveNext = await queryOne(
            `SELECT * FROM anubhav_timetable
             WHERE place = ?
               AND TIMESTAMP(day, start_time) > NOW()
             ORDER BY TIMESTAMP(day, start_time) ASC
             LIMIT 1`,
            [place]
        );

        // Announcements: place-scoped + diocese-wide (place IS NULL)
        const announcements = await query(
            `SELECT * FROM anubhav_announcements
             WHERE status = 1 AND (place = ? OR place IS NULL)
             ORDER BY created_at DESC`,
            [place]
        );

        // Derive distinct event dates from timetable
        const seen = new Set();
        const dates = timetable.reduce((acc, t) => {
            const d = t.day instanceof Date ? t.day.toISOString().split('T')[0] : String(t.day);
            if (!seen.has(d)) { seen.add(d); acc.push(d); }
            return acc;
        }, []);

        res.json({
            success: true,
            message: 'Event data retrieved',
            data: {
                registered: true,
                place,
                venue: null,
                dates,
                room: roomInfo,
                timetable,
                live: { now: liveNow || null, next: liveNext || null },
                announcements
            }
        });
    } catch (error) {
        console.error('getMyEvent error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve event data',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = { getMyEvent };
