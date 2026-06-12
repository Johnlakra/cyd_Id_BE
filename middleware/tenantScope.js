// middleware/tenantScope.js - Multi-diocese tenancy resolution (Platform Phase 1).
// Attaches req.dioceseId for NEW tenant-aware routes. Use AFTER authenticateToken.
// Resolution order: users.diocese_id (freshest) -> already-resolved req.dioceseId
// (set by authenticateToken from the JWT claim) -> 1 (legacy Jalandhar).
// Legacy endpoints never mount this middleware and are unaffected.

const LEGACY_DIOCESE_ID = 1;

const tenantScope = (req, res, next) => {
    const fromUser = req.user && req.user.diocese_id;
    req.dioceseId = fromUser || req.dioceseId || LEGACY_DIOCESE_ID;
    next();
};

module.exports = { tenantScope, LEGACY_DIOCESE_ID };
