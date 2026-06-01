// controllers/profileController.js - Profile management controller
const { query, queryOne } = require('../config/database');
const { saveBase64Image, deleteFile, validateBase64Image } = require('../utils/fileUpload');
const bcrypt = require('bcryptjs');
const { isIdCardComplete, missingIdCardFields } = require('./anubhavConstants');

// Helper function to normalize name for comparison
const normalizeName = (name) => {
    return name ? name.trim().replace(/\s+/g, ' ').toLowerCase() : null;
};

// Helper function to generate username
const generateUsername = (name, dateOfBirth) => {
    // Get first 4 letters of name, remove spaces and special characters
    const namePrefix = name.trim()
        .replace(/\s+/g, '') // Remove all spaces
        .replace(/[^a-zA-Z]/g, '') // Remove all non-letter characters
        .substring(0, 4)
        .toLowerCase();
    
    // Parse date to get day and month (YYYY-MM-DD format)
    const dateParts = dateOfBirth.split('-');
    const day = dateParts[2]; // DD
    const month = dateParts[1]; // MM
    
    // Format: first4letters + DD + MM
    return namePrefix + day + month;
};

// Helper function to create profile holder account
const createProfileHolderAccount = async (name, dateOfBirth, phone) => {
    try {
        let username = generateUsername(name, dateOfBirth);
        const password = phone.replace(/\D/g, ''); // Remove non-digit characters
        
        // Check if username already exists and make it unique
        let existingUser = await queryOne('SELECT id FROM users WHERE username = ?', [username]);
        let counter = 1;
        
        while (existingUser) {
            username = generateUsername(name, dateOfBirth) + counter;
            existingUser = await queryOne('SELECT id FROM users WHERE username = ?', [username]);
            counter++;
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);
        
        // Create user account
        const result = await query(
            'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
            [username, `${username}@profile.local`, hashedPassword, 'profile_holder']
        );
        
        return {
            userId: result.insertId,
            username: username,
            password: phone // Return original phone for response
        };
    } catch (error) {
        console.error('Error creating profile holder account:', error);
        throw error;
    }
};

