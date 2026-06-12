// utils/anubhavDate.js - Human-readable date/time formatting for the Anubhav 2026
// public website. All event data is in IST (Asia/Kolkata). MySQL DATETIME/TIMESTAMP
// values arrive as JS Date objects that serialize to UTC ISO strings
// (e.g. 2026-06-01T18:30:00.000Z) — that displays the WRONG calendar day to users.
// These helpers render in IST so "2026-06-01T18:30:00.000Z" becomes "2nd June 2026".

const IST_TZ = 'Asia/Kolkata';

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

const pad2 = (n) => String(n).padStart(2, '0');

// 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 4 -> "4th", 21 -> "21st" ...
const ordinal = (day) => {
    const suffixes = ['th', 'st', 'nd', 'rd'];
    const v = day % 100;
    return `${day}${suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]}`;
};

// Extract IST calendar parts from any date-ish input (Date, ISO string, or
// 'YYYY-MM-DD'). Returns null for empty/invalid values so callers can no-op.
const istParts = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: IST_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date).reduce((acc, p) => {
        acc[p.type] = p.value;
        return acc;
    }, {});

    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
    };
};

// "2nd June 2026"
const formatDateLong = (value) => {
    const p = istParts(value);
    if (!p) return null;
    return `${ordinal(p.day)} ${MONTHS[p.month - 1]} ${p.year}`;
};

// "02-06-2026"
const formatDateShort = (value) => {
    const p = istParts(value);
    if (!p) return null;
    return `${pad2(p.day)}-${pad2(p.month)}-${p.year}`;
};

// MySQL TIME columns arrive as "HH:MM:SS" strings -> "4:00 PM". No timezone math:
// TIME has no date/zone, it is already the local wall-clock time of the event.
const formatTime = (value) => {
    if (!value) return null;
    const m = String(value).match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    let hour = Number(m[1]);
    const minute = m[2];
    const meridiem = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return `${hour}:${minute} ${meridiem}`;
};

module.exports = {
    IST_TZ,
    formatDateLong,
    formatDateShort,
    formatTime,
};
