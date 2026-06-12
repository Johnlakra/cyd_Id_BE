// routes/idCardTemplates.js - ID card template designer (Platform Phase 4).
// Additive; mounted at /idcard-templates. Reads are any-authenticated-user
// (profile holders render their card from the resolved template); writes need
// the idcards.design permission (admins resolve to every key).
const express = require('express');
const { param } = require('express-validator');
const router = express.Router();

const controller = require('../controllers/idCardTemplateController');
const { authenticateToken } = require('../middleware/auth');
const { tenantScope } = require('../middleware/tenantScope');
const { requirePermission } = require('../middleware/requirePermission');
const { handleValidationErrors } = require('../middleware/validation');

router.use(authenticateToken, tenantScope);

const idRule = param('id').isInt({ min: 1 }).withMessage('id must be a positive integer');
const canDesign = requirePermission('idcards.design');

// Reads (specific paths before /:id)
router.get('/', controller.listTemplates);
router.get('/gallery', controller.getGallery);
router.get('/resolve', controller.resolveTemplate);
router.get('/:id', [idRule, handleValidationErrors], controller.getTemplate);

// Writes
router.post('/', canDesign, controller.createTemplate);
router.put('/:id', [canDesign, idRule, handleValidationErrors], controller.updateTemplate);
router.put('/:id/default', [canDesign, idRule, handleValidationErrors], controller.setDefaultTemplate);
router.post('/:id/duplicate', [canDesign, idRule, handleValidationErrors], controller.duplicateTemplate);
router.delete('/:id', [canDesign, idRule, handleValidationErrors], controller.deleteTemplate);

module.exports = router;
