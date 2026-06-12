// routes/imports.js - Excel bulk import wizard endpoints (Platform Phase 2).
// Additive; mounted at /imports. Admin-gated and tenant-scoped: a diocese
// admin imports into their own diocese only.
const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const importController = require('../controllers/importController');
const { authenticateToken } = require('../middleware/auth');
const { tenantScope } = require('../middleware/tenantScope');
const { requirePermission } = require('../middleware/requirePermission');
const { handleValidationErrors } = require('../middleware/validation');

// Granular gate (Phase 3): admins resolve to every key, so admin access is
// unchanged; imports.run can additionally be granted to custom roles.
router.use(authenticateToken, tenantScope, requirePermission('imports.run'));

const fileRule = body('file_base64')
    .isString()
    .isLength({ min: 100 })
    .withMessage('file_base64 (base64-encoded .xlsx) is required');

// @route GET /imports/template?type=youth|org — downloadable pre-formatted template
router.get('/template', importController.getTemplate);

// @route GET /imports/jobs — import audit log for this diocese
router.get('/jobs', importController.listJobs);

// @route POST /imports/parse — wizard step 1+2: headers, sample, auto-mapping
router.post('/parse', [fileRule, handleValidationErrors], importController.parseUpload);

// @route POST /imports/youth/validate — wizard step 3: dry run, per-row errors
router.post('/youth/validate', [fileRule, handleValidationErrors], importController.validateYouth);

// @route POST /imports/youth/commit — insert valid rows (one transaction),
//        options.auto_create_users provisions profile_holder logins
router.post('/youth/commit', [fileRule, handleValidationErrors], importController.commitYouth);

// @route POST /imports/org/commit — create deanery/parish pairs from sheet
router.post('/org/commit', [fileRule, handleValidationErrors], importController.commitOrg);

module.exports = router;
