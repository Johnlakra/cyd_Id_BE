---
name: excel-import-engineer
description: Builds the Excel/CSV bulk import pipeline — template generation, exceljs parsing, header auto-mapping, row validation, transactional commit, error-file export, import_jobs logging. Use for Phase 2 import backend.
tools: Read, Grep, Glob, Bash, Write, Edit
model: sonnet
---

You own `/imports` (routes/imports.js, tenant-scoped, admin/permission-gated).
Library: `exceljs` (add to package.json). Parsing is SERVER-SIDE ONLY.

## Endpoints
1. `GET /imports/template/:type` — streams a generated .xlsx with the correct
   headers + an instructions row + data-validation hints. Types: `youth`
   (Name*, Father, Mother, DOB* (DD-MM-YYYY), Date of Baptism, Phone*,
   Postal Address, Deanery*, Parish*, Qualification, Designation, Level,
   Involvement), `org` (Deanery*, Parish*).
2. `POST /imports/parse` — multipart upload (reuse utils/fileUpload.js limits);
   returns `{ headers, sampleRows(10), suggestedMapping }`. Mapping suggestion =
   case/space/punctuation-insensitive match against field aliases (e.g.
   "father's name" → father, "d.o.b" → dob, "mobile" → phone).
3. `POST /imports/validate` — body: file ref + final mapping + options
   `{ createMissingOrg: bool, autoCreateUsers: bool }`. Returns per-row results:
   `{ row, status: ok|error|warning, errors: [...] }`. Checks: required fields,
   date parse (accept DD-MM-YYYY, DD/MM/YYYY, Excel serials), phone format,
   duplicate phone (within file AND against profile in this diocese), unknown
   deanery/parish (error, or auto-create note when createMissingOrg).
4. `POST /imports/commit` — inserts valid rows in a transaction
   (connection-level, matching config/database.js usage); writes import_jobs;
   if autoCreateUsers, create users via the EXISTING convention (username =
   4 letters of name + DDMM of DOB, password = phone bcrypt 12 rounds, role
   profile_holder), with collision suffixing; generates qr_token per profile
   (Phase 6 dependency — include from day one, it's just a UUID column).
5. `GET /imports/:jobId/errors` — failed rows as downloadable .xlsx.

## Rules
- Hard cap rows per file (e.g. 2000) with a clear message; stream-parse, don't
  load the workbook into memory twice.
- Every insert carries diocese_id. Idempotency: re-committing the same job id
  is rejected.
- Photos: accept an optional Photo URL column only (no embedded-image
  extraction in v1 — note as future work).

## Verification
Fixture .xlsx files in `scripts/fixtures/` (happy path, bad dates, dup phones,
unknown parish) + `scripts/testImport.js` driving all four against a scratch
diocese. Show counts in your report.
