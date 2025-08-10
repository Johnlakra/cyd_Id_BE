// middleware/validation.js - Input validation middleware
const { body, validationResult, query } = require('express-validator');

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
        const errorMessages = errors.array().map(error => error.msg);
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errorMessages
        });
    }
    
    next();
};

// User registration validation
const validateRegistration = [
    body('username')
        .isLength({ min: 3, max: 50 })
        .withMessage('Username must be between 3 and 50 characters')
        .matches(/^[a-zA-Z0-9_-]+$/)
        .withMessage('Username can only contain letters, numbers, hyphens, and underscores'),
    
    body('email')
        .isEmail()
        .withMessage('Must be a valid email address')
        .normalizeEmail(),
    
    body('password')
        .isLength({ min: 6 })
        .withMessage('Password must be at least 6 characters long')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
    
    body('role')
        .optional()
        .isIn(['admin', 'user', 'profile_holder'])
        .withMessage('Role must be admin, user, or profile_holder'),
    
    handleValidationErrors
];

// User login validation
const validateLogin = [
    body('username')
        .notEmpty()
        .withMessage('Username or email is required'),
    
    body('password')
        .notEmpty()
        .withMessage('Password is required'),
    
    handleValidationErrors
];

// Profile creation validation
const validateProfile = [
    body('name')
        .notEmpty()
        .withMessage('Name is required')
        .isLength({ max: 100 })
        .withMessage('Name must not exceed 100 characters'),
    
    body('father_name')
        .optional()
        .isLength({ max: 100 })
        .withMessage('Father name must not exceed 100 characters'),
    
    body('mother_name')
        .optional()
        .isLength({ max: 100 })
        .withMessage('Mother name must not exceed 100 characters'),
    
    body('date_of_birth')
        .optional()
        .isISO8601()
        .withMessage('Date of birth must be a valid date (YYYY-MM-DD)'),
    
    body('designation')
        .optional()
        .isLength({ max: 100 })
        .withMessage('Designation must not exceed 100 characters'),
    
    body('level')
        .optional()
        .isLength({ max: 50 })
        .withMessage('Level must not exceed 50 characters'),
    
    body('date_of_baptism')
        .optional()
        .isISO8601()
        .withMessage('Date of baptism must be a valid date (YYYY-MM-DD)'),
    
    body('phone')
        .notEmpty()
        .withMessage('phone is required'),
    
    body('email')
        .optional()
        .isEmail()
        .withMessage('Must be a valid email address')
        .normalizeEmail(),
    
    body('photo')
        .optional()
        .custom((value) => {
            // Check if it's a valid URL (for existing photos)
            if (value && (value.startsWith('http://') || value.startsWith('https://'))) {
            return true;
            }
            // Check if it's a valid base64 image
            if (value && !value.match(/^data:image\/(jpeg|jpg|png|gif|bmp|webp);base64,/)) {
                throw new Error('Photo must be a valid base64 image (jpeg, png, gif, bmp, webp)');
            }
            return true;
        }),

    body('issue_date')
        .optional()
        .isISO8601()
        .withMessage('issue_date must be a valid date (YYYY-MM-DD)'),

    
    handleValidationErrors
];

const validateLimitedProfile = [
    body('photo').optional().custom((value) => {
        // Check if it's a valid URL (for existing photos)
        if (value && (value.startsWith('http://') || value.startsWith('https://'))) {
            return true;
        }
        // Check if it's a valid base64 image
        if (value && !value.match(/^data:image\/(jpeg|jpg|png|gif|bmp|webp);base64,/)) {
            throw new Error('Photo must be a valid base64 image (jpeg, png, gif, bmp, webp)');
        }
        return true;
    }),
    body('qualification').optional().isLength({ max: 200 }).withMessage('Qualification must not exceed 200 characters'),
    body('postal_address').optional().isLength({ max: 500 }).withMessage('Postal address must not exceed 500 characters'),
    handleValidationErrors
];

// Pagination validation
const validatePagination = [
    query('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Page must be a positive integer'),
    
    query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100'),
    
    query('id')
        .optional()
        .isInt({ min: 1 })
        .withMessage('ID must be a positive integer'),
    
    handleValidationErrors
];

module.exports = {
    validateRegistration,
    validateLogin,
    validateProfile,
    validateLimitedProfile,
    validatePagination,
    handleValidationErrors
};