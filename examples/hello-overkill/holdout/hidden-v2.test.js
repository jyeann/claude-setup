'use strict';
// Holdout v2 tests: rules from the v2 spec a builder could miss. Black-box over HTTP, self-contained.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hello-holdout2-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(port, method, target, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = { ...headers };
    if (payload !== undefined) { h['content-length'] = Buffer.byteLength(payload); if (!h['content-type']) h['content-type'] = 'application/json'; }
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json; try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function startServer(env = {}, file = path.join(tmpDir(), 'hello.json')) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, PORT: '0', DATA_FILE: file, HELLO_SIGNING_SECRET: 'test', HELLO_RATE_LIMIT: '100000', HELLO_READ_LIMIT: '100000', HELLO_FED_LIMIT: '100000', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = ''; let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start; stderr: ' + err)), 5000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = /listening on (\d+)/.exec(out);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error('server exited early ' + code + ': ' + err)); });
  });
  const exited = new Promise((r) => child.once('exit', r));
  return {
    port, file, stderr: () => err,
    call: (method, target, body, headers) => request(port, method, target, body, headers),
    hello: (body) => request(port, 'POST', '/hello', body),
    stop: async () => { if (child.exitCode === null) { child.kill('SIGTERM'); const t = setTimeout(() => child.kill('SIGKILL'), 3000); await exited; clearTimeout(t); } },
  };
}
const withServer = async (fn, env, file) => { const s = await startServer(env, file); try { await fn(s); } finally { await s.stop(); } };

// Stub peer: handler(req, res, bodyText). Returns { origin, hits(), close() }.
async function stubPeer(handler) {
  let hits = 0;
  const sockets = new Set();
  const srv = http.createServer((req, res) => {
    hits++;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => handler(req, res, Buffer.concat(chunks).toString('utf8')));
  });
  srv.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  return { port, origin: 'http://127.0.0.1:' + port, hits: () => hits, close: () => new Promise((r) => { for (const s of sockets) s.destroy(); srv.close(r); }) };
}
const sendJson = (res, obj, status = 200, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
const goodPeer = (greeting = 'Hola, Ada!') => stubPeer((req, res) => {
  if (req.url === '/healthz') return sendJson(res, { ok: true });
  return sendJson(res, { greeting, visit: 2, streak: 1 });
});
const withPeers = async (peers, fn, env = {}) => {
  try {
    await withServer((s) => fn(s), { HELLO_PEERS: peers.map((p) => (typeof p === 'string' ? p : p.origin)).join(','), HELLO_PEERS_ALLOW_PRIVATE: '1', ...env });
  } finally { await Promise.all(peers.filter((p) => typeof p !== 'string').map((p) => p.close())); }
};

// SSE helper: raw GET, collects parsed events until closed.
function openStream(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: '/api/stream', headers, agent: false }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { raw += d; });
      res.on('error', () => {});
      const api = {
        status: res.statusCode, headers: res.headers, raw: () => raw,
        events: () => raw.split('\n\n').map((b) => {
          const ev = {};
          for (const line of b.split('\n')) {
            const m = /^(id|event|data): ?(.*)$/.exec(line);
            if (m) ev[m[1]] = m[2];
          }
          return ev;
        }).filter((e) => e.event === 'hello'),
        close: () => { req.destroy(); },
      };
      resolve(api);
    });
    req.on('error', reject);
    req.end();
  });
}

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test('federation never follows redirects: a 302 peer is error redirect and the target is never contacted', async () => {
  const target = await goodPeer();
  const redirector = await stubPeer((req, res) => { res.writeHead(302, { location: target.origin + req.url }); res.end(); });
  const good = await goodPeer();
  await withPeers([redirector, good, target].slice(0, 2), async (s) => {
    const h = await s.call('GET', '/api/federation/hello?name=Ada');
    assert.equal(h.status, 200);
    assert.equal(h.json.results[0].ok, false);
    assert.equal(h.json.results[0].error, 'redirect');
    assert.equal(h.json.results[1].ok, true);
    const hz = await s.call('GET', '/api/federation');
    assert.equal(hz.json.peers[0].error, 'redirect');
    assert.equal(hz.json.peers[1].ok, true);
    assert.equal(target.hits(), 0);
  });
  await target.close();
});

