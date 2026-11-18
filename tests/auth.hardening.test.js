// The security hotfix (also on main): admin-only registration, deactivated users, login rate limit,
// JSON errors.
const bcrypt = require('bcryptjs');
const h = require('./helpers');

beforeAll(() => h.resetDatabase());
afterAll(() => h.closeDatabase());

test('anonymous users cannot register accounts (and so cannot make themselves admin)', async () => {
    const res = await h.api(null).post('/auth/register', { username: 'evil', email: 'evil@x.com', password: 'Passw0rd', role: 'admin' });
    expect(res.status).toBe(401);
    const row = await h.queryOne("SELECT COUNT(*) AS c FROM users WHERE username = 'evil'");
    expect(row.c).toBe(0);
});

test('only admins can register users, and no token is returned for the new account', async () => {
    const admin = await h.createUser({ role: 'admin' });
    const user = await h.createUser();
    expect((await h.api(user).post('/auth/register', { username: 'member2', email: 'm2@x.com', password: 'Passw0rd' })).status).toBe(403);
    const ok = await h.api(admin).post('/auth/register', { username: 'member1', email: 'm1@x.com', password: 'Passw0rd', role: 'user' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.token).toBeUndefined();
});

test('a deactivated user cannot use an existing token', async () => {
    const user = await h.createUser();
    expect((await h.api(user).get('/auth/profile')).status).toBe(200);
    await h.query('UPDATE users SET status = 0 WHERE id = ?', [user.id]);
    expect((await h.api(user).get('/auth/profile')).status).toBe(401);
});

test('repeated failed logins for one username are rate limited without blocking others', async () => {
    const good = await h.createUser();
    await h.query('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash('Correct123', 4), good.id]);
    const codes = [];
    for (let i = 0; i < 11; i += 1) {
        codes.push((await h.api(null).post('/auth/login', { username: 'admin', password: 'wrong' })).status);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
    expect((await h.api(null).post('/auth/login', { username: good.username, password: 'Correct123' })).status).toBe(200);
});

test('malformed JSON returns a JSON 400 without a stack trace', async () => {
    const res = await require('supertest')(h.getApp())
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"username": "x", bad');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: 'Malformed JSON in request body' });
});
