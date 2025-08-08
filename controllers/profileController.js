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
            qualification,
            phone,
            involvement,
            photo,
            issue_date
        } = req.body;

        let photoUrl = null;

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
            qualification || null,
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

// Get profiles with pagination & Filters
const getProfiles = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        // Extract filter parameters
        const {
            search,
            deanery,
            parish,
            level,
            designation,
            sort_by = 'created_at',
            sort_order = 'DESC'
        } = req.query;

        let whereConditions = [];
        let queryParams = [];

        // Base permission check - Regular users can only see their own profiles
        if (req.user.role !== 'admin') {
            whereConditions.push('p.created_by = ?');
            queryParams.push(req.user.id);
        }

        // Apply filters
        if (deanery && deanery.trim()) {
            whereConditions.push('p.deanery = ?');
            queryParams.push(deanery.trim());
        }

        if (parish && parish.trim()) {
            whereConditions.push('p.parish = ?');
            queryParams.push(parish.trim());
        }

        if (level && level.trim()) {
            whereConditions.push('p.level = ?');
            queryParams.push(level.trim());
        }

        if (designation && designation.trim()) {
            whereConditions.push('p.designation = ?');
            queryParams.push(designation.trim());
        }

        // Search functionality - searches across multiple fields
        if (search && search.trim()) {
            const searchTerm = `%${search.trim()}%`;
            whereConditions.push(`(
                p.name LIKE ? OR 
                p.father LIKE ? OR 
                p.mother LIKE ? OR 
                p.phone LIKE ? OR 
                p.parish LIKE ? OR 
                p.deanery LIKE ? OR 
                p.designation LIKE ? OR 
                p.qualification LIKE ? OR
                p.postal_address LIKE ?
            )`);
            // Add search term for each field
            for (let i = 0; i < 9; i++) {
                queryParams.push(searchTerm);
            }
        }

        // Build WHERE clause
        const whereClause = whereConditions.length > 0 ? 
            `WHERE ${whereConditions.join(' AND ')}` : '';

        // Validate sort parameters
        const allowedSortFields = ['name', 'created_at', 'deanery', 'parish', 'level', 'designation'];
        const sortField = allowedSortFields.includes(sort_by) ? sort_by : 'created_at';
        const sortDirection = ['ASC', 'DESC'].includes(sort_order.toUpperCase()) ? 
            sort_order.toUpperCase() : 'DESC';

        // Build profile query using your working pattern
        const profileQuery = `
            SELECT 
                p.*,
                u.username as created_by_username,
                u.email as created_by_email
            FROM profile p
            LEFT JOIN users u ON p.created_by = u.id
            ${whereClause}
            ORDER BY p.${sortField} ${sortDirection}
            LIMIT ${limit} OFFSET ${offset}
        `;

        // Build count query
        const countQuery = `SELECT COUNT(*) as total FROM profile p ${whereClause}`;

        // Execute queries
        const profiles = await query(profileQuery, queryParams);
        const countResult = await queryOne(countQuery, queryParams);
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
                },
                filters: {
                    applied: {
                        search: search || null,
                        deanery: deanery || null,
                        parish: parish || null,
                        level: level || null,
                        designation: designation || null
                    }
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

// Get filter options for dropdowns - NEW
const getFilterOptions = async (req, res) => {
    try {
        let whereClause = '';
        let params = [];

        // Regular users can only see their own profiles' filter options
        if (req.user.role !== 'admin') {
            whereClause = 'WHERE created_by = ?';
            params.push(req.user.id);
        }

        const filterOptions = await query(`
            SELECT 
                DISTINCT deanery,
                parish,
                level,
                designation
            FROM profile 
            ${whereClause}
            ORDER BY deanery, parish, level, designation
        `, params);

        // Organize filter options
        const deaneries = [...new Set(filterOptions.map(p => p.deanery).filter(Boolean))];
        const parishes = [...new Set(filterOptions.map(p => p.parish).filter(Boolean))];
        const levels = [...new Set(filterOptions.map(p => p.level).filter(Boolean))];
        const designations = [...new Set(filterOptions.map(p => p.designation).filter(Boolean))];

        // Get parish-deanery mapping
        const deaneryParishMap = {};
        filterOptions.forEach(profile => {
            if (profile.deanery && profile.parish) {
                if (!deaneryParishMap[profile.deanery]) {
                    deaneryParishMap[profile.deanery] = [];
                }
                if (!deaneryParishMap[profile.deanery].includes(profile.parish)) {
                    deaneryParishMap[profile.deanery].push(profile.parish);
                }
            }
        });

        res.json({
            success: true,
            message: 'Filter options retrieved successfully',
            data: {
                deaneries,
                parishes,
                levels,
                designations,
                deanery_parish_map: deaneryParishMap
            }
        });

    } catch (error) {
        console.error('Get filter options error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve filter options',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get single profile by ID (unchanged - your working version)
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
            qualification,
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
            qualification || null,
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
    getFilterOptions, // NEW - Add this to exports
    getProfileById,
    updateProfile,
    deleteProfile,
    getProfileStats
};