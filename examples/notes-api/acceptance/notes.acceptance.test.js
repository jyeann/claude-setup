'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const SERVER = path.join(__dirname, '..', 'src', 'server.js');
const PASSWORD = 'correct horse battery';

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
  srv.on('error', reject);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notes-')), 'nested', 'notes.json');

async function startServer({ dataFile = tmpFile(), env = {} } = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(port), DATA_FILE: dataFile, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not print "listening on" within 5s')), 5000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes(`listening on ${port}`)) { clearTimeout(timer); resolve(); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited early (${code})`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, url, { token, body, raw, headers = {} } = {}) => {
    const h = { ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    if (body !== undefined || raw !== undefined) h['content-type'] = 'application/json';
    const res = await fetch(base + url, { method, headers: h, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  const stop = () => new Promise((resolve) => { child.once('exit', (code, signal) => resolve({ code, signal })); child.kill('SIGTERM'); });
  return { call, stop, dataFile };
}

async function withServer(opts, fn) {
  const s = await startServer(opts);
  try { return await fn(s); } finally { await s.stop(); }
}

async function signup(s, username = 'alice', password = PASSWORD) {
  const reg = await s.call('POST', '/register', { body: { username, password } });
  assert.equal(reg.status, 201, `register ${username}: ${reg.text}`);
  const login = await s.call('POST', '/login', { body: { username, password } });
  assert.equal(login.status, 200, `login ${username}: ${login.text}`);
  return login.body.token;
}
const mk = async (s, token, title, extra = {}) => {
  const r = await s.call('POST', '/notes', { token, body: { title, ...extra } });
  assert.equal(r.status, 201, `create ${title}: ${r.text}`);
  return r.body;
};

test('GET /health is public and returns ok', async () => {
  await withServer({}, async (s) => {
    const r = await s.call('GET', '/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: 'ok' });
  });
});

test('register validates input, rejects duplicates, and never echoes or stores the password', async () => {
  const file = tmpFile();
  await withServer({ dataFile: file }, async (s) => {
    const ok = await s.call('POST', '/register', { body: { username: 'alice_1', password: PASSWORD } });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.username, 'alice_1');
    assert.equal(typeof ok.body.id, 'string');
    assert.ok(!('password' in ok.body) && !JSON.stringify(ok.body).includes(PASSWORD));
    for (const body of [
      {}, { username: 'ab', password: PASSWORD }, { username: 'Alice', password: PASSWORD }, { username: 'a b c', password: PASSWORD },
      { username: 'x'.repeat(21), password: PASSWORD }, { username: 'bob', password: 'short' }, { username: 'bob', password: 'p'.repeat(73) },
      { username: 'bob', password: 12345678 }, { username: 7, password: PASSWORD },
    ]) {
      const r = await s.call('POST', '/register', { body });
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60));
      assert.equal(typeof r.body.error, 'string');
    }
    const dup = await s.call('POST', '/register', { body: { username: 'alice_1', password: 'another password' } });
    assert.equal(dup.status, 409);
    const edge = await s.call('POST', '/register', { body: { username: 'bob', password: 'p'.repeat(72) } });
    assert.equal(edge.status, 201);
    const stored = fs.readFileSync(file, 'utf8');
    assert.ok(stored.includes('alice_1'), 'user must be persisted');
    assert.ok(!stored.includes(PASSWORD), 'plaintext password must never reach the data file');
  });
});

test('login returns a long unique token and expiry, and hides which half of the credentials was wrong', async () => {
  await withServer({}, async (s) => {
    await s.call('POST', '/register', { body: { username: 'alice', password: PASSWORD } });
    const a = await s.call('POST', '/login', { body: { username: 'alice', password: PASSWORD } });
    const b = await s.call('POST', '/login', { body: { username: 'alice', password: PASSWORD } });
    assert.equal(a.status, 200);
    assert.ok(typeof a.body.token === 'string' && a.body.token.length >= 32);
    assert.notEqual(a.body.token, b.body.token);
    assert.equal(new Date(a.body.expiresAt).toISOString(), a.body.expiresAt);
    assert.ok(new Date(a.body.expiresAt) > new Date());
    const wrong = await s.call('POST', '/login', { body: { username: 'alice', password: 'not the password' } });
    const unknown = await s.call('POST', '/login', { body: { username: 'nobody', password: PASSWORD } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error, unknown.body.error);
    assert.equal((await s.call('POST', '/login', { body: {} })).status, 400);
  });
});

test('authenticated routes reject missing, malformed and unknown tokens', async () => {
  await withServer({}, async (s) => {
    await signup(s);
    const routes = [['GET', '/notes'], ['POST', '/notes'], ['GET', '/notes/abc'], ['PATCH', '/notes/abc'], ['DELETE', '/notes/abc'], ['GET', '/tags'], ['POST', '/logout']];
    for (const [method, url] of routes) {
      const body = method === 'POST' || method === 'PATCH' ? { title: 'x' } : undefined;
      assert.equal((await s.call(method, url, { body })).status, 401, `${method} ${url} without token`);
      assert.equal((await s.call(method, url, { body, token: 'nope-nope-nope' })).status, 401, `${method} ${url} bad token`);
      assert.equal((await s.call(method, url, { body, headers: { authorization: 'Basic abc' } })).status, 401, `${method} ${url} wrong scheme`);
    }
  });
});

test('logout invalidates the token but not other sessions', async () => {
  await withServer({}, async (s) => {
    const t1 = await signup(s);
    const t2 = (await s.call('POST', '/login', { body: { username: 'alice', password: PASSWORD } })).body.token;
    const out = await s.call('POST', '/logout', { token: t1 });
    assert.equal(out.status, 204);
    assert.equal((await s.call('GET', '/notes', { token: t1 })).status, 401);
    assert.equal((await s.call('GET', '/notes', { token: t2 })).status, 200);
  });
});

test('tokens expire after TOKEN_TTL_MS', async () => {
  await withServer({ env: { TOKEN_TTL_MS: '300' } }, async (s) => {
    const token = await signup(s);
    assert.equal((await s.call('GET', '/notes', { token })).status, 200);
    await sleep(500);
    assert.equal((await s.call('GET', '/notes', { token })).status, 401);
  });
});

test('login is rate limited per username with Retry-After, and recovers after the window', async () => {
  await withServer({ env: { LOGIN_MAX_FAILURES: '3', LOGIN_WINDOW_MS: '700' } }, async (s) => {
    await s.call('POST', '/register', { body: { username: 'alice', password: PASSWORD } });
    await s.call('POST', '/register', { body: { username: 'bob', password: PASSWORD } });
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await s.call('POST', '/login', { body: { username: 'alice', password: 'wrong password' } })).status, 401);
    }
    const blocked = await s.call('POST', '/login', { body: { username: 'alice', password: PASSWORD } });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
    assert.equal(typeof blocked.body.error, 'string');
    assert.equal((await s.call('POST', '/login', { body: { username: 'bob', password: PASSWORD } })).status, 200, 'other users are unaffected');
    await sleep(900);
    assert.equal((await s.call('POST', '/login', { body: { username: 'alice', password: PASSWORD } })).status, 200);
  });
});

