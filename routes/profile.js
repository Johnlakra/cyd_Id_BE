// routes/profile.js - Profile management routes
const express = require('express');
const router = express.Router();

const profileController = require('../controllers/profileController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { 
    validateProfile,
    validatePagination,
    validateLimitedProfile
} = require('../middleware/validation');

// @route   POST /api/profiles
// @desc    Create new profile
// @access  Private
router.post('/', [
    authenticateToken,
    validateProfile
], profileController.createProfile);

// @route   GET /api/profiles
// @desc    Get profiles with advanced filtering and pagination
// @access  Private
router.get('/', [
    authenticateToken,
    validatePagination
], profileController.getProfiles);

// @route   GET /api/profiles/filter-options
// @desc    Get available filter options for dropdowns
// @access  Private
// IMPORTANT: This route must come BEFORE the /:id route to avoid conflicts
router.get('/filter-options', authenticateToken, profileController.getFilterOptions);

// @route   GET /api/profiles/stats
// @desc    Get profile statistics
// @access  Private (Admin only)
router.get('/stats', [
    authenticateToken,
    requireAdmin
], profileController.getProfileStats);

// @route   GET /api/profiles/:id/idcard-data
// @desc    Get ID-card-ready data for a profile; 400 + missing_fields if incomplete.
//          This gates ID-card printing (incomplete rows, incl. un-promoted
//          independents, cannot be printed).
// @access  Private
// IMPORTANT: must come BEFORE the bare /:id route so the more specific path wins.
router.get('/:id/idcard-data', authenticateToken, profileController.getIdCardData);

// @route   GET /api/profiles/:id
// @desc    Get profile by ID
// @access  Private
router.get('/:id', authenticateToken, profileController.getProfileById);

// @route   PUT /api/profiles/update-limited
// @desc    Update limited profile fields (photo, qualification, postal_address) for profile holders
// @access  Private (Profile holder only)
router.put('/update-limited', [
    authenticateToken,
    validateLimitedProfile // Use the new validation
], profileController.updateLimitedProfile);

// @route   PUT /api/profiles/:id
// @desc    Update profile
// @access  Private
router.put('/:id', [
    authenticateToken,
    validateProfile
], profileController.updateProfile);


// @route   DELETE /api/profiles/:id
// @desc    Delete profile
// @access  Private
router.delete('/:id', authenticateToken, profileController.softDeleteProfile);
module.exports = router;