test('federation caps peer bodies at 64 KB: a 70 KB valid-looking reply is too_large and does not fail other peers', () => {
  return (async () => {
    const big = await stubPeer((req, res) => sendJson(res, { greeting: 'x'.repeat(70000), ok: true }));
    const good = await goodPeer();
    await withPeers([big, good], async (s) => {
      const h = await s.call('GET', '/api/federation/hello?name=Ada');
      assert.equal(h.status, 200);
      assert.equal(h.json.results[0].error, 'too_large');
      assert.equal(h.json.results[1].ok, true);
      assert.equal(h.json.results[1].greeting, 'Hola, Ada!');
      assert.deepEqual(h.json.summary, { total: 2, ok: 1, failed: 1 });
      assert.ok(h.text.length < 5000, 'peer body must never be relayed');
    });
  })();
});

test('federation maps non-JSON, wrong-shape, bad-status peers to distinct error codes, per peer, in HELLO_PEERS order', async () => {
  const html = await stubPeer((req, res) => sendJson(res, '<html>hi</html>', 200, 'text/html'));
  const badJson = await stubPeer((req, res) => sendJson(res, '{not json', 200));
  const core = await stubPeer((req, res) => sendJson(res, { message: 'Hello World! Welcome to the API.' }));
  const arr = await stubPeer((req, res) => sendJson(res, '[1,2]', 200));
  const s500 = await stubPeer((req, res) => sendJson(res, { greeting: 'x' }, 500));
  const good = await goodPeer();
  const peers = [html, badJson, core, arr, s500, good];
  await withPeers(peers, async (s) => {
    const h = await s.call('GET', '/api/federation/hello?name=Ada');
    assert.equal(h.status, 200);
    assert.deepEqual(h.json.results.map((r) => r.origin), peers.map((p) => p.origin));
    assert.deepEqual(h.json.results.map((r) => r.error || null), ['bad_content_type', 'bad_json', 'bad_shape', 'bad_shape', 'bad_status', null]);
    assert.deepEqual(h.json.summary, { total: 6, ok: 1, failed: 5 });
    assert.doesNotMatch(h.text, /<html>|not json|stack/i);
  });
});

test('HELLO_PEERS entries with credentials, paths, queries or non-http schemes are dropped and never contacted', async () => {
  const withPath = await stubPeer((req, res) => sendJson(res, { ok: true, greeting: 'x' }));
  const withCreds = await stubPeer((req, res) => sendJson(res, { ok: true, greeting: 'x' }));
  const good = await goodPeer();
  const port = (p) => p.port;
  const entries = [
    'http://user:secret@127.0.0.1:' + port(withCreds),
    withPath.origin + '/evil/path',
    withPath.origin + '/?q=1',
    'ftp://127.0.0.1:21',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
    good.origin,
  ];
  try {
    await withServer(async (s) => {
      const f = await s.call('GET', '/api/federation');
      assert.equal(f.status, 200);
      assert.deepEqual(f.json.peers.map((p) => p.origin), [good.origin]);
      assert.equal(f.json.summary.total, 1);
      const h = await s.call('GET', '/api/federation/hello?name=Ada');
      assert.deepEqual(h.json.results.map((r) => r.origin), [good.origin]);
      assert.doesNotMatch(f.text + h.text, /secret|passwd|evil/);
      assert.equal(withPath.hits(), 0);
      assert.equal(withCreds.hits(), 0);
    }, { HELLO_PEERS: entries.join(','), HELLO_PEERS_ALLOW_PRIVATE: '1' });
  } finally { await Promise.all([withPath.close(), withCreds.close(), good.close()]); }
});

test('a peer greeting containing <script> is relayed only as a plain JSON string, with extra keys and control chars removed', async () => {
  const evil = '<script>alert(1)</script>';
  const peer = await stubPeer((req, res) => sendJson(res, { greeting: evil + '\u0000\u202e!', visit: 3, streak: 2, certificate: { text: 'x' }, polluted: true, __proto__x: 1 }));
  await withPeers([peer], async (s) => {
    const h = await s.call('GET', '/api/federation/hello?name=Ada');
    assert.match(h.headers['content-type'], /^application\/json/);
    const r = h.json.results[0];
    assert.equal(r.ok, true);
    assert.equal(typeof r.greeting, 'string');
    assert.equal(r.greeting, evil + '!');
    assert.equal(r.visit, 3);
    assert.equal(r.streak, 2);
    assert.equal(r.certificate, undefined);
    assert.equal(r.polluted, undefined);
    assert.deepEqual(Object.keys(r).sort(), ['greeting', 'latencyMs', 'ok', 'origin', 'streak', 'visit']);
  });
});

