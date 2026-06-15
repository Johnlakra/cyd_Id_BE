// scripts/events-smoke.js — Phase 5 events engine smoke test.
// Exercises events CRUD, venue management, stats, and the anubhavRole DB fallback.
// Run against a locally running backend: node scripts/events-smoke.js
require('dotenv').config();
const http = require('http');
const { query } = require('../config/database');

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

async function run() {
  console.log('=== EVENTS ENGINE SMOKE TEST (Phase 5) ===\n');

  // ── 1. Auth ────────────────────────────────────────────────────────────
  console.log('[1] Auth');
  const loginRes = await reqJson('POST', '/auth/login', { username: 'admin', password: 'CYD@123.' });
  assert('admin login → 200', loginRes.status === 200, loginRes.status);
  const token = loginRes.body?.data?.token;
  assert('received JWT', !!token, JSON.stringify(loginRes.body).slice(0, 200));
  if (!token) { console.error('Cannot continue without token'); process.exit(1); }

  // ── 2. Auth guard on events routes ─────────────────────────────────────
  console.log('\n[2] Auth guard');
  const noAuth = await reqJson('GET', '/events');
  assert('GET /events without token → 401', noAuth.status === 401, noAuth.status);

  // ── 3. GET /events — should include Anubhav 2026 (event_id=1) ──────────
  console.log('\n[3] List events — Anubhav 2026 present');
  const listRes = await reqJson('GET', '/events', null, token);
  assert('GET /events → 200', listRes.status === 200, listRes.status);
  const events = listRes.body?.data?.events || [];
  assert('list contains events', events.length > 0, `count=${events.length}`);
  const anubhav = events.find(e => e.id === 1);
  assert('Anubhav 2026 present (id=1)', !!anubhav, JSON.stringify(events.map(e => e.id)));
  assert('Anubhav 2026 status=open', anubhav?.status === 'open', anubhav?.status);
  assert('Anubhav 2026 has 3 venues', Number(anubhav?.venue_count) === 3, anubhav?.venue_count);

  // ── 4. GET /events/1 — with venues embedded ──────────────────────────
  console.log('\n[4] Get Anubhav 2026 detail');
  const detail = await reqJson('GET', '/events/1', null, token);
  assert('GET /events/1 → 200', detail.status === 200, detail.status);
  const ev1 = detail.body?.data?.event;
  assert('event name correct', ev1?.name === 'Anubhav 2026', ev1?.name);
  assert('venues array present', Array.isArray(ev1?.venues), typeof ev1?.venues);
  assert('3 venues in detail', ev1?.venues?.length === 3, ev1?.venues?.length);
  const phagwaraVenue = ev1?.venues?.find(v => v.venue_key === 'phagwara');
  assert('phagwara venue present', !!phagwaraVenue, JSON.stringify(ev1?.venues?.map(v => v.venue_key)));

  // ── 5. POST /events — create a test event ──────────────────────────────
  console.log('\n[5] Create new event');
  const createRes = await reqJson('POST', '/events', {
    name: 'Smoke Test Event 2026',
    scope: 'diocese',
    description: 'Created by smoke test',
    fee_enabled: false,
    fee_amount: 0,
    accommodation_enabled: false,
    status: 'draft',
  }, token);
  assert('POST /events → 201', createRes.status === 201, JSON.stringify(createRes.body).slice(0, 200));
  const newEventId = createRes.body?.data?.event?.id;
  assert('new event has id', !!newEventId, JSON.stringify(createRes.body?.data));
  assert('new event status=draft', createRes.body?.data?.event?.status === 'draft');
  assert('new event name correct', createRes.body?.data?.event?.name === 'Smoke Test Event 2026');

  // ── 6. Validation: create without name → 400 ──────────────────────────
  console.log('\n[6] Validation');
  const badCreate = await reqJson('POST', '/events', { description: 'missing name' }, token);
  assert('create without name → 400', badCreate.status === 400, badCreate.status);

  // ── 7. POST /events/:id/venues — add a venue to new event ─────────────
  console.log('\n[7] Add venue');
  const addVenue = await reqJson('POST', `/events/${newEventId}/venues`, {
    venue_key: 'test-venue',
    name: 'Test Hall',
    address: '1 Church Road',
    deaneries: ['Hoshiarpur', 'Tanda'],
  }, token);
  assert('POST /events/:id/venues → 201', addVenue.status === 201, JSON.stringify(addVenue.body).slice(0, 200));
  const venueId = addVenue.body?.data?.venue?.id;
  assert('venue has id', !!venueId, addVenue.body?.data);
  assert('venue_key correct', addVenue.body?.data?.venue?.venue_key === 'test-venue');

  // ── 8. Duplicate venue_key rejected ────────────────────────────────────
  console.log('\n[8] Duplicate venue_key');
  const dupVenue = await reqJson('POST', `/events/${newEventId}/venues`, { venue_key: 'test-venue' }, token);
  assert('duplicate venue_key → 409', dupVenue.status === 409, dupVenue.status);

  // ── 9. GET /events/:id/venues ──────────────────────────────────────────
  console.log('\n[9] List venues');
  const venuesRes = await reqJson('GET', `/events/${newEventId}/venues`, null, token);
  assert('GET /events/:id/venues → 200', venuesRes.status === 200, venuesRes.status);
  assert('1 venue returned', venuesRes.body?.data?.count === 1, venuesRes.body?.data?.count);

  // ── 10. PUT /events/:id/venues/:venueId ──────────────────────────────
  console.log('\n[10] Update venue');
  const updateVenue = await reqJson('PUT', `/events/${newEventId}/venues/${venueId}`, {
    name: 'Updated Hall',
    deaneries: ['Hoshiarpur', 'Tanda', 'Kapurthala'],
  }, token);
  assert('PUT venue → 200', updateVenue.status === 200, updateVenue.status);
  assert('venue name updated', updateVenue.body?.data?.venue?.name === 'Updated Hall');

  // ── 11. GET /events/:id/stats ─────────────────────────────────────────
  console.log('\n[11] Stats for Anubhav 2026');
  const stats = await reqJson('GET', '/events/1/stats', null, token);
  assert('GET /events/1/stats → 200', stats.status === 200, stats.status);
  assert('stats has by_venue', Array.isArray(stats.body?.data?.by_venue), typeof stats.body?.data?.by_venue);
  assert('stats has total_registrations', stats.body?.data?.total_registrations !== undefined);

  // ── 12. PUT /events/:id — update status ───────────────────────────────
  console.log('\n[12] Update event status');
  const updateRes = await reqJson('PUT', `/events/${newEventId}`, { status: 'open' }, token);
  assert('PUT /events/:id → 200', updateRes.status === 200, updateRes.status);
  assert('status updated to open', updateRes.body?.data?.event?.status === 'open');

  // ── 13. Unknown event → 404 ───────────────────────────────────────────
  console.log('\n[13] Diocese isolation');
  const notFound = await reqJson('GET', '/events/999999', null, token);
  assert('unknown event → 404', notFound.status === 404, notFound.status);

  // ── 14. DELETE /events/:id — archives ─────────────────────────────────
  console.log('\n[14] Archive event');
  const delRes = await reqJson('DELETE', `/events/${newEventId}`, null, token);
  assert('DELETE /events/:id → 200', delRes.status === 200, delRes.status);

  const archivedCheck = await reqJson('GET', `/events/${newEventId}`, null, token);
  assert('archived event still retrievable', archivedCheck.status === 200, archivedCheck.status);
  assert('status=archived', archivedCheck.body?.data?.event?.status === 'archived');

  // ── 15. anubhavRole DB fallback — PLACES served from event_venues ─────
  console.log('\n[15] anubhavRole venue DB fallback');
  const placeRes = await reqJson('GET', '/anubhav/me/role', null, token);
  assert('anubhav /me/role still works → 200', placeRes.status === 200, placeRes.status);

  // ── 16. DELETE /events/:id/venues/:venueId ────────────────────────────
  console.log('\n[16] Delete venue');
  const delVenue = await reqJson('DELETE', `/events/${newEventId}/venues/${venueId}`, null, token);
  assert('DELETE venue → 200', delVenue.status === 200, delVenue.status);

  // ── Cleanup ────────────────────────────────────────────────────────────
  console.log('\n[Cleanup]');
  try {
    await query('DELETE FROM event_venues WHERE event_id = ?', [newEventId]);
    await query('DELETE FROM events WHERE id = ?', [newEventId]);
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
