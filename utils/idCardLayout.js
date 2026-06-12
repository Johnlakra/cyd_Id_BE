// utils/idCardLayout.js - ID card layout schema + presets (Platform Phase 4).
// layout_json element schema (master plan Pillar D, extended with prefix/
// format/lineHeight/transform which the legacy Jalandhar card needs):
//   { id, type: text|photo|qr|logo|static_text|line,
//     field,                       // for type=text: profile field to render
//     x, y, w, h,                  // mm on the card
//     fontFamily, fontSize, fontWeight, color, align, rotation,
//     borderRadius, border, label, uppercase,
//     prefix,                      // literal prepended to the value (': ')
//     format,                      // dayjs format for date fields
//     lineHeight, transform }      // 'capitalize' etc.
// The FE designer and the final card share ONE render path over this schema.

const ELEMENT_TYPES = ['text', 'photo', 'qr', 'logo', 'static_text', 'line'];

const FIELD_KEYS = [
    'name', 'father_name', 'mother_name', 'date_of_birth', 'date_of_baptism',
    'designation', 'level', 'postal_address', 'parish', 'deanery',
    'qualification', 'phone', 'involvement', 'issue_date'
];

const CARD_WIDTH_MM = 146.30;
const CARD_HEIGHT_MM = 221.80;

// Validate a layout object at the API boundary. Returns an array of
// human-readable problems; empty array = valid.
const validateLayout = (layout) => {
    const errors = [];
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
        return ['layout_json must be an object like { elements: [...] }'];
    }
    if (!Array.isArray(layout.elements)) {
        return ['layout_json.elements must be an array'];
    }
    if (layout.elements.length === 0) errors.push('layout_json.elements is empty');
    if (layout.elements.length > 60) errors.push('layout_json has more than 60 elements');

    layout.elements.forEach((el, i) => {
        const at = `elements[${i}]`;
        if (!el || typeof el !== 'object') { errors.push(`${at} is not an object`); return; }
        if (!ELEMENT_TYPES.includes(el.type)) errors.push(`${at}.type must be one of ${ELEMENT_TYPES.join('|')}`);
        if (el.type === 'text' && !FIELD_KEYS.includes(el.field)) {
            errors.push(`${at}.field '${el.field}' is not a known profile field`);
        }
        if (el.type === 'static_text' && (el.label == null || String(el.label) === '')) {
            errors.push(`${at} (static_text) needs a label`);
        }
        for (const dim of ['x', 'y']) {
            if (typeof el[dim] !== 'number' || !isFinite(el[dim])) errors.push(`${at}.${dim} must be a number (mm)`);
        }
        for (const dim of ['w', 'h']) {
            if (el[dim] != null && (typeof el[dim] !== 'number' || el[dim] <= 0)) {
                errors.push(`${at}.${dim} must be a positive number (mm) when present`);
            }
        }
    });
    return errors;
};

// ── Legacy Jalandhar layout — transcribed 1:1 from CYD_ID/src/components/
// IDCard.jsx so template-driven rendering is pixel-identical to the legacy
// branch. All three levels share this geometry; only the background differs.
// Centered elements use x + w with align:center (the FE used left:50% +
// translateX(-50%), i.e. horizontally centered full-width blocks).
const buildLegacyJalandharLayout = () => {
    const labeledRow = (id, field, y, extra = {}) => ({
        id, type: 'text', field,
        x: 54, y, w: 60, h: 9,
        fontFamily: 'Gafata', fontSize: 24.2, color: '#000000', align: 'left',
        prefix: ': ', ...extra
    });

    return {
        elements: [
            {
                id: 'photo', type: 'photo', field: 'photo',
                x: (CARD_WIDTH_MM - 58) / 2, y: 42.5, w: 58, h: 67,
                border: '1px solid #8D8D8D', borderRadius: 14
            },
            {
                id: 'name', type: 'text', field: 'name',
                x: 0, y: 111.2, w: CARD_WIDTH_MM, h: 12,
                fontFamily: 'Vidaloka', fontSize: 31.5, color: '#C01E2C',
                align: 'center', transform: 'capitalize'
            },
            {
                id: 'designation', type: 'text', field: 'designation',
                x: 0, y: 121, w: CARD_WIDTH_MM, h: 7,
                fontFamily: 'Roboto', fontSize: 16, color: '#C01E2C', align: 'center'
            },
            labeledRow('deanery', 'deanery', 128),
            labeledRow('parish', 'parish', 136.1),
            labeledRow('baptism', 'date_of_baptism', 144.12, { format: 'DD-MM-YYYY' }),
            labeledRow('dob', 'date_of_birth', 152.4, { format: 'DD-MM-YYYY' }),
            labeledRow('phone', 'phone', 160.68),
            labeledRow('father', 'father_name', 168.96),
            {
                id: 'address-colon', type: 'static_text', label: ':',
                x: 54, y: 177.24, w: 35, h: 9,
                fontFamily: 'Gafata', fontSize: 24.2, color: '#000000', align: 'left'
            },
            {
                id: 'address', type: 'text', field: 'postal_address',
                x: 56.9, y: 177.5, w: 82, h: 30,
                fontFamily: 'Gafata', fontSize: 24.2, color: '#000000',
                align: 'left', lineHeight: '96.5%'
            },
            {
                id: 'footer-divider', type: 'static_text', label: '|',
                x: (CARD_WIDTH_MM - 100) / 2, y: 213, w: 100, h: 7,
                fontFamily: 'Roboto', fontSize: 19, color: '#ffffff', align: 'center'
            },
            {
                id: 'footer-issued', type: 'text', field: 'issue_date',
                x: (CARD_WIDTH_MM - 100) / 2, y: 213, w: 100, h: 7,
                fontFamily: 'Roboto', fontSize: 19, color: '#ffffff',
                align: 'left', prefix: 'Issued: ', format: 'DD-MM-YYYY'
            },
            {
                id: 'footer-validity', type: 'static_text', label: 'Valid for two years',
                x: (CARD_WIDTH_MM - 100) / 2, y: 213, w: 100, h: 7,
                fontFamily: 'Roboto', fontSize: 19, color: '#ffffff', align: 'right'
            }
        ]
    };
};

