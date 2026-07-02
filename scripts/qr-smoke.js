// scripts/qr-smoke.js — Phase 6 QR instant registration smoke test.
// Exercises token provisioning, scan lookup + eligibility, scan-desk
// registration (duplicate → 409 with timestamp), manual profile_id fallback,
// and the profile-holder my-qr guard.
// Run against a locally running backend: node scripts/qr-smoke.js
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
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
    resp.on('end', () => {
      try { res({ status: resp.statusCode, body: JSON.parse(b) }); }
      catch { res({ status: resp.statusCode, body: b }); }
    });
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

// Pick a diocese-1 profile whose deanery is served by the phagwara venue and
// that has no registration row at all (clean fixture for the duplicate tests).
const pickUnregisteredProfile = async (deaneries, excludeIds = []) => {
  const notIn = excludeIds.length ? `AND p.id NOT IN (${excludeIds.map(Number).join(',')})` : '';
  return queryOne(
    `SELECT p.id, p.name, p.deanery FROM profile p
     LEFT JOIN anubhav_registrations ar ON ar.profile_id = p.id
     WHERE p.status = 1 AND (p.diocese_id = 1 OR p.diocese_id IS NULL)
       AND p.deanery IN (${deaneries.map(() => '?').join(',')})
       AND ar.id IS NULL ${notIn}
     LIMIT 1`,
    deaneries
  );
};

