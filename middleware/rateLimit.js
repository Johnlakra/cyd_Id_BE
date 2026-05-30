// middleware/rateLimit.js - Tiny in-memory per-IP rate limiter.
// Additive utility used to throttle the public (no-auth) Anubhav website routes
// against scraping abuse. No external dependency. Not used on any existing route.
//
// Fixed-window counter keyed by client IP. State is per-process (fine for a single
// Render dyno). For multi-instance scaling, swap for a shared store later.

const createRateLimiter = ({ windowMs = 60_000, max = 60 } = {}) => {
    const hits = new Map(); // ip -> { count, resetAt }

    // Opportunistic cleanup so the Map cannot grow unbounded.
    const sweep = (now) => {
        for (const [ip, rec] of hits) {
            if (rec.resetAt <= now) hits.delete(ip);
        }
    };

    return (req, res, next) => {
        const now = Date.now();
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';

        let rec = hits.get(ip);
        if (!rec || rec.resetAt <= now) {
            rec = { count: 0, resetAt: now + windowMs };
            hits.set(ip, rec);
            if (hits.size > 5000) sweep(now);
        }

        rec.count += 1;
        const remaining = Math.max(0, max - rec.count);
        res.set('X-RateLimit-Limit', String(max));
        res.set('X-RateLimit-Remaining', String(remaining));

        if (rec.count > max) {
            const retryAfter = Math.ceil((rec.resetAt - now) / 1000);
            res.set('Retry-After', String(retryAfter));
            return res.status(429).json({
                success: false,
                message: 'Too many requests, please slow down',
            });
        }

        next();
    };
};

module.exports = { createRateLimiter };
