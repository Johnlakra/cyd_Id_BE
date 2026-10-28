// middleware/shopValidation.js - Input validation for the shop module
const { body, query, param } = require('express-validator');
const { handleValidationErrors } = require('./validation');

const validateShopApplication = [
    body('name').trim().notEmpty().withMessage('Shop name is required').isLength({ max: 150 }),
    body('description').optional().isLength({ max: 2000 }),
    body('parish').optional().isLength({ max: 100 }),
    body('deanery').optional().isLength({ max: 100 }),
    body('contact_phone').notEmpty().withMessage('Contact phone is required').isLength({ max: 20 }),
    body('upi_id')
        .optional()
        .matches(/^[\w.+-]{2,256}@[a-zA-Z]{2,64}$/)
        .withMessage('UPI ID must look like name@bank'),
    handleValidationErrors,
];

const validateShopReview = [
    body('status').isIn(['approved', 'rejected', 'suspended']).withMessage('Invalid review status'),
    body('rejection_reason').optional().isLength({ max: 500 }),
    handleValidationErrors,
];

const validateProduct = [
    body('title').trim().notEmpty().withMessage('Product title is required').isLength({ max: 150 }),
    body('description').optional().isLength({ max: 5000 }),
    body('price').isFloat({ min: 0.01 }).withMessage('Price must be a positive number'),
    body('compare_at_price').optional().isFloat({ min: 0 }),
    body('stock_quantity').isInt({ min: 0 }).withMessage('Stock quantity must be 0 or more'),
    body('category_id').optional().isInt({ min: 1 }),
    body('status').optional().isIn(['draft', 'active', 'out_of_stock', 'archived']),
    body('images').optional().isArray({ max: 6 }).withMessage('Up to 6 images allowed'),
    handleValidationErrors,
];

const validateAddress = [
    body('full_name').trim().notEmpty().withMessage('Full name is required').isLength({ max: 100 }),
    body('phone').trim().notEmpty().withMessage('Phone is required').isLength({ max: 20 }),
    body('line1').trim().notEmpty().withMessage('Address line 1 is required').isLength({ max: 200 }),
    body('line2').optional().isLength({ max: 200 }),
    body('city').trim().notEmpty().withMessage('City is required').isLength({ max: 100 }),
    body('state').trim().notEmpty().withMessage('State is required').isLength({ max: 100 }),
    body('pincode')
        .trim()
        .matches(/^\d{4,10}$/)
        .withMessage('Pincode must be numeric'),
    handleValidationErrors,
];

const validateOrderPlacement = [
    body('shop_id').isInt({ min: 1 }).withMessage('shop_id is required'),
    body('address_id').isInt({ min: 1 }).withMessage('address_id is required'),
    body('payment_method').isIn(['upi', 'cod']).withMessage('payment_method must be upi or cod'),
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
    body('items.*.product_id').isInt({ min: 1 }),
    body('items.*.quantity').isInt({ min: 1, max: 999 }),
    handleValidationErrors,
];

const validateOrderStatusUpdate = [
    body('status')
        .isIn(['accepted', 'packed', 'shipped', 'delivered', 'rejected'])
        .withMessage('Invalid order status'),
    handleValidationErrors,
];

const validateProductQuery = [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('category_id').optional().isInt({ min: 1 }),
    query('shop_id').optional().isInt({ min: 1 }),
    handleValidationErrors,
];

module.exports = {
    validateShopApplication,
    validateShopReview,
    validateProduct,
    validateAddress,
    validateOrderPlacement,
    validateOrderStatusUpdate,
    validateProductQuery,
};
