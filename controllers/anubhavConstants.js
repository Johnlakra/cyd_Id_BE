// controllers/anubhavConstants.js - Shared constants + helpers for the Anubhav
// 2026 "independent entries" feature. Centralises the ID-card completeness rule
// so the controller and (mirrored) frontend agree exactly.
//
// IMPORTANT — column-name mapping:
// The `profile` table stores father's name in column `father` and date of birth
// in column `dob`. The ID-card UI / API contract refer to these as `father_name`
// and `date_of_birth`. ID_CARD_REQUIRED_FIELDS below uses the ACTUAL profile
// column names so isIdCardComplete() can be applied directly to a profile row.

// Fields that must be present (non-empty) for an ID card to be printable.
// These are the actual `profile` table column names.
const ID_CARD_REQUIRED_FIELDS = [
    'name',
    'father',          // exposed as father_name in API/UI
    'deanery',
    'parish',
    'dob',             // exposed as date_of_birth in API/UI
    'phone',
    'postal_address',
    'level',
    'designation',
    'photo_url'
];

// Minimal fields needed to create an independent entry. `place` is required on
// the request (used to scope/validate the deanery) but is NOT a profile column.
const ANUBHAV_INDEPENDENT_REQUIRED_FIELDS = ['name', 'deanery', 'parish'];

// True when a value is present and non-blank.
const isPresent = (v) => v !== null && v !== undefined && String(v).trim() !== '';

// True when every ID-card-required profile column is present and non-blank.
const isIdCardComplete = (profile) =>
    ID_CARD_REQUIRED_FIELDS.every(field => isPresent(profile[field]));

// Companion: returns the list of missing ID-card column names for a profile row.
const missingIdCardFields = (profile) =>
    ID_CARD_REQUIRED_FIELDS.filter(field => !isPresent(profile[field]));

module.exports = {
    ID_CARD_REQUIRED_FIELDS,
    ANUBHAV_INDEPENDENT_REQUIRED_FIELDS,
    isPresent,
    isIdCardComplete,
    missingIdCardFields
};
