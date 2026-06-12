// routes/org.js - Per-diocese org structure CRUD (Platform Phase 2).
// Additive; mounted at /org. Admin-gated (diocese admins manage their own
// structure; tenant scope comes from the authenticated user's diocese).
const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();

const orgController = require('../controllers/orgController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { tenantScope } = require('../middleware/tenantScope');
const { handleValidationErrors } = require('../middleware/validation');

router.use(authenticateToken, requireAdmin, tenantScope);

const nameRule = body('name')
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Name must be between 2 and 200 characters');
const idRule = param('id').isInt({ min: 1 }).withMessage('id must be a positive integer');

// @route GET /org/structure — deaneries → parishes for the admin's diocese
router.get('/structure', orgController.getStructure);

router.post('/deaneries', [nameRule, handleValidationErrors], orgController.createDeanery);
router.put('/deaneries/:id', [idRule, nameRule, handleValidationErrors], orgController.updateDeanery);
router.delete('/deaneries/:id', [idRule, handleValidationErrors], orgController.deleteDeanery);

router.post('/parishes', [
    body('deanery_id').isInt({ min: 1 }).withMessage('deanery_id must be a positive integer'),
    nameRule,
    handleValidationErrors
], orgController.createParish);
router.put('/parishes/:id', [idRule, nameRule, handleValidationErrors], orgController.updateParish);
router.delete('/parishes/:id', [idRule, handleValidationErrors], orgController.deleteParish);

module.exports = router;
