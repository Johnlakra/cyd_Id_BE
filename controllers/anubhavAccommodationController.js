// controllers/anubhavAccommodationController.js - Building/Floor/Room hierarchy
// and the rooming (PDF data) endpoint for Anubhav 2026. Mounted under
// /anubhav/buildings, /anubhav/floors, /anubhav/rooms, /anubhav/rooming.
//
// Place enforcement: /buildings POST/GET and /rooming GET use requirePlaceAccess
// upstream. /floors and /rooms POST carry no `place` in the request, so place is
// derived from the parent row and the LOC scope check happens here.
const { query, queryOne } = require('../config/database');
const { PLACES } = require('../middleware/anubhavRole');

// Resolve a building's place. Returns null if the building does not exist.
const placeOfBuilding = async (buildingId) => {
    const row = await queryOne(
        'SELECT place FROM anubhav_buildings WHERE id = ?',
        [buildingId]
    );
    return row ? row.place : null;
};

// Resolve a floor's place via its building.
const placeOfFloor = async (floorId) => {
    const row = await queryOne(`
        SELECT b.place
        FROM anubhav_floors f
        JOIN anubhav_buildings b ON b.id = f.building_id
        WHERE f.id = ?
    `, [floorId]);
    return row ? row.place : null;
};

// Reject the request if a LOC user is acting outside their loc_place.
const locScopeBlocked = (req, place) =>
    req.user.event_role === 'loc' && req.user.loc_place !== place;