// Update the createProfile function (replace the existing one)
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

        // Check for soft-deleted profile with same name and phone
        const deletedProfile = await queryOne(
            'SELECT * FROM profile WHERE name = ? AND phone = ? AND status = 0',
            [normalizeName(name), phone]
        );

        let photoUrl = null;
        let profileHolderAccount = null;

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

        let profileId;

        if (deletedProfile) {
            // Check if there's a soft-deleted user account
            const baseUsername = generateUsername(name, date_of_birth);
            const deletedUser = await queryOne(
                'SELECT * FROM users WHERE username LIKE ? AND role = "profile_holder" AND status = 0 ORDER BY id DESC LIMIT 1',
                [`${baseUsername}%`]
            );

            if (deletedUser) {
                // Reactivate the existing user account
                const hashedPassword = await bcrypt.hash(phone.replace(/\D/g, ''), 12);
                await query(
                    'UPDATE users SET status = 1, password = ?, updated_at = NOW() WHERE id = ?',
                    [hashedPassword, deletedUser.id]
                );
                profileHolderAccount = {
                    userId: deletedUser.id,
                    username: deletedUser.username,
                    password: phone
                };
            } else {
                // Create new profile holder account
                profileHolderAccount = await createProfileHolderAccount(name, date_of_birth, phone);
            }

            // Restore deleted profile with new data
            await query(`
                UPDATE profile SET
                    name = ?, father = ?, mother = ?, dob = ?, designation = ?,
                    level = ?, date_of_baptism = ?, postal_address = ?, parish = ?,
                    deanery = ?, qualification = ?, phone = ?, involvement = ?,
                    photo_url = ?, issue_date = ?, profile_user_id = ?, status = 1,
                    created_by = ?, updated_at = NOW()
                WHERE id = ?
            `, [
                normalizeName(name), father_name || null, mother_name || null,
                date_of_birth || null, designation || null, level || null,
                date_of_baptism || null, postal_address || null, parish || null,
                deanery || null, qualification || null, phone || null,
                involvement || null, photoUrl, issue_date || null,
                profileHolderAccount.userId, req.user.id, deletedProfile.id
            ]);
            
            profileId = deletedProfile.id;
        } else {
            // Create new profile holder account
            profileHolderAccount = await createProfileHolderAccount(name, date_of_birth, phone);
            
            // Create new profile
            const result = await query(`
                INSERT INTO profile (
                    name, father, mother, dob, designation, level, date_of_baptism,
                    postal_address, parish, deanery, qualification, phone, involvement,
                    photo_url, issue_date, status, profile_user_id, created_by, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NOW(), NOW())
            `, [
                normalizeName(name), father_name || null, mother_name || null,
                date_of_birth || null, designation || null, level || null,
                date_of_baptism || null, postal_address || null, parish || null,
                deanery || null, qualification || null, phone || null,
                involvement || null, photoUrl, issue_date || null,
                profileHolderAccount.userId, req.user.id
            ]);
            
            profileId = result.insertId;
        }

        // Get the created/restored profile
        const createdProfile = await queryOne(
            'SELECT * FROM profile WHERE id = ?',
            [profileId]
        );

        res.status(201).json({
            success: true,
            message: deletedProfile ? 'Profile restored successfully' : 'Profile created successfully',
            data: {
                profile: createdProfile,
                credentials: {
                    username: profileHolderAccount.username,
                    password: profileHolderAccount.password,
                    message: 'These credentials have been created for the profile holder to login'
                }
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

        whereConditions.push('p.status = 1');
        // Independents (Anubhav Option B) are profile rows flagged is_independent=1.
        // They must NOT appear on the ID-card profile list — only real ID-card
        // profiles are shown here. Independents are managed via /anubhav/independents.
        whereConditions.push('p.is_independent = 0');

        // Base permission check - Profile holders can only see their own profile
        if (req.user.role === 'profile_holder') {
            whereConditions.push('p.profile_user_id = ?');
            queryParams.push(req.user.id);
        } else if (req.user.role !== 'admin') {
            // Regular users can only see their own created profiles
            whereConditions.push('p.created_by = ?');
            queryParams.push(req.user.id);
        }

        // Apply filters only for admin and regular users (not profile holders)
        if (req.user.role !== 'profile_holder') {
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
            const searchTerm = `%${search.trim().toLowerCase()}%`;
            whereConditions.push(`(
                LOWER(p.name) LIKE ? OR 
                LOWER(p.father) LIKE ? OR 
                LOWER(p.mother) LIKE ? OR 
                p.phone LIKE ? OR 
                LOWER(p.parish) LIKE ? OR 
                LOWER(p.deanery) LIKE ? OR 
                LOWER(p.designation) LIKE ? OR 
                LOWER(p.qualification) LIKE ? OR
                LOWER(p.postal_address) LIKE ?
            )`);
                // Add search term for each field
                for (let i = 0; i < 9; i++) {
                    queryParams.push(searchTerm);
                }
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

        // Build profile query
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

// Get filter options for dropdowns
const getFilterOptions = async (req, res) => {
    try {
        let whereClause = 'WHERE status = 1';
        let params = [];

        // Profile holders can only see their own profiles' filter options
        if (req.user.role === 'profile_holder') {
            whereClause += ' AND profile_user_id = ?';
            params.push(req.user.id);
        } else if (req.user.role !== 'admin') {
            // Regular users can only see their own created profiles' filter options
            whereClause += ' AND created_by = ?';
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
            if (existingProfile.photo_url && 
                (existingProfile.photo_url.startsWith('http://') || existingProfile.photo_url.startsWith('https://'))) {
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
        }

        // Update profile
        await query(`
            UPDATE profile SET
                name = ?, father = ?, mother = ?, dob = ?, designation = ?,
                level = ?, date_of_baptism = ?, postal_address = ?, parish = ?,
                deanery = ?, qualification = ?, phone = ?, involvement = ?,
                photo_url = ?, issue_date = ?, updated_at = CURRENT_TIMESTAMP
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
            issue_date || null,
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

// Add new function for profile holders to update their limited fields
const updateLimitedProfile = async (req, res) => {
    try {
        const { photo, qualification, postal_address } = req.body;

        // Get profile holder's profile
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

// Soft delete function
const softDeleteProfile = async (req, res) => {
    try {
        const profileId = parseInt(req.params.id);

        let whereClause = 'WHERE id = ? AND status = 1';
        let params = [profileId];

        if (req.user.role !== 'admin') {
            whereClause += ' AND created_by = ?';
            params.push(req.user.id);
        }

        const profile = await queryOne(`SELECT * FROM profile ${whereClause}`, params);

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found or access denied'
            });
        }

        // Soft delete profile
        await query('UPDATE profile SET status = 0, updated_at = NOW() WHERE id = ?', [profileId]);

        // Soft delete associated user account if exists
        if (profile.profile_user_id) {
            await query('UPDATE users SET status = 0, updated_at = NOW() WHERE id = ? AND role = "profile_holder"', [profile.profile_user_id]);
        }

        res.json({
            success: true,
            message: 'Profile deleted successfully'
        });

    } catch (error) {
        console.error('Soft delete profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete profile',
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

// Get ID-card-ready data for a profile, gated on completeness.
// GET /api/profiles/:id/idcard-data
// Returns 400 with { missing_fields } when the profile is missing any
// ID-card-required field (this is the only place ID-card printing is gated, and
// it blocks printing for incomplete rows — including not-yet-promoted independents).
const getIdCardData = async (req, res) => {
    try {
        const profileId = parseInt(req.params.id);

        let whereClause = 'WHERE p.id = ?';
        let params = [profileId];

        // Same access scoping as getProfileById: non-admins limited to own rows.
        if (req.user.role !== 'admin') {
            whereClause += ' AND p.created_by = ?';
            params.push(req.user.id);
        }

        const profile = await queryOne(
            `SELECT p.* FROM profile p ${whereClause}`,
            params
        );

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found or access denied'
            });
        }

        if (!isIdCardComplete(profile)) {
            return res.status(400).json({
                success: false,
                message: 'ID card cannot be printed: required fields are missing',
                missing_fields: missingIdCardFields(profile)
            });
        }

        res.json({
            success: true,
            message: 'ID card data retrieved',
            data: { profile }
        });
    } catch (error) {
        console.error('Get ID card data error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve ID card data',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    createProfile,
    getProfiles,
    getFilterOptions, // NEW - Add this to exports
    getProfileById,
    getIdCardData,
    updateProfile,
    updateLimitedProfile,
    deleteProfile: softDeleteProfile,
    getProfileStats,
    softDeleteProfile
};