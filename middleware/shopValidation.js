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
        .optional({ values: 'falsy' })
        .trim()
        .matches(/^[\w.+-]{2,256}@[a-zA-Z]{2,64}$/)
        .withMessage('UPI ID must look like name@bank'),
    handleValidationErrors,
];

const validateShopUpdate = [
    body('name').optional().trim().notEmpty().withMessage('Shop name cannot be empty').isLength({ max: 150 }),
    body('description').optional({ values: 'null' }).isLength({ max: 2000 }),
    body('parish').optional({ values: 'null' }).isLength({ max: 100 }),
    body('deanery').optional({ values: 'null' }).isLength({ max: 100 }),
    body('contact_phone').optional().trim().notEmpty().isLength({ max: 20 }),
    body('upi_id')
        .optional({ values: 'falsy' })
        .trim()
        .matches(/^[\w.+-]{2,256}@[a-zA-Z]{2,64}$/)
        .withMessage('UPI ID must look like name@bank'),
    body('current_password').optional().isString(),
    handleValidationErrors,
];

const validateShopReview = [
    body('status').isIn(['approved', 'rejected', 'suspended']).withMessage('Invalid review status'),
    body('rejection_reason')
        .if(body('status').isIn(['rejected', 'suspended']))
        .trim()
        .notEmpty()
        .withMessage('Please give a reason when rejecting or suspending a shop')
        .isLength({ max: 500 }),
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

const validateIdParam = [param('id').isInt({ min: 1 }).withMessage('Invalid id'), handleValidationErrors];

const validateCheckout = [
    body('address_id').isInt({ min: 1 }).withMessage('Choose a delivery address'),
    body('items').isArray({ min: 1, max: 50 }).withMessage('Your cart must have between 1 and 50 products'),
    body('items.*.product_id').isInt({ min: 1 }).withMessage('Invalid product'),
    body('items.*.quantity').isInt({ min: 1, max: 99 }).withMessage('Quantity must be between 1 and 99'),
    body('payment_methods').optional().isObject().withMessage('payment_methods must map shop ids to "upi" or "cod"'),
    body('payment_methods.*').optional().isIn(['upi', 'cod']).withMessage('Payment method must be upi or cod'),
    body('payment_method').optional().isIn(['upi', 'cod']).withMessage('Payment method must be upi or cod'),
    body('notes').optional({ values: 'falsy' }).isLength({ max: 500 }),
    handleValidationErrors,
];

const validateProductLookup = [
    body('ids').isArray({ min: 1, max: 100 }).withMessage('ids must be a list of 1 to 100 product ids'),
    body('ids.*').isInt({ min: 1 }),
    handleValidationErrors,
];

const utrField = (name) => body(name).isString().withMessage('The 12-digit UPI Ref No is required');

const validateClaim = [utrField('utr'), body('screenshot').optional({ values: 'falsy' }).isString(), handleValidationErrors];
const validateConfirm = [utrField('utr'), handleValidationErrors];
const validateRefund = [utrField('refund_utr'), handleValidationErrors];

const validateDispute = [
    body('reason')
        .isIn(['not_received', 'not_confirmed', 'wrong_amount', 'refund_not_received', 'paid_after_cancel', 'not_delivered', 'other'])
        .withMessage('Choose a dispute reason'),
    body('description').optional({ values: 'falsy' }).isLength({ max: 1000 }),
    body('utr').optional({ values: 'falsy' }).isString(),
    body('screenshot').optional({ values: 'falsy' }).isString(),
    handleValidationErrors,
];

const validateOrderStatusUpdate = [
    body('status')
        .isIn(['accepted', 'packed', 'shipped', 'delivered', 'rejected'])
        .withMessage('Invalid order status'),
    body('reason').optional({ values: 'falsy' }).isLength({ max: 500 }),
    handleValidationErrors,
];

const validateMessage = [body('body').isString().withMessage('Message is required'), handleValidationErrors];

const validateEvidence = [
    body('image').isString().withMessage('An image is required'),
    body('kind').optional().isIn(['payment_proof', 'refund_proof', 'other']),
    handleValidationErrors,
];

const validateResolve = [
    body('resolution').isString().withMessage('Choose a resolution'),
    body('note').trim().notEmpty().withMessage('A note explaining the decision is required').isLength({ max: 1000 }),
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
    validateShopUpdate,
    validateShopReview,
    validateProduct,
    validateAddress,
    validateIdParam,
    validateCheckout,
    validateProductLookup,
    validateClaim,
    validateConfirm,
    validateRefund,
    validateDispute,
    validateOrderStatusUpdate,
    validateMessage,
    validateEvidence,
    validateResolve,
    validateProductQuery,
};
