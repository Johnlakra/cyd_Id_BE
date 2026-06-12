// utils/importExcel.js - exceljs helpers for the bulk import wizard (Phase 2).
// Pure workbook/parsing/mapping logic; no DB access. Controllers own the
// validation-against-DB and commit steps.
const ExcelJS = require('exceljs');

// Import column catalogs. `key` is the canonical field, `synonyms` are
// normalized header spellings accepted by the auto-mapper.
const YOUTH_COLUMNS = [
    { key: 'name', label: 'Name', required: true, synonyms: ['name', 'fullname', 'youthname', 'candidatename'] },
    { key: 'father', label: 'Father', required: false, synonyms: ['father', 'fathername', 'fathersname'] },
    { key: 'mother', label: 'Mother', required: false, synonyms: ['mother', 'mothername', 'mothersname'] },
    { key: 'dob', label: 'DOB', required: true, synonyms: ['dob', 'dateofbirth', 'birthdate', 'birthday'] },
    { key: 'date_of_baptism', label: 'Date of Baptism', required: false, synonyms: ['dateofbaptism', 'baptism', 'baptismdate'] },
    { key: 'phone', label: 'Phone', required: true, synonyms: ['phone', 'mobile', 'contact', 'phonenumber', 'mobilenumber', 'contactnumber', 'whatsapp'] },
    { key: 'postal_address', label: 'Postal Address', required: false, synonyms: ['address', 'postaladdress'] },
    { key: 'deanery', label: 'Deanery', required: true, synonyms: ['deanery', 'deanary'] },
    { key: 'parish', label: 'Parish', required: true, synonyms: ['parish', 'parishname', 'church'] },
    { key: 'qualification', label: 'Qualification', required: false, synonyms: ['qualification', 'education'] },
    { key: 'designation', label: 'Designation', required: false, synonyms: ['designation', 'post'] },
    { key: 'level', label: 'Level', required: false, synonyms: ['level', 'memberlevel'] },
    { key: 'involvement', label: 'Involvement', required: false, synonyms: ['involvement', 'ministry'] },
    { key: 'photo_url', label: 'Photo URL', required: false, synonyms: ['photo', 'photourl', 'photolink', 'image', 'imageurl'] },
];

const ORG_COLUMNS = [
    { key: 'deanery', label: 'Deanery', required: true, synonyms: ['deanery', 'deanary'] },
    { key: 'parish', label: 'Parish', required: true, synonyms: ['parish', 'parishname', 'church'] },
];

const COLUMNS_BY_TYPE = { youth: YOUTH_COLUMNS, org: ORG_COLUMNS };

// Hard cap so one request cannot blow the JSON body limit or hold a giant
// transaction open. Larger lists should be split into multiple files.
const MAX_IMPORT_ROWS = 2000;

const normalizeHeader = (value) =>
    String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');

// Build the downloadable template: header row + one illustrative sample row.
const buildTemplateWorkbook = async (type) => {
    const columns = COLUMNS_BY_TYPE[type];
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Import');

    sheet.addRow(columns.map(c => c.label));
    sheet.getRow(1).font = { bold: true };
    if (type === 'youth') {
        sheet.addRow(['Maria Joseph', 'Joseph K', 'Anna Joseph', '2004-05-21', '2004-07-15',
            '9876543210', '12 Church Road', 'Sample Deanery', 'Sample Parish',
            'B.A.', 'Member', 'Parish', 'Choir', '']);
    } else {
        sheet.addRow(['Sample Deanery', 'Sample Parish']);
    }
    columns.forEach((c, i) => { sheet.getColumn(i + 1).width = Math.max(14, c.label.length + 4); });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer).toString('base64');
};

// Read the first worksheet of a base64 xlsx into { headers, rows }.
// rows are arrays of cell values (header row excluded, fully-empty rows dropped).
const readWorkbookBase64 = async (fileBase64) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(fileBase64, 'base64'));
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('Workbook contains no worksheets');

    const cellValue = (cell) => {
        const v = cell.value;
        if (v == null) return '';
        if (v instanceof Date) return v;
        // exceljs wraps formulas/rich text/hyperlinks in objects.
        if (typeof v === 'object') {
            if (v.result != null) return v.result;
            if (v.text != null) return v.text;
            if (v.richText) return v.richText.map(r => r.text).join('');
            return '';
        }
        return v;
    };

    const headers = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col - 1] = String(cellValue(cell)).trim(); });

    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return;
        const values = headers.map((_, i) => cellValue(row.getCell(i + 1)));
        if (values.some(v => String(v).trim() !== '')) {
            rows.push({ row_number: rowNumber, values });
        }
    });

    return { headers, rows };
};

// Fuzzy-match uploaded headers to canonical columns.
// Returns { mapping: { key -> headerIndex }, unmapped_required: [key], unmatched_headers: [name] }.
const suggestMapping = (headers, type) => {
    const columns = COLUMNS_BY_TYPE[type];
    const normalized = headers.map(normalizeHeader);
    const mapping = {};
    const used = new Set();

    for (const column of columns) {
        const idx = normalized.findIndex((h, i) => !used.has(i) && h !== '' && column.synonyms.includes(h));
        if (idx !== -1) {
            mapping[column.key] = idx;
            used.add(idx);
        }
    }

    return {
        mapping,
        unmapped_required: columns.filter(c => c.required && mapping[c.key] === undefined).map(c => c.key),
        unmatched_headers: headers.filter((h, i) => !used.has(i) && h !== ''),
    };
};

// Accepts Date cells (exceljs parses them as UTC), 'YYYY-MM-DD', 'DD/MM/YYYY',
// 'DD-MM-YYYY'. Returns 'YYYY-MM-DD' or null when unparseable.
const parseDateValue = (value) => {
    if (value == null || value === '') return null;

    if (value instanceof Date) {
        if (isNaN(value.getTime())) return null;
        const y = value.getUTCFullYear();
        const m = String(value.getUTCMonth() + 1).padStart(2, '0');
        const d = String(value.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    const s = String(value).trim();
    let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    let y, m, d;
    if (match) {
        [, y, m, d] = match;
    } else {
        match = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
        if (!match) return null;
        [, d, m, y] = match;
    }

    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    const valid = date.getUTCFullYear() === Number(y)
        && date.getUTCMonth() === Number(m) - 1
        && date.getUTCDate() === Number(d);
    if (!valid) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

// Failed rows -> downloadable xlsx (original values + an Errors column).
const buildErrorWorkbook = async (type, failedRows) => {
    const columns = COLUMNS_BY_TYPE[type];
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Errors');

    sheet.addRow([...columns.map(c => c.label), 'Row', 'Errors']);
    sheet.getRow(1).font = { bold: true };
    for (const row of failedRows) {
        sheet.addRow([
            ...columns.map(c => row.data[c.key] == null ? '' : row.data[c.key]),
            row.row_number,
            row.errors.join('; ')
        ]);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer).toString('base64');
};

module.exports = {
    YOUTH_COLUMNS,
    ORG_COLUMNS,
    COLUMNS_BY_TYPE,
    MAX_IMPORT_ROWS,
    buildTemplateWorkbook,
    readWorkbookBase64,
    suggestMapping,
    parseDateValue,
    buildErrorWorkbook,
};
