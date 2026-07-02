const express = require('express');
const router = express.Router();
const { body } = require('express-validator');

const profileHolderController = require('../controllers/profileHolderController');
const { authenticateToken } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');

// Profile holder authentication middleware
const requireProfileHolder = (req, res, next) => {
    if (req.user.role !== 'profile_holder') {
        return res.status(403).json({
            success: false,
            message: 'Profile holder access required'
        });
    }
    next();
};

// @route   POST /api/profile-holder/login
// @desc    Login for profile holders
// @access  Public
router.post('/login', [
    body('username').notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required'),
    handleValidationErrors
], profileHolderController.profileHolderLogin);

// @route   GET /api/profile-holder/my-profile
// @desc    Get own profile
// @access  Private (Profile holder only)
router.get('/my-profile', [
    authenticateToken,
    requireProfileHolder
], profileHolderController.getMyProfile);

// @route   PUT /api/profile-holder/update-profile
// @desc    Update limited profile fields
// @access  Private (Profile holder only)
router.put('/update-profile', [
    authenticateToken,
    requireProfileHolder,
    body('photo').optional().custom((value) => {
        if (value && !value.match(/^data:image\/(jpeg|jpg|png|gif|bmp|webp);base64,/)) {
            throw new Error('Photo must be a valid base64 image');
        }
        return true;
    }),
    handleValidationErrors
], profileHolderController.updateLimitedProfile);

// @route   GET /api/profile-holder/my-id-card
// @desc    Get own ID card with validity check
// @access  Private (Profile holder only)
router.get('/my-id-card', [
    authenticateToken,
    requireProfileHolder
], profileHolderController.getMyIdCard);

// @route   GET /api/profile-holder/my-qr
// @desc    Get own QR code token + payload (CYD:<slug>:<token>)
// @access  Private (Profile holder only)
router.get('/my-qr', [
    authenticateToken,
    requireProfileHolder
], profileHolderController.getMyQr);

// @route   PUT /api/profile-holder/change-password
// @desc    Change password
// @access  Private (Profile holder only)
router.put('/change-password', [
    authenticateToken,
    requireProfileHolder,
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
    handleValidationErrors
], profileHolderController.changePassword);

module.exports = router;