test('POST /notes validates title, body and tags, and returns the full shape', async () => {
  await withServer({}, async (s) => {
    const token = await signup(s);
    const n = await s.call('POST', '/notes', { token, body: { title: '  Groceries  ', body: 'milk', tags: ['home', 'to-do'] } });
    assert.equal(n.status, 201);
    assert.equal(n.body.title, 'Groceries');
    assert.equal(n.body.body, 'milk');
    assert.deepEqual(n.body.tags, ['home', 'to-do']);
    assert.equal(typeof n.body.id, 'string');
    assert.equal(new Date(n.body.createdAt).toISOString(), n.body.createdAt);
    assert.equal(new Date(n.body.updatedAt).toISOString(), n.body.updatedAt);
    const minimal = await s.call('POST', '/notes', { token, body: { title: 'x' } });
    assert.equal(minimal.status, 201);
    assert.equal(minimal.body.body, '');
    assert.deepEqual(minimal.body.tags, []);
    for (const body of [
      {}, { title: '' }, { title: '   ' }, { title: 5 }, { title: 'x'.repeat(101) }, { title: 'ok', body: 7 }, { title: 'ok', body: 'b'.repeat(10001) },
      { title: 'ok', tags: 'home' }, { title: 'ok', tags: ['Home'] }, { title: 'ok', tags: ['a b'] }, { title: 'ok', tags: [''] },
      { title: 'ok', tags: ['t'.repeat(31)] }, { title: 'ok', tags: ['dup', 'dup'] }, { title: 'ok', tags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
    ]) {
      const r = await s.call('POST', '/notes', { token, body });
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 70));
      assert.equal(typeof r.body.error, 'string');
    }
    const edge = await s.call('POST', '/notes', { token, body: { title: 'x'.repeat(100), body: 'b'.repeat(10000), tags: Array.from({ length: 10 }, (_, i) => `t${i}`) } });
    assert.equal(edge.status, 201);
  });
});

