// constants/anubhavEvent.js - Public, non-personal event facts for Anubhav 2026.
// Codified from MASTER_PLAN.md §1. These are safe to expose on the public website:
// venues, dates, and the deanery groupings per place. No PII here.
const { PLACE_DEANERIES } = require('../middleware/anubhavRole');

// Per-place public event summary. Dates are the retreat days (arrival 4PM day 1,
// departure 11AM final day). perYouthFee is the fixed registration fee in INR.
const EVENT_PLACES = [
    {
        place: 'phagwara',
        venue: "St. Joseph's Catholic Church, Phagwara",
        dates: ['2026-06-02', '2026-06-03', '2026-06-04'],
    },
    {
        place: 'abohar',
        venue: "St. Joseph's Catholic Church, Abohar",
        dates: ['2026-06-04', '2026-06-05', '2026-06-06'],
    },
    {
        place: 'amritsar',
        venue: "St. Francis Church, Amritsar",
        dates: ['2026-06-06', '2026-06-07', '2026-06-08'],
    },
];

const PER_YOUTH_FEE = 50;

// Build the full public event summary: each place with venue, dates, and its
// deanery group (sourced from the authoritative PLACE_DEANERIES map).
const buildEventSummary = () => ({
    event: 'Anubhav Retreat for Youth 2026',
    perYouthFee: PER_YOUTH_FEE,
    places: EVENT_PLACES.map(p => ({
        place: p.place,
        venue: p.venue,
        dates: p.dates,
        deaneries: PLACE_DEANERIES[p.place] || [],
    })),
});

module.exports = {
    EVENT_PLACES,
    PER_YOUTH_FEE,
    buildEventSummary,
};
