// middleware/security.js - Login rate limiting, CORS options, and the final JSON error handler
const rateLimit = require('express-rate-limit');

// Keyed on IP + username so one attacker hammering one account gets blocked without locking out
// everyone else behind the same NAT (e.g. a parish hall network). Successful logins don't count.
// Requires `app.set('trust proxy', 1)` behind Render/Vercel, otherwise every request shares the
// proxy's IP.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
        const username = String((req.body && req.body.username) || '').trim().toLowerCase().slice(0, 100);
        return `${req.ip}|${username}`;
    },
    message: {
        success: false,
        message: 'Too many failed login attempts. Please try again in 15 minutes.',
    },
});

// CORS_ORIGINS is a comma-separated allowlist. Left unset, CORS stays open as before so a deploy
// without the variable doesn't break the frontend.
const corsOptions = () => {
    const origins = (process.env.CORS_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    return origins.length > 0 ? { origin: origins } : {};
};

// eslint-disable-next-line no-unused-vars
const jsonErrorHandler = (err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }

    let status = err.status || err.statusCode || 500;
    let message = 'Internal server error';

    if (err.type === 'entity.parse.failed') {
        status = 400;
        message = 'Malformed JSON in request body';
    } else if (err.type === 'entity.too.large') {
        status = 413;
        message = 'Request body is too large';
    } else if (status < 500 && err.expose && err.message) {
        message = err.message;
    }

    if (status >= 500) {
        console.error('Unhandled error:', err);
    }

    const body = { success: false, message };
    if (process.env.NODE_ENV === 'development') {
        body.stack = err.stack;
    }
    res.status(status).json(body);
};

module.exports = { loginLimiter, corsOptions, jsonErrorHandler };
