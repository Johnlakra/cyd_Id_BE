// utils/anubhavDay.js - Shared day <-> date conversion for Anubhav 2026 timetable.
// Each place's retreat starts on a fixed date; day 1-3 maps to start+0, +1, +2.
// Extracted so both the authenticated timetable controller and the public
// website controller stay in sync (DRY). Behavior is identical to the original
// inline helpers in anubhavTimetableController.js.

const PLACE_START_DATES = {
    phagwara: '2026-06-02',
    abohar:   '2026-06-04',
    amritsar: '2026-06-06',
};

// Accepts integer 1-3 or YYYY-MM-DD string. Returns YYYY-MM-DD for DB storage.
const resolveDay = (place, day) => {
    const n = Number(day);
    if (Number.isInteger(n) && n >= 1 && n <= 3) {
        const start = new Date(PLACE_START_DATES[place] || PLACE_START_DATES.phagwara);
        start.setUTCDate(start.getUTCDate() + n - 1);
        return start.toISOString().slice(0, 10);
    }
    return String(day);
};

// Converts a stored YYYY-MM-DD date back to day number 1-3 (or 0 if out of range).
const dateToDay = (place, dateStr) => {
    const start = PLACE_START_DATES[place];
    if (!start || !dateStr) return 0;
    const diff = Math.round(
        (new Date(dateStr) - new Date(start)) / (1000 * 60 * 60 * 24)
    ) + 1;
    return diff >= 1 && diff <= 3 ? diff : 0;
};

module.exports = { PLACE_START_DATES, resolveDay, dateToDay };
