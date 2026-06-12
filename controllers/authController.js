// controllers/authController.js - Authentication controller
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, queryOne } = require('../config/database');

// Generate JWT token
// diocese_id claim added for multi-diocese platform; tokens issued before this
// change (no claim) resolve to diocese 1 (Jalandhar) in middleware.
const generateToken = (userId, dioceseId) => {
    return jwt.sign(
        { userId, diocese_id: dioceseId || 1 },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );
};

// Register new user
const register = async (req, res) => {
    try {
        const { username, email, password, role = 'user' } = req.body;

        // Check if user already exists
        const existingUser = await queryOne(
            'SELECT id FROM users WHERE username = ? OR email = ?',
            [username, email]
        );

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Username or email already exists'
            });
        }

        // Hash password
        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Insert user
        const result = await query(
            'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
            [username, email, hashedPassword, role]
        );

        // Generate token
        const token = generateToken(result.insertId);

        // Get user data (without password)
        const user = await queryOne(
            'SELECT id, username, email, role, created_at FROM users WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: {
                token,
                user
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Login user
const login = async (req, res) => {
    try {
        const { username, password } = req.body;

        // Find user by username or email
        const user = await queryOne(
            'SELECT id, username, email, password, role, diocese_id FROM users WHERE (username = ? OR email = ?) AND status = 1',
            [username, username]
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

        // Generate token
        const token = generateToken(user.id, user.diocese_id);

        // Remove password from user object
        delete user.password;

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                token,
                user
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get current user profile
const getProfile = async (req, res) => {
    try {
        const user = await queryOne(
            'SELECT id, username, email, role, created_at, updated_at FROM users WHERE id = ?',
            [req.user.id]
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            message: 'Profile retrieved successfully',
            data: { user }
        });

    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve profile',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Update user profile
const updateProfile = async (req, res) => {
    try {
        const { username, email } = req.body;
        const userId = req.user.id;

        // Check if username/email is taken by another user
        if (username || email) {
            const existingUser = await queryOne(
                'SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ?',
                [username || '', email || '', userId]
            );

            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: 'Username or email already exists'
                });
            }
        }

        // Build update query dynamically
        const updates = [];
        const values = [];

        if (username) {
            updates.push('username = ?');
            values.push(username);
        }

        if (email) {
            updates.push('email = ?');
            values.push(email);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No fields to update'
            });
        }

        values.push(userId);

        await query(
            `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            values
        );

        // Get updated user
        const updatedUser = await queryOne(
            'SELECT id, username, email, role, created_at, updated_at FROM users WHERE id = ?',
            [userId]
        );

        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: { user: updatedUser }
        });

    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update profile',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Change password
const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id;

        // Get current password hash
        const user = await queryOne(
            'SELECT password FROM users WHERE id = ?',
            [userId]
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
            [hashedNewPassword, userId]
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

// Logout (client-side token removal)
const logout = async (req, res) => {
    // In JWT, we don't store sessions server-side, so logout is mainly client-side
    // But we can add token blacklisting in the future if needed
    
    res.json({
        success: true,
        message: 'Logout successful'
    });
};

module.exports = {
    register,
    login,
    getProfile,
    updateProfile,
    changePassword,
    logout
};