// scripts/permissions-smoke.js — Phase 3 smoke test: granular permission engine.
// Proves the phase exit criterion: admin can grant/revoke ANY permission —
// including a specific ui.tab.* key — via custom roles and per-user overrides
// (deny wins), while legacy admin behavior is unchanged.
// Requires a local server on :3000 and a super_admin 'admin' user.
// Self-cleaning. Usage: node scripts/permissions-smoke.js
require('dotenv').config();
const http = require('http');
const bcrypt = require('bcryptjs');
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

const SLUG = 'perm-smoke-diocese';
const VOLUNTEER = 'perm.smoke.volunteer';

const cleanup = async () => {
  const d = await queryOne('SELECT id FROM dioceses WHERE slug = ?', [SLUG]);
  if (d) {
    await query(`DELETE o FROM user_permission_overrides o JOIN users u ON u.id = o.user_id WHERE u.diocese_id = ?`, [d.id]);
    await query(`DELETE ur FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE u.diocese_id = ?`, [d.id]);
    await query(`DELETE rp FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.diocese_id = ?`, [d.id]);
    await query('DELETE FROM roles WHERE diocese_id = ?', [d.id]);
    await query('DELETE FROM import_jobs WHERE diocese_id = ?', [d.id]);
    await query('DELETE FROM users WHERE diocese_id = ?', [d.id]);
    await query('DELETE FROM dioceses WHERE id = ?', [d.id]);
  }
};

