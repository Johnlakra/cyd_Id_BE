// utils/shopHelpers.js - Small shared helpers for the shop module
const { v4: uuidv4 } = require('uuid');

const slugify = (text) =>
    text
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .substring(0, 150);

// Appends a short random suffix so two products/shops with the same name don't collide.
const uniqueSlug = (text) => `${slugify(text)}-${uuidv4().slice(0, 6)}`;

const generateOrderNumber = () => {
    const stamp = Date.now().toString(36).toUpperCase();
    const random = uuidv4().slice(0, 6).toUpperCase();
    return `CYD-${stamp}-${random}`;
};

// Rupees (e.g. "199.50" or 199.5) -> integer paise, used whenever price input comes from a form.
const rupeesToPaise = (rupees) => Math.round(parseFloat(rupees) * 100);

module.exports = { slugify, uniqueSlug, generateOrderNumber, rupeesToPaise };
