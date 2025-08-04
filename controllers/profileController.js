// controllers/profileController.js - Profile management controller
const { query, queryOne } = require('../config/database');
const { saveBase64Image, deleteFile, validateBase64Image } = require('../utils/fileUpload');

// Helper function to normalize name for comparison
const normalizeName = (name) => {
    return name ? name.trim().replace(/\s+/g, ' ').toLowerCase() : null;
};

// Create new profile
const createProfile = async (req, res) => {
    try {
        const {
            name,
            father_name,
            mother_name,
            date_of_birth,
            designation,
            level,
            date_of_baptism,
            postal_address,
            parish,
            deanery,
            educational_qualification,
            phone,
            involvement,
            photo,
            issue_date
        } = req.body;

        let photoUrl = null;

        if (name) {
            const normalizedInputName = normalizeName(name);
            
            const existingProfile = await queryOne(
                'SELECT id FROM profile WHERE LOWER(TRIM(REPLACE(name, "  ", " "))) = ?',
                [normalizedInputName]
            );

            if (existingProfile) {
                return res.status(400).json({
                    success: false,
                    message: 'A profile with this name already exists'
                });
            }
        }

        // Handle photo upload if provided
        if (photo) {
            const validation = validateBase64Image(photo);
            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    message: validation.error
                });
            }

            try {
                photoUrl = await saveBase64Image(photo);
            } catch (error) {
                return res.status(400).json({
                    success: false,
                    message: `Photo upload failed: ${error.message}`
                });
            }
        }

        // Insert profile into database
        const result = await query(`
            INSERT INTO profile (
                name, father, mother, dob, designation, level, date_of_baptism,
                postal_address, parish, deanery, qualification, phone, involvement,
                photo_url,issue_date, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?)
        `, [
            name,
            father_name || null,
            mother_name || null,
            date_of_birth || null,
            designation || null,
            level || null,
            date_of_baptism || null,
            postal_address || null,
            parish || null,
            deanery || null,
            educational_qualification || null,
            phone || null,
            involvement || null,
            photoUrl,
            issue_date || null,
            req.user.id
        ]);

        // Get the created profile
        const createdProfile = await queryOne(
            'SELECT * FROM profile WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Profile created successfully',
            data: {
                profile: createdProfile
            }
        });

    } catch (error) {
        console.error('Create profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create profile',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get profiles with pagination
const getProfiles = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        let whereClause = '';
        let params = [];

        // Regular users can only see their own profiles, admins see all
        if (req.user.role !== 'admin') {
            whereClause = 'WHERE p.created_by = ?';
            params.push(req.user.id);
        }

        // Get profiles with creator info
        const profiles = await query(`
            SELECT 
                p.*,
                u.username as created_by_username,
                u.email as created_by_email
            FROM profile p
            LEFT JOIN users u ON p.created_by = u.id
            ${whereClause}
            ORDER BY p.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM profile p ${whereClause}`;
        const countResult = await queryOne(countQuery, params);
        const total = countResult.total;

        res.json({
            success: true,
            message: 'Profiles retrieved successfully',
            data: {
                profiles,
                pagination: {
                    current_page: page,
                    per_page: limit,
                    total,
                    total_pages: Math.ceil(total / limit),
                    has_next: page < Math.ceil(total / limit),
                    has_prev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get profiles error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve profiles',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get single profile by ID
const getProfileById = async (req, res) => {
    try {
        const profileId = parseInt(req.params.id);

        let whereClause = 'WHERE p.id = ?';
        let params = [profileId];

        // Regular users can only see their own profiles
        if (req.user.role !== 'admin') {
            whereClause += ' AND p.created_by = ?';
            params.push(req.user.id);
        }

        const profile = await queryOne(`
            SELECT 
                p.*,
                u.username as created_by_username,
                u.email as created_by_email
            FROM profile p
            LEFT JOIN users u ON p.created_by = u.id
            ${whereClause}
        `, params);

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found or access denied'
            });
        }

        res.json({
            success: true,
            message: 'Profile retrieved successfully',
            data: {
                profile
            }
        });

    } catch (error) {
        console.error('Get profile by ID error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve profile',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Update profile
const updateProfile = async (req, res) => {
    try {
        const profileId = parseInt(req.params.id);
        const {
            name,
            father_name,
            mother_name,
            date_of_birth,
            designation,
            level,
            date_of_baptism,
            postal_address,
            parish,
            deanery,
            educational_qualification,
            phone,
            involvement,
            photo,
            issue_date,
        } = req.body;

        // Check if profile exists and user has permission
        let whereClause = 'WHERE id = ?';
        let params = [profileId];

        if (req.user.role !== 'admin') {
            whereClause += ' AND created_by = ?';
            params.push(req.user.id);
        }

        const existingProfile = await queryOne(
            `SELECT * FROM profile ${whereClause}`,
            params
        );

        if (!existingProfile) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found or access denied'
            });
        }

        let photoUrl = existingProfile.photo_url;

        // Handle photo update
        if (photo) {
            const validation = validateBase64Image(photo);
            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    message: validation.error
                });
            }

            try {
                // Delete old photo if exists
                if (existingProfile.photo_url) {
                    await deleteFile(existingProfile.photo_url);
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

        // Update profile
        await query(`
            UPDATE profile SET
                name = ?, father = ?, mother = ?, dob = ?, designation = ?,
                level = ?, date_of_baptism = ?, postal_address = ?, parish = ?,
                deanery = ?, qualification = ?, phone = ?, involvement = ?,
                photo_url = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [
            name,
            father_name || null,
            mother_name || null,
            date_of_birth || null,
            designation || null,
            level || null,
            date_of_baptism || null,
            postal_address || null,
            parish || null,
            deanery || null,
            educational_qualification || null,
            phone || null,
            involvement || null,
            photoUrl,
            issue_date,
            profileId
        ]);

        // Get updated profile
        const updatedProfile = await queryOne(
            'SELECT * FROM profile WHERE id = ?',
            [profileId]
        );

        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: {
                profile: updatedProfile
            }
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

// Delete profile
const deleteProfile = async (req, res) => {
    try {
        const profileId = parseInt(req.params.id);

        // Check if profile exists and user has permission
        let whereClause = 'WHERE id = ?';
        let params = [profileId];

        if (req.user.role !== 'admin') {
            whereClause += ' AND created_by = ?';
            params.push(req.user.id);
        }

        const profile = await queryOne(
            `SELECT * FROM profile ${whereClause}`,
            params
        );

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found or access denied'
            });
        }

        // Delete associated photo file
        if (profile.photo_url) {
            await deleteFile(profile.photo_url);
        }

        // Delete profile from database
        await query('DELETE FROM profile WHERE id = ?', [profileId]);

        res.json({
            success: true,
            message: 'Profile deleted successfully'
        });

    } catch (error) {
        console.error('Delete profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete profile',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get profile statistics (admin only)
const getProfileStats = async (req, res) => {
    try {
        const stats = await query(`
            SELECT 
                COUNT(*) as total_profiles,
                COUNT(DISTINCT created_by) as total_creators,
                COUNT(CASE WHEN photo_url IS NOT NULL THEN 1 END) as profiles_with_photos,
                COUNT(CASE WHEN DATE(created_at) = CURDATE() THEN 1 END) as created_today,
                COUNT(CASE WHEN DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 1 END) as created_this_week
            FROM profile
        `);

        res.json({
            success: true,
            message: 'Profile statistics retrieved successfully',
            data: {
                stats: stats[0]
            }
        });

    } catch (error) {
        console.error('Get profile stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve profile statistics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    createProfile,
    getProfiles,
    getProfileById,
    updateProfile,
    deleteProfile,
    getProfileStats
};