test('federation hello validates the name locally (400) and never contacts peers when invalid', async () => {
  const peer = await goodPeer();
  await withPeers([peer], async (s) => {
    for (const q of ['', '?name=', '?name=%00x', '?name=' + 'x'.repeat(41), '?name=Ada&language=xx', '?name=Ada&tone=nope']) {
      const r = await s.call('GET', '/api/federation/hello' + q);
      assert.equal(r.status, 400, q);
      assert.equal(typeof r.json.error, 'string', q);
    }
    assert.equal(peer.hits(), 0);
    const none = await s.call('GET', '/api/federation/hello?name=Ada&url=http://127.0.0.1:1/');
    assert.equal(none.status, 200);
    assert.equal(none.json.results.length, 1);
  });
});

test('stream events never leak the name, even for __proto__, and carry exactly the anonymised fields', () => withServer(async (s) => {
  const st = await openStream(s.port);
  assert.equal(st.status, 200);
  assert.match(st.headers['content-type'], /^text\/event-stream/);
  assert.equal(st.headers['content-length'], undefined);
  const names = ['__proto__', 'constructor', 'Zaphod', 'ToString'];
  for (const name of names) assert.equal((await s.hello({ name, language: 'es', tone: 'pirate' })).status, 200);
  await s.hello('');
  await sleep(300);
  const raw = st.raw();
  st.close();
  assert.match(raw, /^retry: 3000\n\n: connected\n\n/);
  for (const name of names) assert.ok(!raw.toLowerCase().includes(name.toLowerCase()), 'leaked ' + name);
  const evs = st.events();
  assert.equal(evs.length, 5);
  for (const e of evs.slice(0, 4)) {
    const d = JSON.parse(e.data);
    assert.deepEqual(Object.keys(d).sort(), ['id', 'language', 'milestone', 'tone', 'ts']);
    assert.equal(d.language, 'es'); assert.equal(d.tone, 'pirate');
    assert.equal(String(d.id), e.id);
    assert.equal(d.milestone, 'first-visit');
    assert.match(d.ts, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/);
  }
  assert.equal(JSON.parse(evs[4].data).kind, 'core');
  assert.ok(!/certificate|signature|greeting|127\.0\.0\.1/i.test(raw));
}));

test('stream replays at most the last 20 events, honours Last-Event-ID, and ids are monotonic from 1', () => withServer(async (s) => {
  for (let i = 0; i < 25; i++) await s.hello({ name: 'v' + i });
  const all = await openStream(s.port);
  await sleep(300);
  const ids = all.events().map((e) => Number(e.id));
  all.close();
  assert.deepEqual(ids, Array.from({ length: 20 }, (_, i) => i + 6));
  const resumed = await openStream(s.port, { 'last-event-id': '22' });
  await sleep(300);
  assert.deepEqual(resumed.events().map((e) => Number(e.id)), [23, 24, 25]);
  resumed.close();
  const garbage = await openStream(s.port, { 'last-event-id': 'abc' });
  await sleep(300);
  assert.equal(garbage.events().length, 20);
  garbage.close();
  const caughtUp = await openStream(s.port, { 'last-event-id': '25' });
  await sleep(200);
  assert.equal(caughtUp.events().length, 0);
  await s.hello({ name: 'live' });
  await sleep(300);
  assert.deepEqual(caughtUp.events().map((e) => Number(e.id)), [26]);
  caughtUp.close();
}));

test('stream caps concurrent streams per client at 5 with 503, and frees a slot when one closes', () => withServer(async (s) => {
  const open = [];
  for (let i = 0; i < 5; i++) { const st = await openStream(s.port); assert.equal(st.status, 200); open.push(st); }
  const sixth = await s.call('GET', '/api/stream');
  assert.equal(sixth.status, 503);
  assert.match(sixth.headers['content-type'], /^application\/json/);
  assert.equal(typeof sixth.json.error, 'string');
  open[0].close();
  await sleep(300);
  const again = await openStream(s.port);
  assert.equal(again.status, 200);
  again.close();
  for (const st of open) st.close();
}));

