// controllers/anubhavSpeakerController.js - Speaker management for Anubhav 2026.
// Mounted under /anubhav/speakers. CRUD is gated to admin OR dexco only (LOC -> 403)
// via requireAdminOrDexco at the route layer. The public, no-auth read of published
// speakers lives in anubhavPublicController.getSpeakers.
const { query, queryOne } = require('../config/database');
const { PLACES } = require('../middleware/anubhavRole');

// Validate place: optional, but if present must be a known place. null = all places.
const validatePlace = (place) => {
    if (place === null || place === undefined || place === '') return null;
    if (!PLACES.includes(place)) {
        return `place must be one of: ${PLACES.join(', ')} (or omitted/null for all places)`;
    }
    return null;
};

// POST /anubhav/speakers  { place?, name, role, bio, photo_url, sort_order }
const createSpeaker = async (req, res) => {
    try {
        const { place, name, role, bio, photo_url, sort_order } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'name is required' });
        }
        const placeError = validatePlace(place);
        if (placeError) {
            return res.status(400).json({ success: false, message: placeError });
        }

        const result = await query(
            `INSERT INTO anubhav_speakers
                (place, name, role, bio, photo_url, sort_order, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                place || null, name.trim(), role || null, bio || null,
                photo_url || null, Number.isInteger(sort_order) ? sort_order : 0,
                req.user.id,
            ]
        );
        const created = await queryOne('SELECT * FROM anubhav_speakers WHERE id = ?', [result.insertId]);

        res.status(201).json({
            success: true,
            message: 'Speaker created',
            data: { speaker: created },
        });
    } catch (error) {
        console.error('createSpeaker error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create speaker',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
};

// GET /anubhav/speakers  (admin/dexco) - full list INCLUDING drafts (status=0).
const listSpeakers = async (req, res) => {
    try {
        const rows = await query(
            `SELECT * FROM anubhav_speakers ORDER BY sort_order ASC, name ASC`
        );
        res.json({
            success: true,
            message: 'Speakers retrieved',
            data: { speakers: rows, count: rows.length },
        });
    } catch (error) {
        console.error('listSpeakers error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve speakers',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
};

// PUT /anubhav/speakers/:id  { place?, name?, role?, bio?, photo_url?, sort_order?, status? }
const updateSpeaker = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) {
            return res.status(400).json({ success: false, message: 'Invalid speaker id' });
        }

        const existing = await queryOne('SELECT * FROM anubhav_speakers WHERE id = ?', [id]);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Speaker not found' });
        }

        const { place, name, role, bio, photo_url, sort_order, status } = req.body;
        if (name !== undefined && !String(name).trim()) {
            return res.status(400).json({ success: false, message: 'name cannot be empty' });
        }
        if (place !== undefined) {
            const placeError = validatePlace(place);
            if (placeError) {
                return res.status(400).json({ success: false, message: placeError });
            }
        }

        // Partial update: keep existing values for any field not provided.
        const next = {
            place: place !== undefined ? (place || null) : existing.place,
            name: name !== undefined ? String(name).trim() : existing.name,
            role: role !== undefined ? (role || null) : existing.role,
            bio: bio !== undefined ? (bio || null) : existing.bio,
            photo_url: photo_url !== undefined ? (photo_url || null) : existing.photo_url,
            sort_order: Number.isInteger(sort_order) ? sort_order : existing.sort_order,
            status: status === 0 || status === 1 ? status : existing.status,
        };

        await query(
            `UPDATE anubhav_speakers
             SET place = ?, name = ?, role = ?, bio = ?, photo_url = ?, sort_order = ?, status = ?
             WHERE id = ?`,
            [next.place, next.name, next.role, next.bio, next.photo_url, next.sort_order, next.status, id]
        );
        const updated = await queryOne('SELECT * FROM anubhav_speakers WHERE id = ?', [id]);

        res.json({
            success: true,
            message: 'Speaker updated',
            data: { speaker: updated },
        });
    } catch (error) {
        console.error('updateSpeaker error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update speaker',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
};

// DELETE /anubhav/speakers/:id  (soft delete; status = 0)
const deleteSpeaker = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) {
            return res.status(400).json({ success: false, message: 'Invalid speaker id' });
        }

        const existing = await queryOne('SELECT id FROM anubhav_speakers WHERE id = ?', [id]);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Speaker not found' });
        }

        await query('UPDATE anubhav_speakers SET status = 0 WHERE id = ?', [id]);
        res.json({ success: true, message: 'Speaker removed' });
    } catch (error) {
        console.error('deleteSpeaker error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to remove speaker',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
};

module.exports = {
    createSpeaker,
    listSpeakers,
    updateSpeaker,
    deleteSpeaker,
};