test('notes are private: other users get 404 for read, update and delete, and see none in lists or tags', async () => {
  await withServer({}, async (s) => {
    const alice = await signup(s, 'alice');
    const bob = await signup(s, 'bobby');
    const secret = await mk(s, alice, 'alice secret', { tags: ['private'] });
    assert.equal((await s.call('GET', `/notes/${secret.id}`, { token: bob })).status, 404);
    assert.equal((await s.call('PATCH', `/notes/${secret.id}`, { token: bob, body: { title: 'hacked' } })).status, 404);
    assert.equal((await s.call('DELETE', `/notes/${secret.id}`, { token: bob })).status, 404);
    assert.deepEqual((await s.call('GET', '/notes', { token: bob })).body.items, []);
    assert.deepEqual((await s.call('GET', '/tags', { token: bob })).body, []);
    const still = await s.call('GET', `/notes/${secret.id}`, { token: alice });
    assert.equal(still.status, 200);
    assert.equal(still.body.title, 'alice secret');
  });
});

test('GET /notes/:id returns the note, or 404 for an unknown id', async () => {
  await withServer({}, async (s) => {
    const token = await signup(s);
    const n = await mk(s, token, 'one', { body: 'text', tags: ['a'] });
    const got = await s.call('GET', `/notes/${n.id}`, { token });
    assert.equal(got.status, 200);
    assert.deepEqual(got.body, n);
    const missing = await s.call('GET', '/notes/does-not-exist', { token });
    assert.equal(missing.status, 404);
    assert.equal(typeof missing.body.error, 'string');
  });
});

test('PATCH updates only given fields, keeps id and createdAt, moves updatedAt, and validates', async () => {
  await withServer({}, async (s) => {
    const token = await signup(s);
    const n = await mk(s, token, 'old', { body: 'keep', tags: ['x'] });
    await sleep(15);
    const r = await s.call('PATCH', `/notes/${n.id}`, { token, body: { title: ' new ', tags: ['y', 'z'] } });
    assert.equal(r.status, 200);
    assert.equal(r.body.title, 'new');
    assert.equal(r.body.body, 'keep');
    assert.deepEqual(r.body.tags, ['y', 'z']);
    assert.equal(r.body.id, n.id);
    assert.equal(r.body.createdAt, n.createdAt);
    assert.ok(new Date(r.body.updatedAt) > new Date(n.updatedAt), 'updatedAt must move forward');
    for (const body of [{}, { title: '' }, { title: 3 }, { body: 4 }, { tags: ['BAD'] }, { tags: ['d', 'd'] }]) {
      assert.equal((await s.call('PATCH', `/notes/${n.id}`, { token, body })).status, 400, JSON.stringify(body));
    }
    assert.equal((await s.call('PATCH', '/notes/nope', { token, body: { title: 'x' } })).status, 404);
    assert.equal((await s.call('GET', `/notes/${n.id}`, { token })).body.title, 'new');
  });
});

