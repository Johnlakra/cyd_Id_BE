// controllers/idCardTemplateController.js - ID card template designer (Phase 4).
// Tenant-scoped CRUD + per-(diocese, level) default resolution. Reads are open
// to any authenticated user of the diocese (profile holders render their own
// card from the resolved template); writes need the idcards.design permission.
// When nothing resolves, the FE falls back to its legacy hardcoded layout.
const { query, queryOne, pool } = require('../config/database');
const { validateLayout, GALLERY_TEMPLATES, CARD_WIDTH_MM, CARD_HEIGHT_MM } = require('../utils/idCardLayout');

const LEVEL_PATTERN = /^[a-z0-9_-]{2,40}$/;

const serverError = (res, label, error) => {
    console.error(`${label} error:`, error);
    res.status(500).json({
        success: false,
        message: `Failed to ${label}`,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
};

// mysql2 usually parses JSON columns; tolerate string values defensively.
const parseLayout = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

const shapeTemplate = (row) => ({ ...row, layout_json: parseLayout(row.layout_json) });

const findTemplate = (id, dioceseId) => queryOne(
    'SELECT * FROM id_card_templates WHERE id = ? AND diocese_id = ?',
    [id, dioceseId]
);

// @route GET /idcard-templates?level=&include_inactive=1
const listTemplates = async (req, res) => {
    try {
        const conditions = ['diocese_id = ?'];
        const params = [req.dioceseId];
        if (!req.query.include_inactive) conditions.push('status = 1');
        if (req.query.level) { conditions.push('level = ?'); params.push(req.query.level); }

        const rows = await query(
            `SELECT * FROM id_card_templates WHERE ${conditions.join(' AND ')} ORDER BY level, is_default DESC, created_at DESC`,
            params
        );
        res.json({ success: true, message: 'Templates retrieved', data: { templates: rows.map(shapeTemplate) } });
    } catch (error) {
        serverError(res, 'list templates', error);
    }
};

// @route GET /idcard-templates/resolve?level=parish
// The render path: default template for (diocese, level), else newest active,
// else 404 (FE falls back to the legacy layout).
const resolveTemplate = async (req, res) => {
    try {
        const level = String(req.query.level || '').toLowerCase();
        if (!level) return res.status(400).json({ success: false, message: 'level query param is required' });

        const row = await queryOne(
            `SELECT * FROM id_card_templates
             WHERE diocese_id = ? AND level = ? AND status = 1
             ORDER BY is_default DESC, created_at DESC LIMIT 1`,
            [req.dioceseId, level]
        );
        if (!row) {
            return res.status(404).json({ success: false, message: 'No template for this level; use the legacy layout' });
        }
        res.json({ success: true, message: 'Template resolved', data: { template: shapeTemplate(row) } });
    } catch (error) {
        serverError(res, 'resolve template', error);
    }
};

// @route GET /idcard-templates/gallery — starter presets (no DB)
const getGallery = (req, res) => {
    res.json({
        success: true,
        message: 'Gallery retrieved',
        data: {
            card: { width_mm: CARD_WIDTH_MM, height_mm: CARD_HEIGHT_MM },
            templates: GALLERY_TEMPLATES
        }
    });
};

// @route GET /idcard-templates/:id
const getTemplate = async (req, res) => {
    try {
        const row = await findTemplate(req.params.id, req.dioceseId);
        if (!row) return res.status(404).json({ success: false, message: 'Template not found in this diocese' });
        res.json({ success: true, message: 'Template retrieved', data: { template: shapeTemplate(row) } });
    } catch (error) {
        serverError(res, 'load template', error);
    }
};

// Shared body validation for create/update.
const validateTemplateBody = (body, { partial = false } = {}) => {
    const problems = [];
    if (!partial || body.level !== undefined) {
        if (!LEVEL_PATTERN.test(String(body.level || ''))) {
            problems.push('level must be 2-40 chars of lowercase letters, numbers, hyphen, underscore');
        }
    }
    if (!partial || body.name !== undefined) {
        const name = String(body.name || '').trim();
        if (name.length < 2 || name.length > 100) problems.push('name must be between 2 and 100 characters');
    }
    if (!partial || body.background_url !== undefined) {
        if (!body.background_url || String(body.background_url).length > 5000) {
            problems.push('background_url is required (max 5000 chars)');
        }
    }
    for (const dim of ['width_mm', 'height_mm']) {
        if (body[dim] !== undefined && !(typeof body[dim] === 'number' && body[dim] > 20 && body[dim] < 1000)) {
            problems.push(`${dim} must be a number between 20 and 1000`);
        }
    }
    if (!partial || body.layout_json !== undefined) {
        problems.push(...validateLayout(body.layout_json));
    }
    return problems;
};

// @route POST /idcard-templates
const createTemplate = async (req, res) => {
    try {
        const problems = validateTemplateBody(req.body);
        if (problems.length) return res.status(400).json({ success: false, message: problems.join('; ') });

        const level = String(req.body.level).toLowerCase();
        // First active template for a level becomes the default automatically.
        const existing = await queryOne(
            'SELECT id FROM id_card_templates WHERE diocese_id = ? AND level = ? AND status = 1 LIMIT 1',
            [req.dioceseId, level]
        );

        const result = await query(
            `INSERT INTO id_card_templates
               (diocese_id, level, name, background_url, width_mm, height_mm, layout_json, is_default, status, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
            [
                req.dioceseId, level, String(req.body.name).trim(), req.body.background_url,
                req.body.width_mm || CARD_WIDTH_MM, req.body.height_mm || CARD_HEIGHT_MM,
                JSON.stringify(req.body.layout_json), existing ? 0 : 1, req.user.id
            ]
        );
        const row = await queryOne('SELECT * FROM id_card_templates WHERE id = ?', [result.insertId]);
        res.status(201).json({ success: true, message: 'Template created', data: { template: shapeTemplate(row) } });
    } catch (error) {
        serverError(res, 'create template', error);
    }
};

// @route PUT /idcard-templates/:id — partial update
const updateTemplate = async (req, res) => {
    try {
        const row = await findTemplate(req.params.id, req.dioceseId);
        if (!row) return res.status(404).json({ success: false, message: 'Template not found in this diocese' });

        const problems = validateTemplateBody(req.body, { partial: true });
        if (problems.length) return res.status(400).json({ success: false, message: problems.join('; ') });

        const sets = [];
        const params = [];
        const assign = (column, value) => { sets.push(`${column} = ?`); params.push(value); };
        if (req.body.name !== undefined) assign('name', String(req.body.name).trim());
        if (req.body.background_url !== undefined) assign('background_url', req.body.background_url);
        if (req.body.width_mm !== undefined) assign('width_mm', req.body.width_mm);
        if (req.body.height_mm !== undefined) assign('height_mm', req.body.height_mm);
        if (req.body.layout_json !== undefined) assign('layout_json', JSON.stringify(req.body.layout_json));
        if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to update' });

        await query(`UPDATE id_card_templates SET ${sets.join(', ')} WHERE id = ?`, [...params, row.id]);
        const updated = await queryOne('SELECT * FROM id_card_templates WHERE id = ?', [row.id]);
        res.json({ success: true, message: 'Template updated', data: { template: shapeTemplate(updated) } });
    } catch (error) {
        serverError(res, 'update template', error);
    }
};

// @route PUT /idcard-templates/:id/default — atomic default switch per level
const setDefaultTemplate = async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const row = await findTemplate(req.params.id, req.dioceseId);
        if (!row) return res.status(404).json({ success: false, message: 'Template not found in this diocese' });
        if (!row.status) return res.status(400).json({ success: false, message: 'Cannot default an inactive template' });

        await conn.beginTransaction();
        await conn.execute(
            'UPDATE id_card_templates SET is_default = 0 WHERE diocese_id = ? AND level = ?',
            [req.dioceseId, row.level]
        );
        await conn.execute('UPDATE id_card_templates SET is_default = 1 WHERE id = ?', [row.id]);
        await conn.commit();

        res.json({ success: true, message: 'Default template set', data: { id: row.id, level: row.level } });
    } catch (error) {
        try { await conn.rollback(); } catch (_) { /* ignore */ }
        serverError(res, 'set default template', error);
    } finally {
        conn.release();
    }
};

// @route POST /idcard-templates/:id/duplicate  body: { name? }
const duplicateTemplate = async (req, res) => {
    try {
        const row = await findTemplate(req.params.id, req.dioceseId);
        if (!row) return res.status(404).json({ success: false, message: 'Template not found in this diocese' });

        const name = String(req.body?.name || `${row.name} (copy)`).trim().slice(0, 100);
        const result = await query(
            `INSERT INTO id_card_templates
               (diocese_id, level, name, background_url, width_mm, height_mm, layout_json, is_default, status, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?)`,
            [req.dioceseId, row.level, name, row.background_url, row.width_mm, row.height_mm,
                JSON.stringify(parseLayout(row.layout_json)), req.user.id]
        );
        const copy = await queryOne('SELECT * FROM id_card_templates WHERE id = ?', [result.insertId]);
        res.status(201).json({ success: true, message: 'Template duplicated', data: { template: shapeTemplate(copy) } });
    } catch (error) {
        serverError(res, 'duplicate template', error);
    }
};

// @route DELETE /idcard-templates/:id — soft delete (resolve falls back)
const deleteTemplate = async (req, res) => {
    try {
        const row = await findTemplate(req.params.id, req.dioceseId);
        if (!row) return res.status(404).json({ success: false, message: 'Template not found in this diocese' });

        await query('UPDATE id_card_templates SET status = 0, is_default = 0 WHERE id = ?', [row.id]);
        res.json({ success: true, message: 'Template deleted', data: { id: row.id } });
    } catch (error) {
        serverError(res, 'delete template', error);
    }
};

module.exports = {
    listTemplates,
    resolveTemplate,
    getGallery,
    getTemplate,
    createTemplate,
    updateTemplate,
    setDefaultTemplate,
    duplicateTemplate,
    deleteTemplate
};
