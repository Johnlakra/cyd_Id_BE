// services/permissionService.js - Permission resolution + provisioning (Phase 3).
// Resolution order (master plan Pillar C):
//   super_admin            -> every catalog key
//   diocese admin (role)   -> every catalog key (scoped to their diocese by
//                             tenantScope on the route, not by the key set)
//   everyone else          -> union(assigned roles' permissions) + per-user
//                             overrides, where 'deny' wins over any grant.
// Resolution hits the DB once per request; requirePermission caches the Set
// on req.permissions.
const { query } = require('../config/database');

const allPermissionKeys = async () => {
    const rows = await query('SELECT perm_key FROM permissions');
    return new Set(rows.map(r => r.perm_key));
};

// Resolve the effective permission Set for an authenticated user row
// (needs id, role, platform_role — exactly what authenticateToken attaches).
const resolveUserPermissions = async (user) => {
    if (user.platform_role === 'super_admin' || user.role === 'admin') {
        return allPermissionKeys();
    }

    const granted = await query(
        `SELECT DISTINCT p.perm_key
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = ?`,
        [user.id]
    );
    const effective = new Set(granted.map(r => r.perm_key));

    const overrides = await query(
        `SELECT p.perm_key, o.effect
         FROM user_permission_overrides o
         JOIN permissions p ON p.id = o.permission_id
         WHERE o.user_id = ?`,
        [user.id]
    );
    for (const { perm_key, effect } of overrides) {
        if (effect === 'allow') effective.add(perm_key);
    }
    // deny wins — applied after all grants, including allow-overrides.
    for (const { perm_key, effect } of overrides) {
        if (effect === 'deny') effective.delete(perm_key);
    }

    return effective;
};

// Copy diocese 1's system roles (+ their permission links) to a new diocese.
// Runs on diocese approval, inside the caller's transaction connection.
// INSERT IGNORE keeps re-approval after a partial failure safe.
const provisionSystemRoles = async (conn, dioceseId) => {
    await conn.execute(
        `INSERT IGNORE INTO roles (diocese_id, role_key, label, is_system)
         SELECT ?, role_key, label, 1 FROM roles
         WHERE diocese_id = 1 AND is_system = 1`,
        [dioceseId]
    );
    await conn.execute(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id)
         SELECT nr.id, rp.permission_id
         FROM roles tr
         JOIN roles nr ON nr.diocese_id = ? AND nr.role_key = tr.role_key AND nr.is_system = 1
         JOIN role_permissions rp ON rp.role_id = tr.id
         WHERE tr.diocese_id = 1 AND tr.is_system = 1`,
        [dioceseId]
    );
};

module.exports = {
    resolveUserPermissions,
    allPermissionKeys,
    provisionSystemRoles
};