test('DELETE returns 204 with no body, then 404', async () => {
  await withServer({}, async (s) => {
    const token = await signup(s);
    const n = await mk(s, token, 'gone');
    const del = await s.call('DELETE', `/notes/${n.id}`, { token });
    assert.equal(del.status, 204);
    assert.equal(del.text, '');
    assert.equal((await s.call('DELETE', `/notes/${n.id}`, { token })).status, 404);
    assert.equal((await s.call('GET', `/notes/${n.id}`, { token })).status, 404);
    assert.deepEqual((await s.call('GET', '/notes', { token })).body.items, []);
  });
});

test('list is newest first and cursor pagination returns every note exactly once', async () => {
  await withServer({}, async (s) => {
    const token = await signup(s);
    for (let i = 1; i <= 7; i += 1) await mk(s, token, `note ${i}`);
    const all = await s.call('GET', '/notes', { token });
    assert.deepEqual(all.body.items.map((n) => n.title), ['note 7', 'note 6', 'note 5', 'note 4', 'note 3', 'note 2', 'note 1']);
    assert.equal(all.body.nextCursor, null);
    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const url = `/notes?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await s.call('GET', url, { token });
      assert.equal(page.status, 200);
      assert.ok(page.body.items.length <= 3);
      seen.push(...page.body.items.map((n) => n.title));
      cursor = page.body.nextCursor;
      pages += 1;
      assert.ok(pages <= 5, 'pagination must terminate');
    } while (cursor);
    assert.equal(pages, 3);
    assert.deepEqual(seen, all.body.items.map((n) => n.title));
    assert.equal((await s.call('GET', '/notes?limit=7', { token })).body.nextCursor, null);
  });
});

test('list validates limit and cursor', async () => {
  await withServer({}, async (s) => {
    const token = await signup(s);
    await mk(s, token, 'a');
    for (const q of ['limit=0', 'limit=101', 'limit=abc', 'limit=1.5', 'limit=-1', 'cursor=@@@not-a-cursor@@@']) {
      const r = await s.call('GET', `/notes?${q}`, { token });
      assert.equal(r.status, 400, q);
      assert.equal(typeof r.body.error, 'string');
    }
    assert.equal((await s.call('GET', '/notes?limit=100', { token })).status, 200);
    assert.equal((await s.call('GET', '/notes?limit=1', { token })).status, 200);
  });
});

test('filters: tag is exact, q is case-insensitive over title and body, and they combine', async () => {
  await withServer({}, async (s) => {
    const token = await signup(s);
    await mk(s, token, 'Buy MILK', { tags: ['home'] });
    await mk(s, token, 'Plan trip', { body: 'book flights and milk run', tags: ['travel', 'home'] });
    await mk(s, token, 'Taxes', { tags: ['money'] });
    await mk(s, token, 'Homework', { tags: ['homework'] });
    const titles = async (qs) => (await s.call('GET', `/notes?${qs}`, { token })).body.items.map((n) => n.title).sort();
    assert.deepEqual(await titles('tag=home'), ['Buy MILK', 'Plan trip']);
    assert.deepEqual(await titles('tag=hom'), []);
    assert.deepEqual(await titles('q=milk'), ['Buy MILK', 'Plan trip']);
    assert.deepEqual(await titles('q=PLAN'), ['Plan trip']);
    assert.deepEqual(await titles('q=flights'), ['Plan trip']);
    assert.deepEqual(await titles('tag=home&q=trip'), ['Plan trip']);
    assert.deepEqual(await titles('tag=money&q=milk'), []);
    assert.deepEqual(await titles('q=zzz'), []);
    const paged = await s.call('GET', '/notes?q=milk&limit=1', { token });
    assert.equal(paged.body.items.length, 1);
    assert.equal(typeof paged.body.nextCursor, 'string');
    const next = await s.call('GET', `/notes?q=milk&limit=1&cursor=${encodeURIComponent(paged.body.nextCursor)}`, { token });
    assert.equal(next.body.items.length, 1);
    assert.equal(next.body.nextCursor, null);
  });
});

test('GET /tags counts the caller tags sorted by count then name', async () => {
  await withServer({}, async (s) => {
    const token = await signup(s);
    await mk(s, token, '1', { tags: ['b', 'a'] });
    await mk(s, token, '2', { tags: ['b', 'c'] });
    await mk(s, token, '3', { tags: ['b'] });
    await mk(s, token, '4', { tags: ['c'] });
    const r = await s.call('GET', '/tags', { token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, [{ tag: 'b', count: 3 }, { tag: 'c', count: 2 }, { tag: 'a', count: 1 }]);
    const first = (await s.call('GET', '/notes', { token })).body.items.find((n) => n.title === '3');
    await s.call('DELETE', `/notes/${first.id}`, { token });
    assert.deepEqual((await s.call('GET', '/tags', { token })).body[0], { tag: 'b', count: 2 });
  });
});

test('oversized bodies get 413 and malformed JSON gets 400, without crashing the server', async () => {
  await withServer({}, async (s) => {
    const token = await signup(s);
    const big = await s.call('POST', '/notes', { token, raw: JSON.stringify({ title: 'x', body: 'z'.repeat(150000) }) });
    assert.equal(big.status, 413);
    const bad = await s.call('POST', '/notes', { token, raw: '{not json' });
    assert.equal(bad.status, 400);
    assert.equal((await s.call('GET', '/health')).status, 200);
  });
});

test('unknown routes are 404 and wrong methods on known paths are 405', async () => {
  await withServer({}, async (s) => {
    const token = await signup(s);
    assert.equal((await s.call('GET', '/nothing', { token })).status, 404);
    assert.equal((await s.call('PUT', '/notes', { token, body: { title: 'x' } })).status, 405);
    assert.equal((await s.call('POST', '/health', { body: {} })).status, 405);
    assert.equal((await s.call('PUT', '/tags', { token, body: {} })).status, 405);
    assert.equal((await s.call('GET', '/register')).status, 405);
  });
});

test('users and notes survive a restart, and passwords still verify afterwards', async () => {
  const file = tmpFile();
  let noteId;
  const first = await startServer({ dataFile: file });
  try {
    const token = await signup(first, 'alice');
    noteId = (await mk(first, token, 'persisted', { body: 'hello', tags: ['keep'] })).id;
  } finally { await first.stop(); }
  const second = await startServer({ dataFile: file });
  try {
    const login = await second.call('POST', '/login', { body: { username: 'alice', password: PASSWORD } });
    assert.equal(login.status, 200, 'password must verify against the persisted hash');
    const note = await second.call('GET', `/notes/${noteId}`, { token: login.body.token });
    assert.equal(note.status, 200);
    assert.equal(note.body.title, 'persisted');
    assert.deepEqual(note.body.tags, ['keep']);
    assert.equal((await second.call('POST', '/register', { body: { username: 'alice', password: 'whatever long' } })).status, 409);
    assert.equal((await second.call('POST', '/login', { body: { username: 'alice', password: 'wrong password' } })).status, 401);
    const another = await mk(second, login.body.token, 'second run');
    assert.notEqual(another.id, noteId, 'ids stay unique after a restart');
  } finally { await second.stop(); }
});

test('the server exits with code 0 on SIGTERM (so its coverage can be collected)', async () => {
  const s = await startServer();
  const { code, signal } = await s.stop();
  assert.equal(signal, null, 'must handle SIGTERM instead of being killed by it');
  assert.equal(code, 0);
});
