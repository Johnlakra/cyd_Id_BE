// controllers/platformController.js - Multi-diocese platform onboarding (Phase 1).
// Public diocese registration + super_admin approval/suspension. Approval
// auto-creates the diocese admin user (username `<slug>.admin`, password =
// registered contact phone, bcrypt 12 rounds — mirrors the existing
// password-is-phone convention; no DOB exists for an organisation, so the
// youth username convention is adapted to the slug).
const bcrypt = require('bcryptjs');
const { pool, query, queryOne } = require('../config/database');

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,58}$/;
const BCRYPT_ROUNDS = 12;

// 'Diocese of Jalandhar' -> 'diocese-of-jalandhar'
const slugify = (name) =>
    name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);

// @route POST /platform/dioceses/register (public)
const registerDiocese = async (req, res) => {
    try {
        const { name, slug: requestedSlug, contact_email, contact_phone, address, logo_url } = req.body;

        const slug = (requestedSlug || slugify(name) || '').toLowerCase();
        if (!SLUG_PATTERN.test(slug)) {
            return res.status(400).json({
                success: false,
                message: 'Could not derive a valid slug from the diocese name; provide a slug of lowercase letters, numbers and hyphens'
            });
        }

        const existing = await queryOne('SELECT id, status FROM dioceses WHERE slug = ?', [slug]);
        if (existing) {
            return res.status(409).json({
                success: false,
                message: 'A diocese with this slug is already registered'
            });
        }

        const result = await query(
            'INSERT INTO dioceses (name, slug, contact_email, contact_phone, address, logo_url, status) VALUES (?, ?, ?, ?, ?, ?, \'pending\')',
            [name.trim(), slug, contact_email, contact_phone, address || null, logo_url || null]
        );

        res.status(201).json({
            success: true,
            message: 'Diocese registration submitted; awaiting platform approval',
            data: { id: result.insertId, name: name.trim(), slug, status: 'pending' }
        });
    } catch (error) {
        console.error('Diocese registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Diocese registration failed',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// @route GET /platform/dioceses (super_admin)
const listDioceses = async (req, res) => {
    try {
        const { status } = req.query;
        const sql = 'SELECT id, name, slug, logo_url, contact_email, contact_phone, address, status, created_at FROM dioceses'
            + (status ? ' WHERE status = ?' : '')
            + ' ORDER BY created_at DESC';
        const dioceses = await query(sql, status ? [status] : []);

        res.json({
            success: true,
            message: 'Dioceses retrieved',
            data: { dioceses }
        });
    } catch (error) {
        console.error('List dioceses error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve dioceses',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// @route PUT /platform/dioceses/:id/approve (super_admin)
// Activates the diocese and auto-creates its admin user inside a transaction.
const approveDiocese = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const dioceseId = Number(req.params.id);
        const diocese = await queryOne('SELECT * FROM dioceses WHERE id = ?', [dioceseId]);

        if (!diocese) {
            return res.status(404).json({ success: false, message: 'Diocese not found' });
        }
        if (diocese.status === 'active') {
            return res.status(409).json({ success: false, message: 'Diocese is already active' });
        }
        if (!diocese.contact_phone) {
            return res.status(400).json({
                success: false,
                message: 'Diocese has no contact phone on record; cannot generate admin credentials'
            });
        }

        const adminUsername = `${diocese.slug}.admin`;
        const existingAdmin = await queryOne(
            'SELECT id, username FROM users WHERE diocese_id = ? AND role = \'admin\' AND status = 1',
            [dioceseId]
        );

        await connection.beginTransaction();

        let adminCreated = false;
        if (!existingAdmin) {
            const hashedPassword = await bcrypt.hash(diocese.contact_phone, BCRYPT_ROUNDS);
            await connection.execute(
                'INSERT INTO users (username, email, password, role, status, diocese_id) VALUES (?, ?, ?, \'admin\', 1, ?)',
                [adminUsername, diocese.contact_email, hashedPassword, dioceseId]
            );
            adminCreated = true;
        }

        await connection.execute('UPDATE dioceses SET status = \'active\' WHERE id = ?', [dioceseId]);
        await connection.commit();

        res.json({
            success: true,
            message: 'Diocese approved' + (adminCreated ? '; admin account created' : ''),
            data: {
                id: dioceseId,
                slug: diocese.slug,
                status: 'active',
                admin: {
                    username: existingAdmin ? existingAdmin.username : adminUsername,
                    created: adminCreated,
                    // Password is the registered contact phone (existing convention);
                    // never returned in plaintext.
                    password_hint: adminCreated ? 'registered contact phone' : undefined
                }
            }
        });
    } catch (error) {
        await connection.rollback().catch(() => {});
        console.error('Approve diocese error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to approve diocese',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        connection.release();
    }
};

// @route PUT /platform/dioceses/:id/suspend (super_admin)
const suspendDiocese = async (req, res) => {
    try {
        const dioceseId = Number(req.params.id);
        if (dioceseId === 1) {
            return res.status(400).json({
                success: false,
                message: 'The legacy diocese cannot be suspended'
            });
        }

        const diocese = await queryOne('SELECT id, status FROM dioceses WHERE id = ?', [dioceseId]);
        if (!diocese) {
            return res.status(404).json({ success: false, message: 'Diocese not found' });
        }

        await query('UPDATE dioceses SET status = \'suspended\' WHERE id = ?', [dioceseId]);

        res.json({
            success: true,
            message: 'Diocese suspended',
            data: { id: dioceseId, status: 'suspended' }
        });
    } catch (error) {
        console.error('Suspend diocese error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to suspend diocese',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    registerDiocese,
    listDioceses,
    approveDiocese,
    suspendDiocese
};