test('SLA memory stays bounded: thousands of distinct unknown paths collapse into fixed route labels', () => withServer(async (s) => {
  const jobs = [];
  for (let i = 0; i < 3000; i++) {
    const p = i % 3 === 0 ? '/nope/' + i + '-' + 'z'.repeat(20) : i % 3 === 1 ? '/api/certificates/' + i.toString(16).padStart(16, '0') : '/x' + i + '?q=' + i;
    jobs.push(p);
  }
  for (let i = 0; i < jobs.length; i += 100) await Promise.all(jobs.slice(i, i + 100).map((p) => s.call('GET', p)));
  const r = await s.call('GET', '/api/sla');
  assert.equal(r.status, 200);
  assert.ok(r.json.routes.length <= 25, 'labels: ' + r.json.routes.length);
  assert.ok(r.text.length < 20000, 'response size ' + r.text.length);
  for (const row of r.json.routes) assert.doesNotMatch(row.route, /nope|\/x\d|0000|q=/);
  const other = r.json.routes.find((x) => x.route === 'other');
  assert.ok(other && other.count >= 1000);
  assert.ok(r.json.routes.every((x) => x.count <= 1024), 'per-label ring is at most 1024 samples');
  const cert = r.json.routes.find((x) => x.route === 'GET /api/certificates/:id');
  assert.ok(cert);
}));

test('SLA percentiles are ordered p50<=p95<=p99 and 429/418 count as client errors, not 5xx errors', () => withServer(async (s) => {
  for (let i = 0; i < 6; i++) await s.call('POST', '/hello', '');
  for (let i = 0; i < 3; i++) assert.equal((await s.call('POST', '/hello?chaos=418', '')).status === 418 || true, true);
  for (let i = 0; i < 20; i++) await s.call('GET', '/healthz');
  const r = await s.call('GET', '/api/sla');
  assert.equal(r.status, 200);
  const rows = [...r.json.routes, { route: 'total', ...r.json.total }];
  for (const row of rows) {
    if (row.p50 === null) continue;
    assert.ok(row.p50 <= row.p95 && row.p95 <= row.p99, JSON.stringify(row));
  }
  const hello = r.json.routes.find((x) => x.route === 'POST /hello');
  assert.ok(hello.errors4xx >= 4, JSON.stringify(hello));
  assert.equal(hello.errors5xx, 0);
  assert.equal(hello.errorRate, 0);
  assert.equal(r.json.total.errorRate, 0);
  assert.ok(r.json.total.clientErrorRate > 0);
  assert.equal(r.json.routes.find((x) => x.route === 'POST /hello').count, hello.count);
  assert.equal(r.json.windowSeconds, 300);
  assert.ok(Number.isInteger(r.json.uptimeSeconds) && r.json.uptimeSeconds >= 0);
}, { HELLO_RATE_LIMIT: '3' }));

test('time machine rejects 1899-12-31, future dates, 2023-02-30 and malformed dates with the exact messages', () => withServer(async (s) => {
  const cases = [
    ['', 'date is required'],
    ['?date=', 'date is required'],
    ['?date=1987-5-2', 'date must be YYYY-MM-DD'],
    ['?date=yesterday', 'date must be YYYY-MM-DD'],
    ['?date=2023-02-30', 'date is not a real date'],
    ['?date=2023-13-01', 'date is not a real date'],
    ['?date=1900-02-29', 'date is not a real date'],
    ['?date=1899-12-31', 'date before 1900-01-01'],
    ['?date=0001-01-01', 'date before 1900-01-01'],
    ['?date=' + addDays(2), 'date is in the future'],
    ['?date=2999-01-01', 'date is in the future'],
  ];
  for (const [q, msg] of cases) {
    const r = await s.call('GET', '/api/time-machine' + q);
    assert.equal(r.status, 400, q);
    assert.deepEqual(r.json, { error: msg }, q);
  }
  const first = await s.call('GET', '/api/time-machine?date=1900-01-01');
  assert.equal(first.status, 200);
  assert.equal(first.json.era, 'Edwardian telegram');
  const leap = await s.call('GET', '/api/time-machine?date=2024-02-29');
  assert.equal(leap.status, 200);
  assert.equal(leap.json.era, 'now');
  assert.equal(leap.json.streak, null);
  const leap2000 = await s.call('GET', '/api/time-machine?date=2000-02-29');
  assert.equal(leap2000.status, 200);
}));

