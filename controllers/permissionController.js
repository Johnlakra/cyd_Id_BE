// controllers/permissionController.js - Role & permission management (Phase 3).
// Admin-gated, tenant-scoped: a diocese admin manages roles for their diocese
// only. Backs the FE Permission Matrix screen: catalog, roles×permissions
// grid, custom roles, duplicate-role, per-user assignment + override drawer.
const { query, queryOne, pool } = require('../config/database');
const { resolveUserPermissions } = require('../services/permissionService');

const ROLE_KEY_PATTERN = /^[a-z0-9_]{2,60}$/;

const serverError = (res, label, error) => {
    console.error(`${label} error:`, error);
    res.status(500).json({
        success: false,
        message: `Failed to ${label}`,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
};

// Target users must belong to the admin's diocese (diocese 1 owns legacy NULLs).
const findDioceseUser = (userId, dioceseId) => queryOne(
    `SELECT id, username, role, diocese_id FROM users
     WHERE id = ? AND ${dioceseId === 1 ? '(diocese_id = 1 OR diocese_id IS NULL)' : 'diocese_id = ?'}`,
    dioceseId === 1 ? [userId] : [userId, dioceseId]
);

const findDioceseRole = (roleId, dioceseId) => queryOne(
    'SELECT id, role_key, label, is_system FROM roles WHERE id = ? AND diocese_id = ?',
    [roleId, dioceseId]
);

// @route GET /permissions/catalog — grouped by module for the matrix UI
const getCatalog = async (req, res) => {
    try {
        const rows = await query('SELECT id, perm_key, module, label, description FROM permissions ORDER BY module, perm_key');
        const modules = {};
        for (const row of rows) {
            if (!modules[row.module]) modules[row.module] = [];
            modules[row.module].push(row);
        }
        res.json({ success: true, message: 'Permission catalog retrieved', data: { modules } });
    } catch (error) {
        serverError(res, 'load permission catalog', error);
    }
};

// @route GET /auth/me/permissions — flat key list for the FE usePermissions()
const getMyPermissions = async (req, res) => {
    try {
        const permissions = await resolveUserPermissions(req.user);
        res.json({
            success: true,
            message: 'Permissions resolved',
            data: { permissions: [...permissions].sort() }
        });
    } catch (error) {
        serverError(res, 'resolve permissions', error);
    }
};

// @route GET /permissions/roles — this diocese's roles with their key sets
const listRoles = async (req, res) => {
    try {
        const roles = await query(
            'SELECT id, role_key, label, is_system FROM roles WHERE diocese_id = ? ORDER BY is_system DESC, label',
            [req.dioceseId]
        );
        const links = await query(
            `SELECT rp.role_id, p.perm_key
             FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
             JOIN permissions p ON p.id = rp.permission_id
             WHERE r.diocese_id = ?`,
            [req.dioceseId]
        );
        const byRole = new Map(roles.map(r => [r.id, []]));
        for (const link of links) byRole.get(link.role_id)?.push(link.perm_key);

        res.json({
            success: true,
            message: 'Roles retrieved',
            data: { roles: roles.map(r => ({ ...r, permissions: (byRole.get(r.id) || []).sort() })) }
        });
    } catch (error) {
        serverError(res, 'list roles', error);
    }
};

// @route GET /permissions/matrix — roles × permissions grid in one call
const getMatrix = async (req, res) => {
    try {
        const permissions = await query('SELECT id, perm_key, module, label FROM permissions ORDER BY module, perm_key');
        const roles = await query(
            'SELECT id, role_key, label, is_system FROM roles WHERE diocese_id = ? ORDER BY is_system DESC, label',
            [req.dioceseId]
        );
        const links = await query(
            `SELECT rp.role_id, p.perm_key FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
             JOIN permissions p ON p.id = rp.permission_id
             WHERE r.diocese_id = ?`,
            [req.dioceseId]
        );
        const grid = {};
        for (const role of roles) grid[role.id] = [];
        for (const link of links) grid[link.role_id]?.push(link.perm_key);

        res.json({ success: true, message: 'Permission matrix retrieved', data: { permissions, roles, grid } });
    } catch (error) {
        serverError(res, 'load permission matrix', error);
    }
};

// @route POST /permissions/roles  body: { role_key, label }
const createRole = async (req, res) => {
    try {
        const roleKey = String(req.body.role_key || '').trim().toLowerCase();
        const label = String(req.body.label || '').trim();
        if (!ROLE_KEY_PATTERN.test(roleKey)) {
            return res.status(400).json({ success: false, message: 'role_key must be 2-60 chars of lowercase letters, numbers, underscores' });
        }
        if (label.length < 2 || label.length > 100) {
            return res.status(400).json({ success: false, message: 'label must be between 2 and 100 characters' });
        }

        const dup = await queryOne('SELECT id FROM roles WHERE diocese_id = ? AND role_key = ?', [req.dioceseId, roleKey]);
        if (dup) {
            return res.status(409).json({ success: false, message: 'Role key already exists in this diocese' });
        }

        const result = await query(
            'INSERT INTO roles (diocese_id, role_key, label, is_system) VALUES (?, ?, ?, 0)',
            [req.dioceseId, roleKey, label]
        );
        res.status(201).json({
            success: true,
            message: 'Role created',
            data: { id: result.insertId, role_key: roleKey, label, is_system: 0, permissions: [] }
        });
    } catch (error) {
        serverError(res, 'create role', error);
    }
};

// @route PUT /permissions/roles/:id/permissions  body: { perm_keys: [] }
// Replaces the role's key set atomically. The admin system role is immutable
// (it resolves to everything anyway).
const setRolePermissions = async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const role = await findDioceseRole(req.params.id, req.dioceseId);
        if (!role) return res.status(404).json({ success: false, message: 'Role not found in this diocese' });
        if (role.is_system && role.role_key === 'admin') {
            return res.status(400).json({ success: false, message: 'The admin system role always has every permission' });
        }

        const permKeys = req.body.perm_keys;
        if (!Array.isArray(permKeys)) {
            return res.status(400).json({ success: false, message: 'perm_keys must be an array of permission keys' });
        }

        let ids = [];
        if (permKeys.length) {
            const rows = await query(
                `SELECT id, perm_key FROM permissions WHERE perm_key IN (${permKeys.map(() => '?').join(',')})`,
                permKeys
            );
            if (rows.length !== new Set(permKeys).size) {
                const known = new Set(rows.map(r => r.perm_key));
                const unknown = permKeys.filter(k => !known.has(k));
                return res.status(400).json({ success: false, message: `Unknown permission keys: ${unknown.join(', ')}` });
            }
            ids = rows.map(r => r.id);
        }

        await conn.beginTransaction();
        await conn.execute('DELETE FROM role_permissions WHERE role_id = ?', [role.id]);
        for (const permissionId of ids) {
            await conn.execute('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [role.id, permissionId]);
        }
        await conn.commit();

        res.json({ success: true, message: 'Role permissions updated', data: { id: role.id, permissions: permKeys } });
    } catch (error) {
        try { await conn.rollback(); } catch (_) { /* ignore */ }
        serverError(res, 'update role permissions', error);
    } finally {
        conn.release();
    }
};

// @route POST /permissions/roles/:id/duplicate  body: { role_key, label }
const duplicateRole = async (req, res) => {
    try {
        const source = await findDioceseRole(req.params.id, req.dioceseId);
        if (!source) return res.status(404).json({ success: false, message: 'Role not found in this diocese' });

        const roleKey = String(req.body.role_key || '').trim().toLowerCase();
        const label = String(req.body.label || '').trim() || `${source.label} (copy)`;
        if (!ROLE_KEY_PATTERN.test(roleKey)) {
            return res.status(400).json({ success: false, message: 'role_key must be 2-60 chars of lowercase letters, numbers, underscores' });
        }
        const dup = await queryOne('SELECT id FROM roles WHERE diocese_id = ? AND role_key = ?', [req.dioceseId, roleKey]);
        if (dup) return res.status(409).json({ success: false, message: 'Role key already exists in this diocese' });

        const result = await query(
            'INSERT INTO roles (diocese_id, role_key, label, is_system) VALUES (?, ?, ?, 0)',
            [req.dioceseId, roleKey, label]
        );
        await query(
            'INSERT INTO role_permissions (role_id, permission_id) SELECT ?, permission_id FROM role_permissions WHERE role_id = ?',
            [result.insertId, source.id]
        );
        res.status(201).json({
            success: true,
            message: `Role duplicated from '${source.role_key}'`,
            data: { id: result.insertId, role_key: roleKey, label }
        });
    } catch (error) {
        serverError(res, 'duplicate role', error);
    }
};

// @route DELETE /permissions/roles/:id — custom roles only
const deleteRole = async (req, res) => {
    try {
        const role = await findDioceseRole(req.params.id, req.dioceseId);
        if (!role) return res.status(404).json({ success: false, message: 'Role not found in this diocese' });
        if (role.is_system) {
            return res.status(400).json({ success: false, message: 'System roles cannot be deleted' });
        }

        await query('DELETE FROM user_roles WHERE role_id = ?', [role.id]);
        await query('DELETE FROM role_permissions WHERE role_id = ?', [role.id]);
        await query('DELETE FROM roles WHERE id = ?', [role.id]);
        res.json({ success: true, message: 'Role deleted', data: { id: role.id } });
    } catch (error) {
        serverError(res, 'delete role', error);
    }
};

// @route GET /permissions/users/:userId — assignment + override drawer data
const getUserAccess = async (req, res) => {
    try {
        const user = await findDioceseUser(req.params.userId, req.dioceseId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found in this diocese' });

        const roles = await query(
            `SELECT r.id, r.role_key, r.label, ur.scope_type, ur.scope_ref
             FROM user_roles ur JOIN roles r ON r.id = ur.role_id
             WHERE ur.user_id = ?`,
            [user.id]
        );
        const overrides = await query(
            `SELECT p.perm_key, o.effect
             FROM user_permission_overrides o JOIN permissions p ON p.id = o.permission_id
             WHERE o.user_id = ?`,
            [user.id]
        );
        const fullUser = await queryOne('SELECT id, role, platform_role FROM users WHERE id = ?', [user.id]);
        const effective = await resolveUserPermissions(fullUser);

        res.json({
            success: true,
            message: 'User access retrieved',
            data: {
                user: { id: user.id, username: user.username, role: user.role },
                roles,
                overrides,
                effective_permissions: [...effective].sort()
            }
        });
    } catch (error) {
        serverError(res, 'load user access', error);
    }
};

// @route POST /permissions/users/:userId/roles  body: { role_id, scope_type?, scope_ref? }
const assignRole = async (req, res) => {
    try {
        const user = await findDioceseUser(req.params.userId, req.dioceseId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found in this diocese' });
        const role = await findDioceseRole(req.body.role_id, req.dioceseId);
        if (!role) return res.status(404).json({ success: false, message: 'Role not found in this diocese' });

        const scopeType = ['diocese', 'deanery', 'parish', 'event'].includes(req.body.scope_type)
            ? req.body.scope_type : 'diocese';
        const scopeRef = req.body.scope_ref ? String(req.body.scope_ref).slice(0, 100) : null;

        await query(
            `INSERT INTO user_roles (user_id, role_id, scope_type, scope_ref) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE scope_type = VALUES(scope_type), scope_ref = VALUES(scope_ref)`,
            [user.id, role.id, scopeType, scopeRef]
        );
        res.status(201).json({
            success: true,
            message: `Role '${role.role_key}' assigned`,
            data: { user_id: user.id, role_id: role.id, scope_type: scopeType, scope_ref: scopeRef }
        });
    } catch (error) {
        serverError(res, 'assign role', error);
    }
};

// @route DELETE /permissions/users/:userId/roles/:roleId
const removeRole = async (req, res) => {
    try {
        const user = await findDioceseUser(req.params.userId, req.dioceseId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found in this diocese' });
        const role = await findDioceseRole(req.params.roleId, req.dioceseId);
        if (!role) return res.status(404).json({ success: false, message: 'Role not found in this diocese' });

        await query('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?', [user.id, role.id]);
        res.json({ success: true, message: `Role '${role.role_key}' removed`, data: { user_id: user.id, role_id: role.id } });
    } catch (error) {
        serverError(res, 'remove role', error);
    }
};

// @route PUT /permissions/users/:userId/overrides  body: { perm_key, effect: 'allow'|'deny'|null }
// null clears the override.
const setOverride = async (req, res) => {
    try {
        const user = await findDioceseUser(req.params.userId, req.dioceseId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found in this diocese' });

        const permission = await queryOne('SELECT id, perm_key FROM permissions WHERE perm_key = ?', [req.body.perm_key]);
        if (!permission) return res.status(404).json({ success: false, message: 'Unknown permission key' });

        const effect = req.body.effect;
        if (effect === null || effect === undefined || effect === '') {
            await query('DELETE FROM user_permission_overrides WHERE user_id = ? AND permission_id = ?', [user.id, permission.id]);
            return res.json({ success: true, message: 'Override cleared', data: { perm_key: permission.perm_key, effect: null } });
        }
        if (!['allow', 'deny'].includes(effect)) {
            return res.status(400).json({ success: false, message: "effect must be 'allow', 'deny', or null" });
        }

        await query(
            `INSERT INTO user_permission_overrides (user_id, permission_id, effect) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE effect = VALUES(effect)`,
            [user.id, permission.id, effect]
        );
        res.json({ success: true, message: 'Override saved', data: { perm_key: permission.perm_key, effect } });
    } catch (error) {
        serverError(res, 'set permission override', error);
    }
};

module.exports = {
    getCatalog,
    getMyPermissions,
    listRoles,
    getMatrix,
    createRole,
    setRolePermissions,
    duplicateRole,
    deleteRole,
    getUserAccess,
    assignRole,
    removeRole,
    setOverride
};
