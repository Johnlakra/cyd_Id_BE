// controllers/anubhavChaperoneController.js - Chaperones (Sister/Catechist) for Anubhav 2026.
// One chaperone per parish-group per place. Mounted under /anubhav/chaperones.
const { query, queryOne } = require('../config/database');
const { PLACES } = require('../middleware/anubhavRole');

const CHAPERONE_TYPES = ['Sister', 'Catechist'];

// POST /anubhav/chaperones
// Body: { place, parish, name, phone, type }
// Place is already validated by requirePlaceAccess upstream.
const createChaperone = async (req, res) => {
    try {
        const { parish, name, phone, type } = req.body;
        const place = req.place;

        if (!parish || !name || !type) {
            return res.status(400).json({
                success: false,
                message: 'parish, name, and type are required'
            });
        }
        if (!CHAPERONE_TYPES.includes(type)) {
            return res.status(400).json({
                success: false,
                message: `type must be one of: ${CHAPERONE_TYPES.join(', ')}`
            });
        }

        const result = await query(
            `INSERT INTO anubhav_chaperones (place, parish, name, phone, type, created_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [place, parish, name, phone || null, type, req.user.id]
        );

        const created = await queryOne(
            'SELECT * FROM anubhav_chaperones WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Chaperone created',
            data: { chaperone: created }
        });
    } catch (error) {
        console.error('createChaperone error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create chaperone',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// GET /anubhav/chaperones?place=&parish=
// Lists chaperones for a place; optional parish filter.
const listChaperones = async (req, res) => {
    try {
        const place = req.place;
        const { parish } = req.query;

        const params = [place];
        let sql = 'SELECT * FROM anubhav_chaperones WHERE place = ?';
        if (parish && parish.trim()) {
            sql += ' AND parish = ?';
            params.push(parish.trim());
        }
        sql += ' ORDER BY parish ASC, name ASC';

        const chaperones = await query(sql, params);

        res.json({
            success: true,
            message: 'Chaperones retrieved',
            data: { chaperones, count: chaperones.length }
        });
    } catch (error) {
        console.error('listChaperones error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to list chaperones',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    createChaperone,
    listChaperones,
    CHAPERONE_TYPES
};