async function run() {
  console.log('=== QR INSTANT REGISTRATION SMOKE TEST (Phase 6) ===\n');
  const registrationIds = [];
  let draftEventId = null;

  // ── 1. Auth ────────────────────────────────────────────────────────────
  console.log('[1] Auth');
  const loginRes = await reqJson('POST', '/auth/login', { username: 'admin', password: 'CYD@123.' });
  assert('admin login → 200', loginRes.status === 200, loginRes.status);
  const token = loginRes.body?.data?.token;
  assert('received JWT', !!token, JSON.stringify(loginRes.body).slice(0, 200));
  if (!token) { console.error('Cannot continue without token'); process.exit(1); }

  // ── 2. Auth guard ───────────────────────────────────────────────────────
  console.log('\n[2] Auth guard');
  const noAuth = await reqJson('GET', `/profiles/qr/${crypto.randomUUID()}`);
  assert('GET /profiles/qr/:token without token → 401', noAuth.status === 401, noAuth.status);

  // ── 3. Fixture profiles ─────────────────────────────────────────────────
  console.log('\n[3] Fixture profiles (phagwara deaneries, never registered)');
  const PHAGWARA_DEANERIES = ['Hoshiarpur','Tanda','Jalandhar Cantt.','Jalandhar City','Kapurthala','Sahnewal','Ludhiana'];
  const profileA = await pickUnregisteredProfile(PHAGWARA_DEANERIES);
  const profileB = await pickUnregisteredProfile(PHAGWARA_DEANERIES, [profileA?.id]);
  assert('found fixture profile A', !!profileA, 'no unregistered phagwara-deanery profile in DB');
  assert('found fixture profile B', !!profileB, 'no second unregistered profile');
  if (!profileA || !profileB) process.exit(1);

  // ── 4. Token provisioning (ensure) ─────────────────────────────────────
  console.log('\n[4] POST /profiles/qr/ensure/:profileId');
  const ensure1 = await reqJson('POST', `/profiles/qr/ensure/${profileA.id}`, null, token);
  assert('ensure → 200', ensure1.status === 200, JSON.stringify(ensure1.body).slice(0, 200));
  const qrToken = ensure1.body?.data?.qr_token;
  assert('qr_token returned', !!qrToken, ensure1.body?.data);
  assert('payload format CYD:jalandhar:<token>', ensure1.body?.data?.payload === `CYD:jalandhar:${qrToken}`,
         ensure1.body?.data?.payload);

  const ensure2 = await reqJson('POST', `/profiles/qr/ensure/${profileA.id}`, null, token);
  assert('ensure is idempotent (same token)', ensure2.body?.data?.qr_token === qrToken,
         ensure2.body?.data?.qr_token);

  const ensureMissing = await reqJson('POST', '/profiles/qr/ensure/99999999', null, token);
  assert('ensure unknown profile → 404', ensureMissing.status === 404, ensureMissing.status);

  // ── 5. Scan lookup ──────────────────────────────────────────────────────
  console.log('\n[5] GET /profiles/qr/:token');
  const lookup = await reqJson('GET', `/profiles/qr/${qrToken}`, null, token);
  assert('lookup → 200', lookup.status === 200, lookup.status);
  assert('name matches', lookup.body?.data?.profile?.name === profileA.name,
         `${lookup.body?.data?.profile?.name} != ${profileA.name}`);
  assert('parish/deanery present', !!lookup.body?.data?.profile?.deanery, lookup.body?.data?.profile);

  const badFormat = await reqJson('GET', '/profiles/qr/not-a-uuid', null, token);
  assert('malformed token → 400', badFormat.status === 400, badFormat.status);

  const unknown = await reqJson('GET', `/profiles/qr/${crypto.randomUUID()}`, null, token);
  assert('unknown token → 404', unknown.status === 404, unknown.status);

  // ── 6. Eligibility for event 1 / phagwara ───────────────────────────────
  console.log('\n[6] Eligibility (event 1, phagwara)');
  const elig = await reqJson('GET', `/profiles/qr/${qrToken}?event_id=1&venue_key=phagwara`, null, token);
  assert('eligibility lookup → 200', elig.status === 200, JSON.stringify(elig.body).slice(0, 200));
  assert('eligible=true before registration', elig.body?.data?.eligibility?.eligible === true,
         JSON.stringify(elig.body?.data?.eligibility));
  assert('already_registered=false', elig.body?.data?.eligibility?.already_registered === false);

  const badVenue = await reqJson('GET', `/profiles/qr/${qrToken}?event_id=1&venue_key=nope`, null, token);
  assert('unknown venue → 404', badVenue.status === 404, badVenue.status);

  // ── 7. Scan-desk registration by qr_token ───────────────────────────────
  console.log('\n[7] POST /events/1/registrations (qr_token)');
  const t0 = Date.now();
  const reg = await reqJson('POST', '/events/1/registrations',
    { qr_token: qrToken, venue_key: 'phagwara' }, token);
  const elapsedMs = Date.now() - t0;
  assert('register → 201', reg.status === 201, JSON.stringify(reg.body).slice(0, 300));
  assert('round trip < 2s', elapsedMs < 2000, `${elapsedMs}ms`);
  assert('registration has event_id=1', reg.body?.data?.registration?.event_id === 1,
         reg.body?.data?.registration?.event_id);
  assert('fee from event (50)', reg.body?.data?.registration?.fee_amount === 50,
         reg.body?.data?.registration?.fee_amount);
  assert('profile summary returned', reg.body?.data?.profile?.name === profileA.name);
  if (reg.body?.data?.registration?.id) registrationIds.push(reg.body.data.registration.id);

  // ── 8. Duplicate scan → 409 with timestamp ──────────────────────────────
  console.log('\n[8] Duplicate scan');
  const dup = await reqJson('POST', '/events/1/registrations',
    { qr_token: qrToken, venue_key: 'phagwara' }, token);
  assert('duplicate → 409', dup.status === 409, dup.status);
  assert('already_registered flag', dup.body?.data?.already_registered === true, JSON.stringify(dup.body));
  assert('registered_at timestamp present', !!dup.body?.data?.registered_at, dup.body?.data);

  const eligAfter = await reqJson('GET', `/profiles/qr/${qrToken}?event_id=1&venue_key=phagwara`, null, token);
  assert('eligibility now already_registered', eligAfter.body?.data?.eligibility?.already_registered === true);
  assert('eligibility now eligible=false', eligAfter.body?.data?.eligibility?.eligible === false);

  // ── 9. Deanery not assigned to venue → 400 ──────────────────────────────
  console.log('\n[9] Wrong venue for deanery');
  const wrongVenue = await reqJson('POST', '/events/1/registrations',
    { qr_token: qrToken, venue_key: 'abohar' }, token);
  assert('phagwara-deanery profile at abohar → 400', wrongVenue.status === 400, wrongVenue.status);

  // ── 10. Manual fallback by profile_id ───────────────────────────────────
  console.log('\n[10] Manual fallback (profile_id)');
  const regManual = await reqJson('POST', '/events/1/registrations',
    { profile_id: profileB.id, venue_key: 'phagwara' }, token);
  assert('register by profile_id → 201', regManual.status === 201, JSON.stringify(regManual.body).slice(0, 300));
  if (regManual.body?.data?.registration?.id) registrationIds.push(regManual.body.data.registration.id);

  const noIds = await reqJson('POST', '/events/1/registrations', { venue_key: 'phagwara' }, token);
  assert('neither qr_token nor profile_id → 400', noIds.status === 400, noIds.status);

  const noVenue = await reqJson('POST', '/events/1/registrations', { qr_token: qrToken }, token);
  assert('missing venue_key → 400', noVenue.status === 400, noVenue.status);

  // ── 11. Non-open event rejected ─────────────────────────────────────────
  console.log('\n[11] Draft event rejects registration');
  const draftEv = await reqJson('POST', '/events',
    { name: 'QR Smoke Draft Event', status: 'draft' }, token);
  draftEventId = draftEv.body?.data?.event?.id;
  assert('draft event created', !!draftEventId, draftEv.status);
  const regDraft = await reqJson('POST', `/events/${draftEventId}/registrations`,
    { qr_token: qrToken, venue_key: 'anything' }, token);
  assert('register on draft event → 400', regDraft.status === 400, regDraft.status);

  // ── 12. Profile-holder my-qr guards ─────────────────────────────────────
  console.log('\n[12] Profile-holder /my-qr guards');
  const myQrNoAuth = await reqJson('GET', '/profile-holder/my-qr');
  assert('my-qr without token → 401', myQrNoAuth.status === 401, myQrNoAuth.status);
  const myQrAdmin = await reqJson('GET', '/profile-holder/my-qr', null, token);
  assert('my-qr with admin token → 403', myQrAdmin.status === 403, myQrAdmin.status);

  // ── Cleanup ────────────────────────────────────────────────────────────
  console.log('\n[Cleanup]');
  try {
    if (registrationIds.length) {
      await query(`DELETE FROM anubhav_registrations WHERE id IN (${registrationIds.map(Number).join(',')})`);
    }
    if (draftEventId) {
      await query('DELETE FROM events WHERE id = ?', [draftEventId]);
    }
    console.log('  cleanup done');
  } catch (e) {
    console.error('  cleanup error:', e.message);
  }

  // ── Results ────────────────────────────────────────────────────────────
  console.log('\n=== RESULTS ===');
  console.log(`  PASSED: ${passed}`);
  console.log(`  FAILED: ${failed}`);
  console.log(`  TOTAL:  ${passed + failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
