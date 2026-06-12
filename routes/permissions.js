// routes/permissions.js - Role & permission management (Platform Phase 3).
// Additive; mounted at /permissions. Admin-gated and tenant-scoped — backs
// the FE Permission Matrix screen.
const express = require('express');
const { param } = require('express-validator');
const router = express.Router();

const permissionController = require('../controllers/permissionController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { tenantScope } = require('../middleware/tenantScope');
const { handleValidationErrors } = require('../middleware/validation');

router.use(authenticateToken, requireAdmin, tenantScope);

const idRule = (name) => param(name).isInt({ min: 1 }).withMessage(`${name} must be a positive integer`);

// Catalog + matrix
router.get('/catalog', permissionController.getCatalog);
router.get('/matrix', permissionController.getMatrix);

// Roles
router.get('/roles', permissionController.listRoles);
router.post('/roles', permissionController.createRole);
router.put('/roles/:id/permissions', [idRule('id'), handleValidationErrors], permissionController.setRolePermissions);
router.post('/roles/:id/duplicate', [idRule('id'), handleValidationErrors], permissionController.duplicateRole);
router.delete('/roles/:id', [idRule('id'), handleValidationErrors], permissionController.deleteRole);

// Per-user assignment + overrides
router.get('/users/:userId', [idRule('userId'), handleValidationErrors], permissionController.getUserAccess);
router.post('/users/:userId/roles', [idRule('userId'), handleValidationErrors], permissionController.assignRole);
router.delete('/users/:userId/roles/:roleId', [idRule('userId'), idRule('roleId'), handleValidationErrors], permissionController.removeRole);
router.put('/users/:userId/overrides', [idRule('userId'), handleValidationErrors], permissionController.setOverride);

module.exports = router;
