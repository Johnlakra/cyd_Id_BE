// scripts/platform-smoke.js — Phase 1 onboarding smoke test.
// Register diocese -> super_admin list/approve -> new diocese admin login ->
// suspend -> cleanup. Run against a local server: node scripts/platform-smoke.js
require('dotenv').config();
const http = require('http');
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

async function run() {
  console.log('=== PLATFORM PHASE 1 SMOKE TEST ===\n');
  const SLUG = 'smoke-test-diocese';

  // Pre-clean any leftovers from a previous run.
  await query('DELETE FROM users WHERE username = ?', [`${SLUG}.admin`]);
  await query('DELETE FROM dioceses WHERE slug = ?', [SLUG]);

  // 1. Public registration
  const reg = await reqJson('POST', '/platform/dioceses/register', {
    name: 'Smoke Test Diocese',
    slug: SLUG,
    contact_email: 'smoke@example.com',
    contact_phone: '9876543210',
    address: '1 Test Lane',
  });
  assert('register → 201', reg.status === 201, JSON.stringify(reg.body).slice(0, 200));
  assert('register status=pending', reg.body?.data?.status === 'pending');
  const dioceseId = reg.body?.data?.id;

  // 2. Duplicate slug rejected
  const dup = await reqJson('POST', '/platform/dioceses/register', {
    name: 'Smoke Test Diocese', slug: SLUG,
    contact_email: 'smoke@example.com', contact_phone: '9876543210',
  });
  assert('duplicate slug → 409', dup.status === 409, dup.status);

  // 3. Bad payload rejected
  const bad = await reqJson('POST', '/platform/dioceses/register', { name: 'x' });
  assert('invalid payload → 400', bad.status === 400, bad.status);

  // 4. super_admin login (admin was granted platform_role)
  const login = await reqJson('POST', '/auth/login', { username: 'admin', password: 'CYD@123.' });
  const token = login.body?.data?.token;
  assert('super_admin login → 200 + token', login.status === 200 && !!token);

  // 5. Guards: no token / non-super-admin
  const noTok = await reqJson('GET', '/platform/dioceses');
  assert('list without token → 401', noTok.status === 401, noTok.status);

  // 6. List pending
  const list = await reqJson('GET', '/platform/dioceses?status=pending', null, token);
  assert('list pending → 200', list.status === 200, list.status);
  assert('pending list contains new diocese',
    (list.body?.data?.dioceses || []).some(d => d.slug === SLUG));

  // 7. Approve
  const approve = await reqJson('PUT', `/platform/dioceses/${dioceseId}/approve`, {}, token);
  assert('approve → 200', approve.status === 200, JSON.stringify(approve.body).slice(0, 200));
  assert('admin account created', approve.body?.data?.admin?.created === true);

  // 8. Re-approve rejected
  const reApprove = await reqJson('PUT', `/platform/dioceses/${dioceseId}/approve`, {}, token);
  assert('re-approve → 409', reApprove.status === 409, reApprove.status);

  // 9. New diocese admin can log in (password = contact phone) and carries its diocese
  const newLogin = await reqJson('POST', '/auth/login', { username: `${SLUG}.admin`, password: '9876543210' });
  assert('new diocese admin login → 200', newLogin.status === 200, JSON.stringify(newLogin.body).slice(0, 200));
  assert('new admin role=admin', newLogin.body?.data?.user?.role === 'admin');
  const adminRow = await queryOne('SELECT diocese_id FROM users WHERE username = ?', [`${SLUG}.admin`]);
  assert('new admin scoped to new diocese', adminRow?.diocese_id === dioceseId, JSON.stringify(adminRow));

  // 10. New admin is NOT a super_admin
  const notSuper = await reqJson('GET', '/platform/dioceses', null, newLogin.body?.data?.token);
  assert('diocese admin on platform route → 403', notSuper.status === 403, notSuper.status);

  // 11. Suspend; diocese 1 protected
  const suspend = await reqJson('PUT', `/platform/dioceses/${dioceseId}/suspend`, {}, token);
  assert('suspend → 200', suspend.status === 200, suspend.status);
  const protect = await reqJson('PUT', '/platform/dioceses/1/suspend', {}, token);
  assert('suspend diocese 1 → 400', protect.status === 400, protect.status);

  // Cleanup
  await query('DELETE FROM users WHERE username = ?', [`${SLUG}.admin`]);
  await query('DELETE FROM dioceses WHERE slug = ?', [SLUG]);
  console.log('\n[Cleanup] smoke diocese + admin removed');

  console.log(`\n=== RESULTS ===\n  PASSED: ${passed}\n  FAILED: ${failed}`);
  process.exit(failed ? 1 : 0);
}

run().catch(e => { console.error('Smoke test crashed:', e); process.exit(1); });
