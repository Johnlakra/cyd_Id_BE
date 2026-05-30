// routes/anubhavPublic.js - PUBLIC (no-auth) read endpoints for the Anubhav 2026
// website. Mounted at /anubhav/public. NO authenticateToken on any route here.
// A light per-IP rate limiter guards against scraping abuse. Every handler returns
// counts / non-personal data only — never youth PII.
const express = require('express');
const router = express.Router();

const publicController = require('../controllers/anubhavPublicController');
const { createRateLimiter } = require('../middleware/rateLimit');

// Public scraping guard: generous enough for a normal website session, low enough
// to deter bulk harvesting. Tunable via env without code changes.
const publicLimiter = createRateLimiter({
    windowMs: Number(process.env.ANUBHAV_PUBLIC_RATE_WINDOW_MS) || 60_000,
    max: Number(process.env.ANUBHAV_PUBLIC_RATE_MAX) || 120,
});
router.use(publicLimiter);

// @route GET /anubhav/public/event-summary
router.get('/event-summary', publicController.getEventSummary);

// @route GET /anubhav/public/announcements?place=
router.get('/announcements', publicController.getAnnouncements);

// @route GET /anubhav/public/announcements/latest
router.get('/announcements/latest', publicController.getLatestAnnouncement);

// @route GET /anubhav/public/timetable?place=
router.get('/timetable', publicController.getTimetable);

// @route GET /anubhav/public/stats
router.get('/stats', publicController.getStats);

// @route GET /anubhav/public/speakers?place=
router.get('/speakers', publicController.getSpeakers);

module.exports = router;