test('time machine is read-only: lookups never change the visitor visit count or create visitors', () => withServer(async (s) => {
  assert.equal((await s.hello({ name: 'Ada' })).json.visit, 1);
  for (let i = 0; i < 4; i++) {
    const r = await s.call('GET', '/api/time-machine?date=2024-02-29&name=ada');
    assert.equal(r.status, 200);
    assert.ok(['unknown', 'on-streak', 'before-first-visit', 'inactive-after'].includes(r.json.streak.status), r.text);
    assert.doesNotMatch(r.text, /firstDay|lastDay|visits/);
  }
  const ghost = await s.call('GET', '/api/time-machine?date=2000-01-01&name=Nobody');
  assert.equal(ghost.json.streak.status, 'no-record');
  assert.equal((await s.hello({ name: 'Ada' })).json.visit, 2);
  assert.equal((await s.hello({ name: 'Nobody' })).json.visit, 1);
  const future = await s.call('GET', '/api/time-machine?date=' + today() + '&name=Ada');
  assert.equal(future.json.streak.status, 'on-streak');
  assert.equal(future.json.streak.dayOfStreak, 1);
}));

test('haiku for tricky names either scans 5-7-5 with the name present or is a 422, never a wrong haiku', () => withServer(async (s) => {
  const names = ['Ada', 'Bartholomew', 'Xi', 'Mary-Anne', 'Siobhan', "O'Neil", 'Zoë', '\u65e5\u672c', '---', 'Wolfeschlegelsteinhausenbergerdorff', 'ADA', 'a'];
  let ok = 0;
  for (const name of names) {
    const r = await s.call('POST', '/api/haiku', { name });
    assert.ok(r.status === 200 || r.status === 422, name + ' -> ' + r.status);
    if (r.status === 422) {
      assert.deepEqual(r.json, { error: 'name cannot be scanned into a haiku', hint: 'try the syllables field or a shorter name' }, name);
      continue;
    }
    ok++;
    assert.equal(r.json.haiku.length, 3, name);
    assert.ok(r.json.haiku.every((l) => typeof l === 'string' && l.trim().length > 0), name);
    assert.deepEqual(r.json.syllables, [5, 7, 5], name);
    assert.equal(r.json.verified, true, name);
    assert.ok(r.json.haiku.join('\n').includes(name.trim()), 'name must appear verbatim: ' + name);
    assert.ok(Number.isInteger(r.json.nameSyllables) && r.json.nameSyllables >= 1 && r.json.nameSyllables <= 6, name);
    const again = await s.call('POST', '/api/haiku', { name });
    assert.deepEqual(again.json, r.json, 'deterministic ' + name);
  }
  assert.ok(ok >= 5);
  const ada = (await s.call('POST', '/api/haiku', { name: 'Ada' })).json;
  assert.equal(ada.nameSyllables, 2);
  assert.equal((await s.call('POST', '/api/haiku', { name: 'Xi' })).json.nameSyllables, 1);
  assert.equal((await s.call('POST', '/api/haiku', { name: '\u65e5\u672c' })).status, 422);
  assert.equal((await s.call('POST', '/api/haiku', { name: '!!!' })).status, 422);
  assert.equal((await s.call('POST', '/api/haiku', { name: 'Ada', theme: 'volcano' })).status, 400);
  assert.equal((await s.call('POST', '/api/haiku', { name: 'Ada', syllables: 7 })).status, 400);
  assert.equal((await s.call('POST', '/api/haiku', { name: 'Ada', syllables: 0 })).status, 400);
  assert.equal((await s.call('POST', '/api/haiku', { name: 'Ada', syllables: 2.5 })).status, 400);
  assert.equal((await s.call('POST', '/api/haiku', { name: 'Ada', syllables: 3 })).json.nameSyllables, 3);
  assert.equal((await s.call('POST', '/api/haiku', {})).status, 400);
  assert.equal((await s.call('POST', '/api/haiku', 'x'.repeat(17000))).status, 413);
}));

test('weather is identical across restarts and across casing, padding and inner whitespace of place', async () => {
  const d = today();
  const q = (place) => '/api/weather?date=' + d + '&place=' + encodeURIComponent(place);
  const strip = (j) => { const { place, forecast, greeting, ...rest } = j; return rest; };
  let first;
  const file = path.join(tmpDir(), 'hello.json');
  await withServer(async (s) => {
    first = await s.call('GET', q('New York'));
    assert.equal(first.status, 200);
    assert.equal(first.json.simulated, true);
    assert.equal(first.json.place, 'New York');
    for (const variant of ['  new york  ', 'NEW YORK', 'New    York', '\tnew\n york ']) {
      const r = await s.call('GET', q(variant));
      assert.equal(r.status, 200, JSON.stringify(variant));
      assert.deepEqual(strip(r.json), strip(first.json), JSON.stringify(variant));
    }
    const other = await s.call('GET', q('Lisbon'));
    assert.notEqual(other.json.seed, first.json.seed);
    const j = first.json;
    assert.ok(j.tempC >= -5 && j.tempC <= 35 && j.windKph >= 0 && j.windKph <= 60);
    assert.ok(j.chanceOfWarmRegards >= 0 && j.chanceOfWarmRegards <= 100 && j.warmthIndex >= 1 && j.warmthIndex <= 10);
    assert.ok(j.greeting.endsWith('Today: ' + j.forecast));
  }, {}, file);
  await withServer(async (s) => {
    const again = await s.call('GET', q('New York'));
    assert.deepEqual(again.json, first.json);
  }, {}, file);
});

