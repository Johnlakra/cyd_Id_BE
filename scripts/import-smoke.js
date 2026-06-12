// scripts/import-smoke.js — Phase 2 smoke test: org CRUD + Excel bulk import.
// Proves the phase exit criterion: a FRESH diocese registers, is approved, its
// admin builds org structure (CRUD + xlsx import), then imports an xlsx of
// youth — profiles + optional login users created, bad rows rejected.
// Requires a local server on :3000 and a super_admin 'admin' user.
// Self-cleaning. Usage: node scripts/import-smoke.js
require('dotenv').config();
const http = require('http');
const ExcelJS = require('exceljs');
const { query, queryOne } = require('../config/database');

const reqJson = (method, path, body, token) => new Promise((res, rej) => {
  const data = body ? JSON.stringify(body) : null;
  const r = http.request({
    host: 'localhost', port: 3000, path, method,
    headers: {
      'Content-Type': 'application/json',
      ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
  }, resp => {
    let b = '';
    resp.on('data', c => b += c);
    resp.on('end', () => { try { res({ status: resp.statusCode, body: JSON.parse(b) }); } catch { res({ status: resp.statusCode, body: b }); } });
  });
  r.on('error', rej);
  if (data) r.write(data);
  r.end();
});

let passed = 0, failed = 0;
const assert = (label, cond, detail) => {
  if (cond) { console.log('  PASS', label); passed++; }
  else { console.error('  FAIL', label, detail || ''); failed++; }
};

const xlsxBase64 = async (headers, rows) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(headers);
  rows.forEach(r => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
};

const SLUG = 'import-smoke-diocese';

const cleanup = async () => {
  const d = await queryOne('SELECT id FROM dioceses WHERE slug = ?', [SLUG]);
  if (d) {
    await query('UPDATE profile SET profile_user_id = NULL WHERE diocese_id = ?', [d.id]);
    // import_jobs.created_by FK references users — delete jobs before users.
    await query('DELETE FROM import_jobs WHERE diocese_id = ?', [d.id]);
    await query('DELETE FROM users WHERE diocese_id = ?', [d.id]);
    await query('DELETE FROM profile WHERE diocese_id = ?', [d.id]);
    await query('DELETE FROM parish WHERE diocese_id = ?', [d.id]);
    await query('DELETE FROM deanery WHERE diocese_id = ?', [d.id]);
    await query('DELETE FROM dioceses WHERE id = ?', [d.id]);
  }
};

async function run() {
  console.log('=== PLATFORM PHASE 2 SMOKE TEST (org CRUD + Excel import) ===\n');
  await cleanup();

  // ── Setup: fresh diocese via the Phase 1 flow ────────────────────────────
  console.log('[setup] fresh diocese');
  const superLogin = await reqJson('POST', '/auth/login', { username: 'admin', password: 'CYD@123.' });
  const superToken = superLogin.body?.data?.token;
  assert('super_admin login', !!superToken);

  const reg = await reqJson('POST', '/platform/dioceses/register', {
    name: 'Import Smoke Diocese', slug: SLUG,
    contact_email: 'import-smoke@example.com', contact_phone: '9000000001',
  });
  assert('diocese registered', reg.status === 201, JSON.stringify(reg.body).slice(0, 150));
  const dioceseId = reg.body?.data?.id;

  const approve = await reqJson('PUT', `/platform/dioceses/${dioceseId}/approve`, {}, superToken);
  assert('diocese approved', approve.status === 200, approve.status);

  const adminLogin = await reqJson('POST', '/auth/login', { username: `${SLUG}.admin`, password: '9000000001' });
  const token = adminLogin.body?.data?.token;
  assert('diocese admin login', !!token, JSON.stringify(adminLogin.body).slice(0, 150));

  // ── Org CRUD ──────────────────────────────────────────────────────────────
  console.log('\n[1] Org structure CRUD');
  const noTok = await reqJson('GET', '/org/structure');
  assert('structure without token → 401', noTok.status === 401, noTok.status);

  const d1 = await reqJson('POST', '/org/deaneries', { name: 'North Deanery' }, token);
  assert('create deanery → 201', d1.status === 201, JSON.stringify(d1.body).slice(0, 150));
  const deaneryId = d1.body?.data?.id;

  const dDup = await reqJson('POST', '/org/deaneries', { name: 'North Deanery' }, token);
  assert('duplicate deanery → 409', dDup.status === 409, dDup.status);

  const p1 = await reqJson('POST', '/org/parishes', { deanery_id: deaneryId, name: 'St Mary Parish' }, token);
  assert('create parish → 201', p1.status === 201, JSON.stringify(p1.body).slice(0, 150));

  const delBlocked = await reqJson('DELETE', `/org/deaneries/${deaneryId}`, null, token);
  assert('delete deanery with parishes → 409', delBlocked.status === 409, delBlocked.status);

  const ren = await reqJson('PUT', `/org/parishes/${p1.body.data.id}`, { name: 'St Mary Cathedral' }, token);
  assert('rename parish → 200', ren.status === 200, ren.status);

  const struct = await reqJson('GET', '/org/structure', null, token);
  const deaneries = struct.body?.data?.deaneries || [];
  assert('structure has exactly own data', deaneries.length === 1 && deaneries[0].parishes.length === 1,
    JSON.stringify(deaneries).slice(0, 200));

  // Tenant isolation: Jalandhar admin must not see the new diocese's deaneries.
  const jalStruct = await reqJson('GET', '/org/structure', null, superToken);
  const jalNames = (jalStruct.body?.data?.deaneries || []).map(d => d.name);
  assert('Jalandhar structure non-empty (legacy rows)', jalNames.length > 0, jalNames.length);
  assert('no cross-tenant leak', !jalNames.includes('North Deanery'));

  // ── Org import ────────────────────────────────────────────────────────────
  console.log('\n[2] Org xlsx import');
  const orgFile = await xlsxBase64(['Deanery', 'Parish'], [
    ['South Deanery', 'Holy Cross'],
    ['South Deanery', 'St Thomas'],
    ['North Deanery', 'St Mary Cathedral'],   // exists -> skipped
    ['', 'Orphan Parish'],                    // bad row
  ]);
  const orgCommit = await reqJson('POST', '/imports/org/commit', { file_base64: orgFile, file_name: 'org.xlsx' }, token);
  assert('org commit → 201', orgCommit.status === 201, JSON.stringify(orgCommit.body).slice(0, 200));
  assert('org: 1 deanery + 2 parishes created',
    orgCommit.body?.data?.deaneries_created === 1 && orgCommit.body?.data?.parishes_created === 2,
    JSON.stringify(orgCommit.body?.data));
  assert('org: existing pair skipped', orgCommit.body?.data?.skipped_existing === 1);
  assert('org: bad row reported', orgCommit.body?.data?.failed_rows === 1);

  // ── Template + parse + validate ───────────────────────────────────────────
  console.log('\n[3] Template / parse / validate');
  const tpl = await reqJson('GET', '/imports/template?type=youth', null, token);
  assert('template → 200 + file', tpl.status === 200 && (tpl.body?.data?.file_base64 || '').length > 100);

  const HEADERS = ['Full Name', 'Father Name', 'Mother', 'Date of Birth', 'Baptism Date',
    'Mobile Number', 'Address', 'Deanery', 'Parish', 'Education', 'Designation', 'Level', 'Involvement'];
  const youthRows = [
    ['Anita Kumar', 'Kumar S', 'Leela', '2004-05-21', '2004-07-15', '9111100001', '1 Lane', 'South Deanery', 'Holy Cross', 'B.A.', 'Member', 'Parish', 'Choir'],
    ['Binod Toppo', 'Toppo R', 'Mary', '14/03/2005', '', '9111100002', '2 Lane', 'South Deanery', 'St Thomas', '', '', '', ''],
    ['Carol Minz', 'Minz P', 'Rita', '2003-12-01', '2004-01-10', '9111100003', '3 Lane', 'North Deanery', 'St Mary Cathedral', 'M.A.', '', '', ''],
    ['Bad Date', 'X', 'Y', 'not-a-date', '', '9111100004', '', 'South Deanery', 'Holy Cross', '', '', '', ''],
    ['Dup Phone', 'X', 'Y', '2004-01-01', '', '9111100001', '', 'South Deanery', 'Holy Cross', '', '', '', ''],
    ['Bad Parish', 'X', 'Y', '2004-01-01', '', '9111100005', '', 'South Deanery', 'Nowhere Parish', '', '', '', ''],
  ];
  const youthFile = await xlsxBase64(HEADERS, youthRows);

  const parsed = await reqJson('POST', '/imports/parse', { type: 'youth', file_base64: youthFile }, token);
  assert('parse → 200', parsed.status === 200, JSON.stringify(parsed.body).slice(0, 200));
  assert('auto-map covers all required', (parsed.body?.data?.unmapped_required || ['x']).length === 0,
    JSON.stringify(parsed.body?.data?.unmapped_required));
  assert('parse counts 6 rows', parsed.body?.data?.total_rows === 6);

  const val = await reqJson('POST', '/imports/youth/validate', { file_base64: youthFile }, token);
  assert('validate → 200', val.status === 200, JSON.stringify(val.body).slice(0, 200));
  assert('validate: 3 valid / 3 invalid',
    val.body?.data?.valid_rows === 3 && val.body?.data?.invalid_rows === 3,
    JSON.stringify(val.body?.data).slice(0, 300));

  // ── Commit with auto user creation ───────────────────────────────────────
  console.log('\n[4] Youth commit');
  const commit = await reqJson('POST', '/imports/youth/commit', {
    file_base64: youthFile, file_name: 'youth.xlsx',
    options: { auto_create_users: true }
  }, token);
  assert('commit → 201', commit.status === 201, JSON.stringify(commit.body).slice(0, 300));
  assert('3 inserted, 3 failed', commit.body?.data?.inserted_rows === 3 && commit.body?.data?.failed_rows === 3);
  assert('3 users created', commit.body?.data?.users_created === 3);
  assert('error file returned', (commit.body?.data?.error_file_base64 || '').length > 100);
  const cred = (commit.body?.data?.credentials || [])[0];
  assert('username follows 4-letter+DDMM scheme', cred && /^anit2105/.test(cred.username), cred && cred.username);

  const profCount = await queryOne('SELECT COUNT(*) c FROM profile WHERE diocese_id = ?', [dioceseId]);
  assert('3 profiles in new diocese', profCount?.c === 3, profCount?.c);
  const userCount = await queryOne(
    'SELECT COUNT(*) c FROM users WHERE diocese_id = ? AND role = \'profile_holder\'', [dioceseId]);
  assert('3 profile_holder users in new diocese', userCount?.c === 3, userCount?.c);

  // Imported youth can actually log in (password = phone).
  const youthLogin = await reqJson('POST', '/auth/login', { username: cred.username, password: '9111100001' });
  assert('imported youth login → 200', youthLogin.status === 200, JSON.stringify(youthLogin.body).slice(0, 150));

  // Re-commit: previously-inserted phones are now DB duplicates.
  const recommit = await reqJson('POST', '/imports/youth/commit', { file_base64: youthFile }, token);
  assert('re-commit inserts 0 (all dup phones)', recommit.body?.data?.inserted_rows === 0,
    JSON.stringify(recommit.body?.data).slice(0, 200));

  // Jalandhar untouched by all of the above.
  const jalProf = await queryOne(
    'SELECT COUNT(*) c FROM profile WHERE diocese_id = 1 OR diocese_id IS NULL');
  assert('Jalandhar profile count unchanged (2534)', jalProf?.c === 2534, jalProf?.c);

  // ── Audit log ────────────────────────────────────────────────────────────
  console.log('\n[5] import_jobs audit');
  const jobs = await reqJson('GET', '/imports/jobs', null, token);
  assert('jobs listed for diocese', (jobs.body?.data?.jobs || []).length === 3, jobs.body?.data?.jobs?.length);
  assert('youth job logged correctly',
    (jobs.body?.data?.jobs || []).some(j => j.type === 'youth' && j.inserted_rows === 3 && j.users_created === 3));

  await cleanup();
  console.log('\n[Cleanup] smoke diocese + all imported data removed');
  console.log(`\n=== RESULTS ===\n  PASSED: ${passed}\n  FAILED: ${failed}`);
  process.exit(failed ? 1 : 0);
}

run().catch(async e => { console.error('Smoke test crashed:', e); await cleanup().catch(() => {}); process.exit(1); });