// POST /anubhav/buildings  { place, name }
const createBuilding = async (req, res) => {
    try {
        const { name } = req.body;
        const place = req.place;

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'name is required' });
        }

        const result = await query(
            'INSERT INTO anubhav_buildings (place, name, created_by) VALUES (?, ?, ?)',
            [place, name.trim(), req.user.id]
        );
        const created = await queryOne(
            'SELECT * FROM anubhav_buildings WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Building created',
            data: { building: created }
        });
    } catch (error) {
        console.error('createBuilding error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create building',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// GET /anubhav/buildings?place=
// Returns the full Building -> Floor -> Room hierarchy for the place, with
// per-room occupancy and vacancy.
const listBuildings = async (req, res) => {
    try {
        const place = req.place;

        const buildings = await query(
            'SELECT id, place, name, created_at FROM anubhav_buildings WHERE place = ? ORDER BY name',
            [place]
        );
        if (buildings.length === 0) {
            return res.json({
                success: true,
                message: 'Buildings retrieved',
                data: { place, buildings: [] }
            });
        }

        const buildingIds = buildings.map(b => b.id);
        const floors = await query(
            `SELECT id, building_id, name, level
             FROM anubhav_floors
             WHERE building_id IN (${buildingIds.map(() => '?').join(',')})
             ORDER BY level ASC, name ASC`,
            buildingIds
        );

        const floorIds = floors.map(f => f.id);
        let rooms = [];
        if (floorIds.length > 0) {
            rooms = await query(`
                SELECT
                    r.id, r.floor_id, r.name, r.capacity,
                    COALESCE(a.occupancy, 0) AS occupancy
                FROM anubhav_rooms r
                LEFT JOIN (
                    SELECT room_id, COUNT(*) AS occupancy
                    FROM anubhav_allotments
                    GROUP BY room_id
                ) a ON a.room_id = r.id
                WHERE r.floor_id IN (${floorIds.map(() => '?').join(',')})
                ORDER BY r.name ASC
            `, floorIds);
        }

        // Reshape into nested structure.
        const roomsByFloor = rooms.reduce((acc, r) => {
            (acc[r.floor_id] = acc[r.floor_id] || []).push({
                id: r.id,
                name: r.name,
                capacity: r.capacity,
                occupancy: Number(r.occupancy) || 0,
                vacant: Math.max(0, r.capacity - (Number(r.occupancy) || 0))
            });
            return acc;
        }, {});
        const floorsByBuilding = floors.reduce((acc, f) => {
            (acc[f.building_id] = acc[f.building_id] || []).push({
                id: f.id,
                name: f.name,
                level: f.level,
                rooms: roomsByFloor[f.id] || []
            });
            return acc;
        }, {});
        const nested = buildings.map(b => ({
            id: b.id,
            place: b.place,
            name: b.name,
            floors: floorsByBuilding[b.id] || []
        }));

        res.json({
            success: true,
            message: 'Buildings retrieved',
            data: { place, buildings: nested }
        });
    } catch (error) {
        console.error('listBuildings error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to list buildings',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// POST /anubhav/floors  { building_id, name, level }
const createFloor = async (req, res) => {
    try {
        const { building_id, name, level } = req.body;

        if (!building_id || !name || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: 'building_id and name are required'
            });
        }

        const place = await placeOfBuilding(building_id);
        if (!place) {
            return res.status(404).json({ success: false, message: 'Building not found' });
        }
        if (locScopeBlocked(req, place)) {
            return res.status(403).json({
                success: false,
                message: 'LOC users may only act within their assigned place'
            });
        }

        const result = await query(
            'INSERT INTO anubhav_floors (building_id, name, level) VALUES (?, ?, ?)',
            [building_id, name.trim(), Number.isInteger(level) ? level : 0]
        );
        const created = await queryOne(
            'SELECT * FROM anubhav_floors WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Floor created',
            data: { floor: created }
        });
    } catch (error) {
        console.error('createFloor error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create floor',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// POST /anubhav/rooms  { floor_id, name, capacity }
const createRoom = async (req, res) => {
    try {
        const { floor_id, name, capacity } = req.body;

        if (!floor_id || !name || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: 'floor_id and name are required'
            });
        }
        const cap = Number.parseInt(capacity, 10);
        if (!Number.isFinite(cap) || cap <= 0) {
            return res.status(400).json({
                success: false,
                message: 'capacity must be a positive integer'
            });
        }

        const place = await placeOfFloor(floor_id);
        if (!place) {
            return res.status(404).json({ success: false, message: 'Floor not found' });
        }
        if (locScopeBlocked(req, place)) {
            return res.status(403).json({
                success: false,
                message: 'LOC users may only act within their assigned place'
            });
        }

        const result = await query(
            'INSERT INTO anubhav_rooms (floor_id, name, capacity) VALUES (?, ?, ?)',
            [floor_id, name.trim(), cap]
        );
        const created = await queryOne(
            'SELECT * FROM anubhav_rooms WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Room created',
            data: { room: created }
        });
    } catch (error) {
        console.error('createRoom error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create room',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// GET /anubhav/rooming?place=&building_id?&floor_id?&room_id?
// Returns place > buildings > floors > rooms > occupants, shaped so jsPDF can
// render per-room / per-floor / per-building / full-place sheets without
// additional calls.
const getRoomingData = async (req, res) => {
    try {
        const place = req.place;
        const { building_id, floor_id, room_id } = req.query;

        const params = [place];
        const conditions = ['b.place = ?'];
        if (building_id) { conditions.push('b.id = ?'); params.push(building_id); }
        if (floor_id)    { conditions.push('f.id = ?'); params.push(floor_id); }
        if (room_id)     { conditions.push('r.id = ?'); params.push(room_id); }

        const rows = await query(`
            SELECT
                b.id   AS building_id,  b.name AS building_name,
                f.id   AS floor_id,     f.name AS floor_name,     f.level AS floor_level,
                r.id   AS room_id,      r.name AS room_name,      r.capacity AS room_capacity,
                a.id   AS allotment_id,
                p.id   AS profile_id,   p.name AS occupant_name,
                p.father AS occupant_father_name,
                p.phone AS occupant_phone, p.parish AS occupant_parish,
                p.deanery AS occupant_deanery
            FROM anubhav_buildings b
            JOIN anubhav_floors f      ON f.building_id = b.id
            JOIN anubhav_rooms r       ON r.floor_id = f.id
            LEFT JOIN anubhav_allotments a   ON a.room_id = r.id
            LEFT JOIN anubhav_registrations reg ON reg.id = a.registration_id AND reg.status = 1
            LEFT JOIN profile p        ON p.id = reg.profile_id
            WHERE ${conditions.join(' AND ')}
            ORDER BY b.name, f.level, f.name, r.name, p.name
        `, params);

        // Reshape: building -> floor -> room -> occupants[]
        const byBuilding = new Map();
        for (const row of rows) {
            let b = byBuilding.get(row.building_id);
            if (!b) {
                b = { id: row.building_id, name: row.building_name, floors: new Map() };
                byBuilding.set(row.building_id, b);
            }
            let f = b.floors.get(row.floor_id);
            if (!f) {
                f = { id: row.floor_id, name: row.floor_name, level: row.floor_level, rooms: new Map() };
                b.floors.set(row.floor_id, f);
            }
            let rm = f.rooms.get(row.room_id);
            if (!rm) {
                rm = { id: row.room_id, name: row.room_name, capacity: row.room_capacity, occupants: [] };
                f.rooms.set(row.room_id, rm);
            }
            if (row.allotment_id && row.profile_id) {
                rm.occupants.push({
                    allotment_id: row.allotment_id,
                    profile_id: row.profile_id,
                    name: row.occupant_name,
                    father_name: row.occupant_father_name || null,
                    phone: row.occupant_phone,
                    parish: row.occupant_parish,
                    deanery: row.occupant_deanery
                });
            }
        }

        const buildings = [...byBuilding.values()].map(b => ({
            ...b,
            floors: [...b.floors.values()].map(f => ({
                ...f,
                rooms: [...f.rooms.values()].map(r => ({
                    ...r,
                    occupancy: r.occupants.length,
                    vacant: Math.max(0, r.capacity - r.occupants.length)
                }))
            }))
        }));

        res.json({
            success: true,
            message: 'Rooming data retrieved',
            data: { place, buildings }
        });
    } catch (error) {
        console.error('getRoomingData error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve rooming data',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    createBuilding,
    listBuildings,
    createFloor,
    createRoom,
    getRoomingData,
    placeOfBuilding,
    placeOfFloor
};
