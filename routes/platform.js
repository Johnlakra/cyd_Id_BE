// routes/platform.js - Multi-diocese platform routes (Phase 1).
// Public diocese registration + super_admin management. Entirely additive;
// mounted at /platform, no existing route is touched.
const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();

const platformController = require('../controllers/platformController');
const { authenticateToken, requireSuperAdmin } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');
const { createRateLimiter } = require('../middleware/rateLimit');

// Public registration is throttled hard: onboarding is rare, scraping is not.
const registerLimiter = createRateLimiter({ windowMs: 60_000, max: 5 });

// @route   POST /platform/dioceses/register
// @desc    Public diocese registration (lands as status='pending')
// @access  Public (rate limited)
router.post('/dioceses/register', [
    registerLimiter,
    body('name')
        .trim()
        .isLength({ min: 3, max: 150 })
        .withMessage('Diocese name must be between 3 and 150 characters'),
    body('slug')
        .optional()
        .trim()
        .matches(/^[a-z0-9][a-z0-9-]{1,58}$/)
        .withMessage('Slug may contain lowercase letters, numbers and hyphens'),
    body('contact_email')
        .isEmail()
        .withMessage('A valid contact email is required')
        .normalizeEmail(),
    body('contact_phone')
        .trim()
        .matches(/^[0-9+\-\s]{7,30}$/)
        .withMessage('A valid contact phone is required'),
    body('address')
        .optional()
        .trim()
        .isLength({ max: 1000 })
        .withMessage('Address too long'),
    body('logo_url')
        .optional()
        .trim()
        .isLength({ max: 2000 })
        .withMessage('Logo URL too long'),
    handleValidationErrors
], platformController.registerDiocese);

// @route   GET /platform/dioceses
// @desc    List dioceses (optional ?status=pending|active|suspended)
// @access  super_admin
router.get('/dioceses', authenticateToken, requireSuperAdmin, platformController.listDioceses);

// @route   PUT /platform/dioceses/:id/approve
// @desc    Approve a pending diocese; auto-creates its admin user
// @access  super_admin
router.put('/dioceses/:id/approve', [
    authenticateToken,
    requireSuperAdmin,
    param('id').isInt({ min: 1 }).withMessage('Diocese id must be a positive integer'),
    handleValidationErrors
], platformController.approveDiocese);

// @route   PUT /platform/dioceses/:id/suspend
// @desc    Suspend an active diocese (diocese 1 is protected)
// @access  super_admin
router.put('/dioceses/:id/suspend', [
    authenticateToken,
    requireSuperAdmin,
    param('id').isInt({ min: 1 }).withMessage('Diocese id must be a positive integer'),
    handleValidationErrors
], platformController.suspendDiocese);

module.exports = router;