// ── Starter gallery: layout presets a new diocese can use by just uploading
// a background (+ logo). Kept deliberately simple; the designer customizes.
const galleryRow = (id, field, y, opts = {}) => ({
    id, type: 'text', field,
    x: opts.x ?? 20, y, w: opts.w ?? 106, h: 8,
    fontFamily: 'Roboto', fontSize: opts.fontSize ?? 18,
    color: opts.color ?? '#1a1a1a', align: opts.align ?? 'left',
    label: opts.label, prefix: opts.prefix, format: opts.format
});

const GALLERY_TEMPLATES = [
    {
        key: 'classic',
        name: 'Classic',
        description: 'Centered photo with a stacked detail block — closest to the traditional card.',
        layout_json: {
            elements: [
                { id: 'photo', type: 'photo', field: 'photo', x: 44.15, y: 40, w: 58, h: 67, border: '1px solid #8D8D8D', borderRadius: 12 },
                galleryRow('name', 'name', 112, { align: 'center', x: 0, w: CARD_WIDTH_MM, fontSize: 30, color: '#1a1a1a' }),
                galleryRow('designation', 'designation', 123, { align: 'center', x: 0, w: CARD_WIDTH_MM, fontSize: 16, color: '#555555' }),
                galleryRow('deanery', 'deanery', 134, { prefix: 'Deanery: ' }),
                galleryRow('parish', 'parish', 143, { prefix: 'Parish: ' }),
                galleryRow('dob', 'date_of_birth', 152, { prefix: 'DOB: ', format: 'DD-MM-YYYY' }),
                galleryRow('phone', 'phone', 161, { prefix: 'Phone: ' }),
                galleryRow('issued', 'issue_date', 208, { align: 'center', x: 0, w: CARD_WIDTH_MM, fontSize: 14, color: '#ffffff', prefix: 'Issued: ', format: 'DD-MM-YYYY' })
            ]
        }
    },
    {
        key: 'modern',
        name: 'Modern',
        description: 'Large rounded photo, bold name, two-column details.',
        layout_json: {
            elements: [
                { id: 'photo', type: 'photo', field: 'photo', x: 38.15, y: 30, w: 70, h: 80, border: 'none', borderRadius: 24 },
                galleryRow('name', 'name', 118, { align: 'center', x: 0, w: CARD_WIDTH_MM, fontSize: 34, color: '#111111' }),
                galleryRow('parish', 'parish', 132, { align: 'center', x: 0, w: CARD_WIDTH_MM, fontSize: 18, color: '#444444' }),
                galleryRow('deanery', 'deanery', 150, { x: 14, w: 60, prefix: 'Deanery\n' }),
                galleryRow('phone', 'phone', 150, { x: 76, w: 60, prefix: 'Phone\n' }),
                galleryRow('dob', 'date_of_birth', 168, { x: 14, w: 60, prefix: 'DOB\n', format: 'DD-MM-YYYY' }),
                galleryRow('designation', 'designation', 168, { x: 76, w: 60, prefix: 'Role\n' })
            ]
        }
    },
    {
        key: 'minimal',
        name: 'Minimal',
        description: 'Name and essentials only — maximum background visibility.',
        layout_json: {
            elements: [
                { id: 'photo', type: 'photo', field: 'photo', x: 49.15, y: 50, w: 48, h: 56, border: 'none', borderRadius: 8 },
                galleryRow('name', 'name', 115, { align: 'center', x: 0, w: CARD_WIDTH_MM, fontSize: 28 }),
                galleryRow('parish', 'parish', 127, { align: 'center', x: 0, w: CARD_WIDTH_MM, fontSize: 16, color: '#666666' }),
                galleryRow('phone', 'phone', 137, { align: 'center', x: 0, w: CARD_WIDTH_MM, fontSize: 16, color: '#666666' })
            ]
        }
    },
    {
        key: 'photo_left',
        name: 'Photo Left',
        description: 'Photo on the left, details stacked to the right — landscape-style block.',
        layout_json: {
            elements: [
                { id: 'photo', type: 'photo', field: 'photo', x: 12, y: 50, w: 50, h: 60, border: '1px solid #cccccc', borderRadius: 10 },
                galleryRow('name', 'name', 52, { x: 68, w: 68, fontSize: 26 }),
                galleryRow('designation', 'designation', 64, { x: 68, w: 68, fontSize: 15, color: '#555555' }),
                galleryRow('parish', 'parish', 76, { x: 68, w: 68, prefix: 'Parish: ', fontSize: 15 }),
                galleryRow('deanery', 'deanery', 85, { x: 68, w: 68, prefix: 'Deanery: ', fontSize: 15 }),
                galleryRow('phone', 'phone', 94, { x: 68, w: 68, prefix: 'Phone: ', fontSize: 15 }),
                galleryRow('dob', 'date_of_birth', 103, { x: 68, w: 68, prefix: 'DOB: ', format: 'DD-MM-YYYY', fontSize: 15 })
            ]
        }
    }
];

module.exports = {
    ELEMENT_TYPES,
    FIELD_KEYS,
    CARD_WIDTH_MM,
    CARD_HEIGHT_MM,
    validateLayout,
    buildLegacyJalandharLayout,
    GALLERY_TEMPLATES
};
