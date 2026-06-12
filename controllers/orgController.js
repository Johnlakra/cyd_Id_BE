// controllers/orgController.js - Per-diocese org structure CRUD (Platform Phase 2).
// Deanery/parish become DB-driven per diocese. Tenant scope comes from
// req.dioceseId (set by authenticateToken/tenantScope). Legacy Jalandhar rows
// were backfilled to diocese_id=1; rows still NULL are treated as diocese 1.
// The legacy /anubhav/deanery-parish-map endpoint is untouched.
const { query, queryOne } = require('../config/database');

// Tenant filter fragment: diocese 1 also owns legacy NULL rows.
const dioceseWhere = (dioceseId) =>
    dioceseId === 1 ? '(diocese_id = 1 OR diocese_id IS NULL)' : 'diocese_id = ?';
const dioceseParams = (dioceseId) => (dioceseId === 1 ? [] : [dioceseId]);

const serverError = (res, label, error) => {
    console.error(`${label} error:`, error);
    res.status(500).json({
        success: false,
        message: `Failed to ${label}`,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
};

// @route GET /org/structure — deaneries with their parishes for this diocese
const getStructure = async (req, res) => {
    try {
        const where = dioceseWhere(req.dioceseId);
        const params = dioceseParams(req.dioceseId);
        const deaneries = await query(
            `SELECT id, name FROM deanery WHERE ${where} ORDER BY name`, params
        );
        const parishes = await query(
            `SELECT id, name, deanery_id FROM parish WHERE ${where} ORDER BY name`, params
        );

        const byDeanery = new Map(deaneries.map(d => [d.id, { ...d, parishes: [] }]));
        for (const p of parishes) {
            const deanery = byDeanery.get(p.deanery_id);
            if (deanery) deanery.parishes.push({ id: p.id, name: p.name });
        }

        res.json({
            success: true,
            message: 'Org structure retrieved',
            data: { deaneries: [...byDeanery.values()] }
        });
    } catch (error) {
        serverError(res, 'load org structure', error);
    }
};

// @route POST /org/deaneries  body: { name }
const createDeanery = async (req, res) => {
    try {
        const name = req.body.name.trim();
        const dup = await queryOne(
            `SELECT id FROM deanery WHERE name = ? AND ${dioceseWhere(req.dioceseId)}`,
            [name, ...dioceseParams(req.dioceseId)]
        );
        if (dup) {
            return res.status(409).json({ success: false, message: 'Deanery already exists in this diocese' });
        }

        const result = await query(
            'INSERT INTO deanery (name, created_on, diocese_id) VALUES (?, NOW(), ?)',
            [name, req.dioceseId]
        );
        res.status(201).json({
            success: true,
            message: 'Deanery created',
            data: { id: result.insertId, name }
        });
    } catch (error) {
        serverError(res, 'create deanery', error);
    }
};

// @route PUT /org/deaneries/:id  body: { name }
const updateDeanery = async (req, res) => {
    try {
        const name = req.body.name.trim();
        const deanery = await queryOne(
            `SELECT id FROM deanery WHERE id = ? AND ${dioceseWhere(req.dioceseId)}`,
            [req.params.id, ...dioceseParams(req.dioceseId)]
        );
        if (!deanery) {
            return res.status(404).json({ success: false, message: 'Deanery not found in this diocese' });
        }

        await query('UPDATE deanery SET name = ? WHERE id = ?', [name, deanery.id]);
        res.json({ success: true, message: 'Deanery updated', data: { id: deanery.id, name } });
    } catch (error) {
        serverError(res, 'update deanery', error);
    }
};

// @route DELETE /org/deaneries/:id — blocked while parishes remain under it
const deleteDeanery = async (req, res) => {
    try {
        const deanery = await queryOne(
            `SELECT id FROM deanery WHERE id = ? AND ${dioceseWhere(req.dioceseId)}`,
            [req.params.id, ...dioceseParams(req.dioceseId)]
        );
        if (!deanery) {
            return res.status(404).json({ success: false, message: 'Deanery not found in this diocese' });
        }

        const child = await queryOne('SELECT id FROM parish WHERE deanery_id = ? LIMIT 1', [deanery.id]);
        if (child) {
            return res.status(409).json({
                success: false,
                message: 'Deanery still has parishes; delete or move them first'
            });
        }

        await query('DELETE FROM deanery WHERE id = ?', [deanery.id]);
        res.json({ success: true, message: 'Deanery deleted', data: { id: deanery.id } });
    } catch (error) {
        serverError(res, 'delete deanery', error);
    }
};

// @route POST /org/parishes  body: { deanery_id, name }
const createParish = async (req, res) => {
    try {
        const name = req.body.name.trim();
        const deanery = await queryOne(
            `SELECT id FROM deanery WHERE id = ? AND ${dioceseWhere(req.dioceseId)}`,
            [req.body.deanery_id, ...dioceseParams(req.dioceseId)]
        );
        if (!deanery) {
            return res.status(404).json({ success: false, message: 'Deanery not found in this diocese' });
        }

        const dup = await queryOne(
            'SELECT id FROM parish WHERE name = ? AND deanery_id = ?',
            [name, deanery.id]
        );
        if (dup) {
            return res.status(409).json({ success: false, message: 'Parish already exists in this deanery' });
        }

        const result = await query(
            'INSERT INTO parish (name, deanery_id, created_on, diocese_id) VALUES (?, ?, NOW(), ?)',
            [name, deanery.id, req.dioceseId]
        );
        res.status(201).json({
            success: true,
            message: 'Parish created',
            data: { id: result.insertId, name, deanery_id: deanery.id }
        });
    } catch (error) {
        serverError(res, 'create parish', error);
    }
};

// @route PUT /org/parishes/:id  body: { name }
const updateParish = async (req, res) => {
    try {
        const name = req.body.name.trim();
        const parish = await queryOne(
            `SELECT id, deanery_id FROM parish WHERE id = ? AND ${dioceseWhere(req.dioceseId)}`,
            [req.params.id, ...dioceseParams(req.dioceseId)]
        );
        if (!parish) {
            return res.status(404).json({ success: false, message: 'Parish not found in this diocese' });
        }

        await query('UPDATE parish SET name = ? WHERE id = ?', [name, parish.id]);
        res.json({ success: true, message: 'Parish updated', data: { id: parish.id, name } });
    } catch (error) {
        serverError(res, 'update parish', error);
    }
};

// @route DELETE /org/parishes/:id
const deleteParish = async (req, res) => {
    try {
        const parish = await queryOne(
            `SELECT id FROM parish WHERE id = ? AND ${dioceseWhere(req.dioceseId)}`,
            [req.params.id, ...dioceseParams(req.dioceseId)]
        );
        if (!parish) {
            return res.status(404).json({ success: false, message: 'Parish not found in this diocese' });
        }

        await query('DELETE FROM parish WHERE id = ?', [parish.id]);
        res.json({ success: true, message: 'Parish deleted', data: { id: parish.id } });
    } catch (error) {
        serverError(res, 'delete parish', error);
    }
};

module.exports = {
    getStructure,
    createDeanery,
    updateDeanery,
    deleteDeanery,
    createParish,
    updateParish,
    deleteParish
};
