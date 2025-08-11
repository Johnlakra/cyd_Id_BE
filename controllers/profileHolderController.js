const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, queryOne } = require('../config/database');
const { saveBase64Image, deleteFile, validateBase64Image } = require('../utils/fileUpload');

// Generate JWT token
const generateToken = (userId) => {
    return jwt.sign(
        { userId },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );
};

// Profile holder login
const profileHolderLogin = async (req, res) => {
    try {
        const { username, password } = req.body;

        // Find profile holder by username
        const user = await queryOne(
            'SELECT id, username, password, role FROM users WHERE username = ? AND role = "profile_holder" AND status = 1',
            [username]
        );

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Check password
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Get associated profile
        const profile = await queryOne(
            'SELECT * FROM profile WHERE profile_user_id = ? AND status = 1',
            [user.id]
        );

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found'
            });
        }

        // Generate token
        const token = generateToken(user.id);

        // Remove password from user object
        delete user.password;

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                token,
                user,
                profile
            }
        });

    } catch (error) {
        console.error('Profile holder login error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get profile holder's own profile
const getMyProfile = async (req, res) => {
    try {
        const profile = await queryOne(
            'SELECT * FROM profile WHERE profile_user_id = ? AND status = 1',
            [req.user.id]
        );

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found'
            });
        }

        res.json({
            success: true,
            message: 'Profile retrieved successfully',
            data: { profile }
        });

    } catch (error) {
        console.error('Get my profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve profile',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Update limited profile fields
const updateLimitedProfile = async (req, res) => {
    try {
        const { photo, qualification, postal_address } = req.body;

        const profile = await queryOne(
            'SELECT * FROM profile WHERE profile_user_id = ? AND status = 1',
            [req.user.id]
        );

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found'
            });
        }

        let photoUrl = profile.photo_url;

        // Handle photo update - Same logic as profileController
        if (photo) {
            // Check if it's a URL (existing photo) or base64 (new photo)
            if (photo.startsWith('http://') || photo.startsWith('https://')) {
                // It's an existing URL, keep it as is
                photoUrl = photo;
            } else {
                // It's a base64 image, validate and upload
                const validation = validateBase64Image(photo);
                if (!validation.valid) {
                    return res.status(400).json({
                        success: false,
                        message: validation.error
                    });
                }

                try {
                    // Delete old photo if exists and is a URL
                    if (profile.photo_url && 
                        (profile.photo_url.startsWith('http://') || profile.photo_url.startsWith('https://'))) {
                        await deleteFile(profile.photo_url);
                    }

                    // Save new photo
                    photoUrl = await saveBase64Image(photo);
                } catch (error) {
                    return res.status(400).json({
                        success: false,
                        message: `Photo upload failed: ${error.message}`
                    });
                }
            }
        }

        // Update profile
        await query(`
            UPDATE profile SET
                photo_url = ?, qualification = ?, postal_address = ?, updated_at = CURRENT_TIMESTAMP
            WHERE profile_user_id = ? AND status = 1
        `, [
            photoUrl,
            qualification || profile.qualification,
            postal_address || profile.postal_address,
            req.user.id
        ]);

        // Get updated profile
        const updatedProfile = await queryOne(
            'SELECT * FROM profile WHERE profile_user_id = ? AND status = 1',
            [req.user.id]
        );

        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: { profile: updatedProfile }
        });

    } catch (error) {
        console.error('Update limited profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update profile',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get ID card data with validity check
const getMyIdCard = async (req, res) => {
    try {
        const profile = await queryOne(
            'SELECT * FROM profile WHERE profile_user_id = ? AND status = 1',
            [req.user.id]
        );

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found'
            });
        }

        // Check if ID card is still valid (2 years from issue date)
        const issueDate = new Date(profile.issue_date);
        const expiryDate = new Date(issueDate);
        expiryDate.setFullYear(issueDate.getFullYear() + 2);
        const currentDate = new Date();

        const isValid = currentDate <= expiryDate;

        res.json({
            success: true,
            message: 'ID card retrieved successfully',
            data: {
                profile,
                validity: {
                    issued: profile.issue_date,
                    expires: expiryDate.toISOString().split('T')[0],
                    isValid,
                    daysUntilExpiry: Math.ceil((expiryDate - currentDate) / (1000 * 60 * 60 * 24))
                }
            }
        });

    } catch (error) {
        console.error('Get ID card error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve ID card',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Change password
const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        // Get current password hash
        const user = await queryOne(
            'SELECT password FROM users WHERE id = ?',
            [req.user.id]
        );

        // Verify current password
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);

        if (!isCurrentPasswordValid) {
            return res.status(400).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        // Hash new password
        const saltRounds = 12;
        const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

        // Update password
        await query(
            'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [hashedNewPassword, req.user.id]
        );

        res.json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to change password',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    profileHolderLogin,
    getMyProfile,
    updateLimitedProfile,
    getMyIdCard,
    changePassword
};