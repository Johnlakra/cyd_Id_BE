// scripts/idcard-templates-smoke.js — Phase 4 smoke test: ID card templates.
// Proves the backend half of the phase exit criteria: Jalandhar's legacy
// layouts resolve as seeded pixel-identical templates, and a new diocese can
// build a card template end-to-end (gallery preset -> create -> resolve ->
// default switch -> duplicate -> delete), with permission + tenant isolation.
// Requires a local server on :3000, a super_admin 'admin' user, and
// scripts/seedJalandharTemplates.js having run.
// Self-cleaning. Usage: node scripts/idcard-templates-smoke.js
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

const SLUG = 'card-smoke-diocese';

const cleanup = async () => {
  const d = await queryOne('SELECT id FROM dioceses WHERE slug = ?', [SLUG]);
  if (d) {
    await query('DELETE FROM id_card_templates WHERE diocese_id = ?', [d.id]);
    await query(`DELETE rp FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.diocese_id = ?`, [d.id]);
    await query('DELETE FROM roles WHERE diocese_id = ?', [d.id]);
    await query('DELETE FROM users WHERE diocese_id = ?', [d.id]);
    await query('DELETE FROM dioceses WHERE id = ?', [d.id]);
  }
};

async function run() {
  console.log('=== PLATFORM PHASE 4 SMOKE TEST (ID card templates) ===\n');
  await cleanup();

  // ── Setup ──────────────────────────────────────────────────────────────────
  console.log('[setup]');
  const superLogin = await reqJson('POST', '/auth/login', { username: 'admin', password: 'CYD@123.' });
  const superToken = superLogin.body?.data?.token;
  assert('super_admin login', !!superToken);

  const reg = await reqJson('POST', '/platform/dioceses/register', {
    name: 'Card Smoke Diocese', slug: SLUG,
    contact_email: 'card-smoke@example.com', contact_phone: '9000000003',
  });
  const dioceseId = reg.body?.data?.id;
  await reqJson('PUT', `/platform/dioceses/${dioceseId}/approve`, {}, superToken);
  const adminLogin = await reqJson('POST', '/auth/login', { username: `${SLUG}.admin`, password: '9000000003' });
  const adminToken = adminLogin.body?.data?.token;
  assert('new diocese admin login', !!adminToken);

  // ── Jalandhar legacy seeds resolve pixel-identically ──────────────────────
  console.log('\n[1] Jalandhar legacy seeds');
  for (const level of ['parish', 'deanery', 'dexco']) {
    const resolved = await reqJson('GET', `/idcard-templates/resolve?level=${level}`, null, superToken);
    const t = resolved.body?.data?.template;
    assert(`diocese 1 resolves ${level}`, resolved.status === 200 && t?.name === `Legacy ${level[0].toUpperCase()}${level.slice(1)}`,
      JSON.stringify(t?.name));
    if (level === 'parish') {
      const photo = (t?.layout_json?.elements || []).find(e => e.id === 'photo');
      const name = (t?.layout_json?.elements || []).find(e => e.id === 'name');
      assert('legacy photo geometry exact (y=42.5, w=58, h=67, r=14)',
        photo && photo.y === 42.5 && photo.w === 58 && photo.h === 67 && photo.borderRadius === 14,
        JSON.stringify(photo));
      assert('legacy name typography exact (Vidaloka 31.5 #C01E2C)',
        name && name.fontFamily === 'Vidaloka' && name.fontSize === 31.5 && name.color === '#C01E2C',
        JSON.stringify(name));
      assert('legacy background sentinel', t.background_url === 'legacy:parish', t.background_url);
      assert('card size 146.30 x 221.80', Number(t.width_mm) === 146.3 && Number(t.height_mm) === 221.8,
        `${t.width_mm} x ${t.height_mm}`);
    }
  }

  // ── New diocese: no template -> legacy fallback signal ────────────────────
  console.log('\n[2] New diocese end-to-end');
  const none = await reqJson('GET', '/idcard-templates/resolve?level=parish', null, adminToken);
  assert('new diocese resolves nothing yet → 404 (legacy fallback)', none.status === 404, none.status);

  const gallery = await reqJson('GET', '/idcard-templates/gallery', null, adminToken);
  const classic = (gallery.body?.data?.templates || []).find(t => t.key === 'classic');
  assert('gallery has 4 starter presets', (gallery.body?.data?.templates || []).length === 4);

  const created = await reqJson('POST', '/idcard-templates', {
    level: 'parish', name: 'Our Parish Card',
    background_url: 'https://example.com/bg.jpg',
    layout_json: classic.layout_json
  }, adminToken);
  assert('create from gallery preset → 201', created.status === 201, JSON.stringify(created.body).slice(0, 200));
  const tplId = created.body?.data?.template?.id;
  assert('first template auto-defaults', created.body?.data?.template?.is_default === 1);

  const resolved = await reqJson('GET', '/idcard-templates/resolve?level=parish', null, adminToken);
  assert('new diocese now resolves its template', resolved.body?.data?.template?.id === tplId);

  // Validation guard
  const bad = await reqJson('POST', '/idcard-templates', {
    level: 'parish', name: 'Bad', background_url: 'x',
    layout_json: { elements: [{ type: 'text', field: 'not_a_field', x: 'NaN', y: 1 }] }
  }, adminToken);
  assert('invalid layout rejected → 400', bad.status === 400, JSON.stringify(bad.body).slice(0, 150));

  // Update layout
  const moved = JSON.parse(JSON.stringify(classic.layout_json));
  moved.elements[0].y = 45;
  const upd = await reqJson('PUT', `/idcard-templates/${tplId}`, { layout_json: moved }, adminToken);
  assert('update layout → 200', upd.status === 200 && upd.body?.data?.template?.layout_json?.elements[0]?.y === 45);

  // Second template + default switch
  const second = await reqJson('POST', '/idcard-templates', {
    level: 'parish', name: 'Alt Parish Card',
    background_url: 'https://example.com/bg2.jpg',
    layout_json: classic.layout_json
  }, adminToken);
  const secondId = second.body?.data?.template?.id;
  assert('second template not default', second.body?.data?.template?.is_default === 0);

  const setDef = await reqJson('PUT', `/idcard-templates/${secondId}/default`, {}, adminToken);
  assert('default switch → 200', setDef.status === 200, setDef.status);
  const resolved2 = await reqJson('GET', '/idcard-templates/resolve?level=parish', null, adminToken);
  assert('resolve follows new default', resolved2.body?.data?.template?.id === secondId);

  // Duplicate + soft delete fallback
  const dup = await reqJson('POST', `/idcard-templates/${secondId}/duplicate`, { name: 'Copy' }, adminToken);
  assert('duplicate → 201', dup.status === 201, dup.status);

  const del = await reqJson('DELETE', `/idcard-templates/${secondId}`, null, adminToken);
  assert('soft delete default → 200', del.status === 200, del.status);
  const resolved3 = await reqJson('GET', '/idcard-templates/resolve?level=parish', null, adminToken);
  assert('resolve falls back to an active template', resolved3.status === 200 && resolved3.body?.data?.template?.id !== secondId,
    JSON.stringify(resolved3.body?.data?.template?.id));

  const list = await reqJson('GET', '/idcard-templates?level=parish', null, adminToken);
  assert('list excludes inactive', (list.body?.data?.templates || []).every(t => t.id !== secondId));

  // ── Permission + tenant isolation ─────────────────────────────────────────
  console.log('\n[3] Isolation');
  // A profile_holder-style user: reads OK, writes 403 (no idcards.design).
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('Holder@123', 12);
  await query(
    `INSERT INTO users (username, email, password, role, status, diocese_id, created_at, updated_at)
     VALUES ('card.smoke.holder', 'card.smoke.holder@example.com', ?, 'user', 1, ?, NOW(), NOW())`,
    [hash, dioceseId]
  );
  const holderLogin = await reqJson('POST', '/auth/login', { username: 'card.smoke.holder', password: 'Holder@123' });
  const holderToken = holderLogin.body?.data?.token;
  assert('plain user can resolve (render path)',
    (await reqJson('GET', '/idcard-templates/resolve?level=parish', null, holderToken)).status === 200);
  assert('plain user cannot create → 403',
    (await reqJson('POST', '/idcard-templates', {
      level: 'parish', name: 'Nope', background_url: 'x'.repeat(101),
      layout_json: classic.layout_json
    }, holderToken)).status === 403);

  // Cross-tenant: Jalandhar admin cannot see or edit the new diocese's template.
  assert('cross-tenant get → 404',
    (await reqJson('GET', `/idcard-templates/${tplId}`, null, superToken)).status === 404);
  assert('cross-tenant edit → 404',
    (await reqJson('PUT', `/idcard-templates/${tplId}`, { name: 'Hijack' }, superToken)).status === 404);
  const jalList = await reqJson('GET', '/idcard-templates', null, superToken);
  assert('Jalandhar list = its 3 seeds only',
    (jalList.body?.data?.templates || []).length === 3
    && jalList.body.data.templates.every(t => t.background_url.startsWith('legacy:')),
    jalList.body?.data?.templates?.length);

  await cleanup();
  console.log('\n[Cleanup] smoke diocese + templates removed');
  console.log(`\n=== RESULTS ===\n  PASSED: ${passed}\n  FAILED: ${failed}`);
  process.exit(failed ? 1 : 0);
}

run().catch(async e => { console.error('Smoke test crashed:', e); await cleanup().catch(() => {}); process.exit(1); });
