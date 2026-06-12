// middleware/requirePermission.js - Granular permission gate (Phase 3).
// Factory: requirePermission('events.create') returns middleware that resolves
// the user's effective permission Set once per request (cached on
// req.permissions) and rejects with 403 if the key is missing.
// Use AFTER authenticateToken. Legacy routes keep their old role checks; this
// gates NEW endpoints only.
const { resolveUserPermissions } = require('../services/permissionService');

const requirePermission = (permKey) => async (req, res, next) => {
    try {
        if (!req.permissions) {
            req.permissions = await resolveUserPermissions(req.user);
        }
        if (!req.permissions.has(permKey)) {
            return res.status(403).json({
                success: false,
                message: `Permission '${permKey}' required`
            });
        }
        next();
    } catch (error) {
        console.error('requirePermission error:', error);
        res.status(500).json({
            success: false,
            message: 'Permission check failed'
        });
    }
};

module.exports = { requirePermission };
