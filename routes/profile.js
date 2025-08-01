// routes/profile.js - Profile management routes
const express = require('express');
const router = express.Router();

const profileController = require('../controllers/profileController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { 
    validateProfile,
    validatePagination
} = require('../middleware/validation');

// @route   POST /api/profiles
// @desc    Create new profile
// @access  Private
router.post('/', [
    authenticateToken,
    validateProfile
], profileController.createProfile);

// @route   GET /api/profiles
// @desc    Get profiles with pagination
// @access  Private
router.get('/', [
    authenticateToken,
    validatePagination
], profileController.getProfiles);

// @route   GET /api/profiles/stats
// @desc    Get profile statistics
// @access  Private (Admin only)
router.get('/stats', [
    authenticateToken,
    requireAdmin
], profileController.getProfileStats);

// @route   GET /api/profiles/:id
// @desc    Get profile by ID
// @access  Private
router.get('/:id', authenticateToken, profileController.getProfileById);

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
router.delete('/:id', authenticateToken, profileController.deleteProfile);

module.exports = router;