test('weather validates place and date range: today-1..today+1 only, 1-40 code points, no control chars', () => withServer(async (s) => {
  for (const date of [addDays(-1), today(), addDays(1)]) assert.equal((await s.call('GET', '/api/weather?date=' + date)).status, 200, date);
  for (const date of [addDays(-3), addDays(3), '2023-02-30', '2024-02-29']) {
    const r = await s.call('GET', '/api/weather?date=' + date);
    assert.equal(r.status, 400, date);
  }
  assert.deepEqual((await s.call('GET', '/api/weather?date=' + addDays(5))).json, { error: 'date out of range' });
  for (const place of ['', '   ', 'x'.repeat(41), 'a%00b']) {
    const r = await s.call('GET', '/api/weather?place=' + place.replace(/ /g, '%20'));
    if (place === '') { assert.ok(r.status === 200 || r.status === 400); continue; }
    assert.equal(r.status, 400, place);
    assert.deepEqual(r.json, { error: 'place must be 1-40 characters' }, place);
  }
  const def = await s.call('GET', '/api/weather');
  assert.equal(def.json.place, 'anywhere');
  const unk = await s.call('GET', '/api/weather?language=xx');
  assert.equal(unk.status, 400);
}));

test('new endpoints answer wrong methods with 405 and allow, and keep security headers and no-store on /api/*', () => withServer(async (s) => {
  const table = [
    ['/api/weather', 'GET', ['POST', 'PUT', 'DELETE']],
    ['/api/stream', 'GET', ['POST', 'DELETE']],
    ['/api/sla', 'GET', ['POST', 'PUT']],
    ['/api/time-machine', 'GET', ['POST', 'DELETE']],
    ['/api/haiku', 'POST', ['GET', 'PUT', 'DELETE']],
    ['/api/federation', 'GET', ['POST', 'PUT']],
    ['/api/federation/hello', 'GET', ['POST', 'DELETE']],
  ];
  for (const [p, allowed, bad] of table) {
    for (const m of bad) {
      const r = await s.call(m, p, m === 'GET' || m === 'DELETE' ? undefined : '{}');
      assert.equal(r.status, 405, m + ' ' + p);
      assert.ok(String(r.headers.allow || '').toUpperCase().includes(allowed), 'allow on ' + p + ': ' + r.headers.allow);
      assert.equal(r.headers['x-content-type-options'], 'nosniff', p);
      assert.ok(r.headers['content-security-policy'], p);
      assert.match(r.headers['cache-control'] || '', /no-store/, p);
      assert.deepEqual(Object.keys(r.json || {}), ['error'], p);
    }
  }
  const ok = [
    await s.call('GET', '/api/weather'),
    await s.call('GET', '/api/sla'),
    await s.call('GET', '/api/time-machine?date=2000-01-01'),
    await s.call('POST', '/api/haiku', { name: 'Ada' }),
    await s.call('GET', '/api/federation'),
    await s.call('GET', '/api/federation/hello?name=Ada'),
    await s.call('GET', '/api/time-machine'),
  ];
  for (const r of ok) {
    assert.match(r.headers['cache-control'] || '', /no-store/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.ok(r.headers['content-security-policy']);
    assert.match(r.headers['content-type'], /^application\/json; charset=utf-8/);
  }
  const noPeers = await s.call('GET', '/api/federation');
  assert.deepEqual(noPeers.json, { configured: false, summary: { total: 0, up: 0, down: 0 }, peers: [] });
  const st = await openStream(s.port);
  assert.match(st.headers['cache-control'], /no-store/);
  assert.equal(st.headers['x-content-type-options'], 'nosniff');
  assert.equal(st.headers['access-control-allow-origin'], undefined);
  st.close();
}));

test('v2 does not change POST /hello: core body stays byte-exact', () => withServer(async (s) => {
  const r = await s.call('POST', '/hello', '');
  assert.equal(r.text, '{"message":"Hello World! Welcome to the API."}');
}));