async function run() {
  console.log('=== PLATFORM PHASE 3 SMOKE TEST (permission engine) ===\n');
  await cleanup();

  // ── Setup: fresh diocese + an ordinary (non-admin) user in it ─────────────
  console.log('[setup]');
  const superLogin = await reqJson('POST', '/auth/login', { username: 'admin', password: 'CYD@123.' });
  const superToken = superLogin.body?.data?.token;
  assert('super_admin login', !!superToken);

  const reg = await reqJson('POST', '/platform/dioceses/register', {
    name: 'Perm Smoke Diocese', slug: SLUG,
    contact_email: 'perm-smoke@example.com', contact_phone: '9000000002',
  });
  const dioceseId = reg.body?.data?.id;
  const approve = await reqJson('PUT', `/platform/dioceses/${dioceseId}/approve`, {}, superToken);
  assert('diocese approved', approve.status === 200, approve.status);

  const roleCount = await queryOne('SELECT COUNT(*) c FROM roles WHERE diocese_id = ? AND is_system = 1', [dioceseId]);
  assert('system roles provisioned on approval', roleCount?.c === 4, roleCount?.c);

  const adminLogin = await reqJson('POST', '/auth/login', { username: `${SLUG}.admin`, password: '9000000002' });
  const adminToken = adminLogin.body?.data?.token;
  assert('diocese admin login', !!adminToken);

  const hash = await bcrypt.hash('Volunteer@123', 12);
  await query(
    `INSERT INTO users (username, email, password, role, status, diocese_id, created_at, updated_at)
     VALUES (?, ?, ?, 'user', 1, ?, NOW(), NOW())`,
    [VOLUNTEER, `${VOLUNTEER}@example.com`, hash, dioceseId]
  );
  const volunteer = await queryOne('SELECT id FROM users WHERE username = ?', [VOLUNTEER]);
  const volLogin = await reqJson('POST', '/auth/login', { username: VOLUNTEER, password: 'Volunteer@123' });
  let volToken = volLogin.body?.data?.token;
  assert('volunteer login', !!volToken);

  // ── Resolution baseline ───────────────────────────────────────────────────
  console.log('\n[1] Resolution baseline');
  const adminPerms = await reqJson('GET', '/auth/me/permissions', null, adminToken);
  const adminKeys = adminPerms.body?.data?.permissions || [];
  assert('admin resolves to full catalog (30 keys)', adminKeys.length === 30, adminKeys.length);
  assert('admin has a ui.button key', adminKeys.includes('ui.button.export_xlsx'));

  const volPerms = await reqJson('GET', '/auth/me/permissions', null, volToken);
  assert('volunteer starts with zero permissions', (volPerms.body?.data?.permissions || ['x']).length === 0,
    JSON.stringify(volPerms.body?.data));

  assert('volunteer blocked on /org', (await reqJson('GET', '/org/structure', null, volToken)).status === 403);
  assert('volunteer blocked on /imports', (await reqJson('GET', '/imports/jobs', null, volToken)).status === 403);
  assert('volunteer blocked on /permissions (admin-only)',
    (await reqJson('GET', '/permissions/catalog', null, volToken)).status === 403);

  // ── Catalog + matrix ──────────────────────────────────────────────────────
  console.log('\n[2] Catalog + matrix');
  const catalog = await reqJson('GET', '/permissions/catalog', null, adminToken);
  assert('catalog grouped by module', !!catalog.body?.data?.modules?.ui && !!catalog.body?.data?.modules?.events);

  const matrix = await reqJson('GET', '/permissions/matrix', null, adminToken);
  const mRoles = matrix.body?.data?.roles || [];
  const grid = matrix.body?.data?.grid || {};
  const locRole = mRoles.find(r => r.role_key === 'event_loc');
  assert('matrix has 4 system roles', mRoles.filter(r => r.is_system).length === 4, mRoles.length);
  assert('event_loc grid row has events.view', locRole && (grid[locRole.id] || []).includes('events.view'));

  // ── Custom role: grant a tab + an API permission ──────────────────────────
  console.log('\n[3] Custom role grant/revoke');
  const created = await reqJson('POST', '/permissions/roles', { role_key: 'org_volunteer', label: 'Org Volunteer' }, adminToken);
  assert('create custom role → 201', created.status === 201, JSON.stringify(created.body).slice(0, 150));
  const roleId = created.body?.data?.id;

  const setPerms = await reqJson('PUT', `/permissions/roles/${roleId}/permissions`,
    { perm_keys: ['org.manage', 'ui.tab.org'] }, adminToken);
  assert('set role permissions → 200', setPerms.status === 200, JSON.stringify(setPerms.body).slice(0, 150));

  const badPerms = await reqJson('PUT', `/permissions/roles/${roleId}/permissions`,
    { perm_keys: ['no.such.key'] }, adminToken);
  assert('unknown perm key → 400', badPerms.status === 400, badPerms.status);

  const assign = await reqJson('POST', `/permissions/users/${volunteer.id}/roles`, { role_id: roleId }, adminToken);
  assert('assign role → 201', assign.status === 201, JSON.stringify(assign.body).slice(0, 150));

  const volPerms2 = await reqJson('GET', '/auth/me/permissions', null, volToken);
  const keys2 = volPerms2.body?.data?.permissions || [];
  assert('volunteer now has ui.tab.org (specific tab grant!)', keys2.includes('ui.tab.org'), JSON.stringify(keys2));
  assert('volunteer now has org.manage', keys2.includes('org.manage'));
  assert('volunteer can use /org now', (await reqJson('GET', '/org/structure', null, volToken)).status === 200);
  assert('volunteer still blocked on /imports', (await reqJson('GET', '/imports/jobs', null, volToken)).status === 403);

  // ── Overrides: deny wins; allow grants without a role ────────────────────
  console.log('\n[4] Overrides');
  const deny = await reqJson('PUT', `/permissions/users/${volunteer.id}/overrides`,
    { perm_key: 'org.manage', effect: 'deny' }, adminToken);
  assert('deny override saved', deny.status === 200, deny.status);
  assert('deny wins over role grant → /org 403',
    (await reqJson('GET', '/org/structure', null, volToken)).status === 403);

  const clear = await reqJson('PUT', `/permissions/users/${volunteer.id}/overrides`,
    { perm_key: 'org.manage', effect: null }, adminToken);
  assert('override cleared', clear.status === 200, clear.status);
  assert('access restored after clear', (await reqJson('GET', '/org/structure', null, volToken)).status === 200);

  const allow = await reqJson('PUT', `/permissions/users/${volunteer.id}/overrides`,
    { perm_key: 'imports.run', effect: 'allow' }, adminToken);
  assert('allow override saved', allow.status === 200, allow.status);
  assert('allow override grants /imports without any role',
    (await reqJson('GET', '/imports/jobs', null, volToken)).status === 200);

  const drawer = await reqJson('GET', `/permissions/users/${volunteer.id}`, null, adminToken);
  assert('user drawer shows role + override + effective set',
    (drawer.body?.data?.roles || []).length === 1
    && (drawer.body?.data?.overrides || []).length === 1
    && (drawer.body?.data?.effective_permissions || []).includes('imports.run'),
    JSON.stringify(drawer.body?.data).slice(0, 250));

  // ── Revoke + role management edges ───────────────────────────────────────
  console.log('\n[5] Revoke + edges');
  const removeR = await reqJson('DELETE', `/permissions/users/${volunteer.id}/roles/${roleId}`, null, adminToken);
  assert('remove role → 200', removeR.status === 200, removeR.status);
  assert('role revoke blocks /org again', (await reqJson('GET', '/org/structure', null, volToken)).status === 403);

  const dupRole = await reqJson('POST', `/permissions/roles/${roleId}/duplicate`,
    { role_key: 'org_volunteer_copy', label: 'Org Volunteer Copy' }, adminToken);
  assert('duplicate role → 201', dupRole.status === 201, JSON.stringify(dupRole.body).slice(0, 150));

  const rolesList = await reqJson('GET', '/permissions/roles', null, adminToken);
  const copyRole = (rolesList.body?.data?.roles || []).find(r => r.role_key === 'org_volunteer_copy');
  assert('duplicate carries permission set', copyRole && copyRole.permissions.includes('org.manage'),
    JSON.stringify(copyRole));

  const adminRole = (rolesList.body?.data?.roles || []).find(r => r.role_key === 'admin');
  assert('system role delete blocked → 400',
    (await reqJson('DELETE', `/permissions/roles/${adminRole.id}`, null, adminToken)).status === 400);
  assert('admin system role permissions immutable → 400',
    (await reqJson('PUT', `/permissions/roles/${adminRole.id}/permissions`, { perm_keys: [] }, adminToken)).status === 400);
  assert('custom role delete → 200',
    (await reqJson('DELETE', `/permissions/roles/${copyRole.id}`, null, adminToken)).status === 200);

  // Cross-tenant: Jalandhar admin cannot touch this diocese's role.
  const cross = await reqJson('PUT', `/permissions/roles/${roleId}/permissions`, { perm_keys: [] }, superToken);
  assert('cross-tenant role edit → 404', cross.status === 404, cross.status);

  // Legacy Jalandhar admin still resolves to everything.
  const jalPerms = await reqJson('GET', '/auth/me/permissions', null, superToken);
  assert('Jalandhar admin resolves to full catalog', (jalPerms.body?.data?.permissions || []).length === 30);

  await cleanup();
  console.log('\n[Cleanup] smoke diocese + roles + users removed');
  console.log(`\n=== RESULTS ===\n  PASSED: ${passed}\n  FAILED: ${failed}`);
  process.exit(failed ? 1 : 0);
}

run().catch(async e => { console.error('Smoke test crashed:', e); await cleanup().catch(() => {}); process.exit(1); });
