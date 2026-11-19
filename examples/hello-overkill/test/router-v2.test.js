'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRouter } = require('../src/router');
const { createStore } = require('../src/store');
const { createRateLimiter } = require('../src/rate-limiter');
const { createSigner } = require('../src/certificates');
const { createHub } = require('../src/stream');
const { createSla } = require('../src/sla');

const CORE = '{"message":"Hello World! Welcome to the API."}';
const NOW = Date.parse('2026-11-18T10:00:00Z');
const noop = () => {};

// Polls until check() is truthy or the deadline passes; resolves to the last check() result.
async function waitFor(check, { timeoutMs = 2000, stepMs = 5 } = {}) {
  const end = Date.now() + timeoutMs;
  let v = check();
  while (!v && Date.now() < end) { await new Promise((r) => setTimeout(r, stepMs)); v = check(); }
  return v;
}

async function boot(over = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-r2-')), 'd.json');
  const deps = {
    store: createStore(file, over.now || (() => NOW), noop),
    limiter: createRateLimiter({ limit: 1000, windowMs: 60000 }),
    voteLimiter: createRateLimiter({ limit: 1000, windowMs: 60000 }),
    signer: createSigner('unit'),
    now: () => NOW,
    ...over,
  };
  const server = http.createServer(createRouter(deps));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const req = (method, p, { body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers, agent: false }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
  return { req, deps, port, close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
}
async function withApp(fn, over) { const app = await boot(over); try { await fn(app); } finally { await app.close(); } }

test('weather returns the forecast shape with security headers and no-store', () => withApp(async ({ req }) => {
  const r = await req('GET', '/api/weather?place=Lisbon&date=2026-11-18&name=Ada');
  assert.equal(r.status, 200);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.ok(r.headers['content-security-policy']);
  assert.equal(r.json.place, 'Lisbon');
  assert.equal(r.json.simulated, true);
  assert.match(r.json.greeting, /Ada.*Today: /);
  assert.ok(r.json.greeting.endsWith(r.json.forecast));
}));

test('weather defaults place and date and greets World without a name', () => withApp(async ({ req }) => {
  const r = await req('GET', '/api/weather');
  assert.equal(r.status, 200);
  assert.equal(r.json.place, 'anywhere');
  assert.equal(r.json.date, '2026-11-18');
  assert.match(r.json.greeting, /World/);
}));

test('weather rejects bad place, date, name, language and tone with 400', () => withApp(async ({ req }) => {
  const cases = [
    ['?place=', 'place must be 1-40 characters'], [`?place=${'x'.repeat(41)}`, 'place must be 1-40 characters'],
    ['?date=2026-13-01', 'date out of range'], ['?date=2026-02-30', 'date out of range'], ['?date=garbage', 'date out of range'],
    ['?date=2026-11-16', 'date out of range'], ['?date=2026-11-20', 'date out of range'],
    ['?name=', 'name is required'], ['?language=xx', 'unknown language'], ['?tone=nope', 'unknown tone'],
  ];
  for (const [q, msg] of cases) {
    const r = await req('GET', `/api/weather${q}`);
    assert.equal(r.status, 400, q);
    assert.deepEqual(r.json, { error: msg }, q);
  }
}));

test('weather accepts the edges of the window (yesterday and tomorrow)', () => withApp(async ({ req }) => {
  for (const d of ['2026-11-17', '2026-11-19']) assert.equal((await req('GET', `/api/weather?date=${d}`)).status, 200, d);
}));

test('weather uses the first value of a repeated key', () => withApp(async ({ req }) => {
  assert.equal((await req('GET', '/api/weather?place=Rome&place=Oslo')).json.place, 'Rome');
}));

test('new routes answer 405 with allow on the wrong method', () => withApp(async ({ req }) => {
  for (const [m, p, allow] of [
    ['POST', '/api/weather', 'GET'], ['POST', '/api/stream', 'GET'], ['POST', '/api/sla', 'GET'], ['POST', '/api/time-machine', 'GET'],
    ['GET', '/api/haiku', 'POST'], ['POST', '/api/federation', 'GET'], ['DELETE', '/api/federation/hello', 'GET'],
  ]) {
    const r = await req(m, p);
    assert.equal(r.status, 405, p);
    assert.equal(r.headers.allow, allow, p);
    assert.deepEqual(r.json, { error: 'method not allowed' });
  }
}));

test('time machine returns era and greeting and validates input', () => withApp(async ({ req }) => {
  const r = await req('GET', '/api/time-machine?date=1987-05-02&name=Ada');
  assert.equal(r.status, 200);
  assert.equal(r.json.era, 'disco and dial-up dawn');
  assert.match(r.json.greeting, /Ada/);
  assert.deepEqual(r.json.streak, { name: 'Ada', status: 'no-record', dayOfStreak: null, streakLength: null });
  assert.equal((await req('GET', '/api/time-machine?date=1987-05-02')).json.streak, null);
  for (const [q, msg] of [['', 'date is required'], ['?date=x', 'date must be YYYY-MM-DD'], ['?date=1899-12-31', 'date before 1900-01-01'],
    ['?date=2026-11-19', 'date is in the future'], ['?date=1900-02-29', 'date is not a real date'],
    ['?date=2000-01-01&language=zz', 'unknown language'], ['?date=2000-01-01&tone=zz', 'unknown tone'], ['?date=2000-01-01&name=', 'name is required']]) {
    const e = await req('GET', `/api/time-machine${q}`);
    assert.deepEqual([e.status, e.json], [400, { error: msg }], q);
  }
}));

test('time machine reads streaks without mutating the store and can hide them', async () => {
  await withApp(async ({ req, deps }) => {
    await req('POST', '/hello', { body: '{"name":"Ada"}' });
    const before = JSON.stringify(deps.store.peekVisitor('Ada'));
    const r = await req('GET', '/api/time-machine?date=2026-11-18&name=Ada');
    assert.equal(r.json.streak.status, 'on-streak');
    assert.equal(r.json.streak.dayOfStreak, 1);
    assert.equal(JSON.stringify(deps.store.peekVisitor('Ada')), before);
  });
  await withApp(async ({ req }) => {
    await req('POST', '/hello', { body: '{"name":"Ada"}' });
    assert.equal((await req('GET', '/api/time-machine?date=2026-11-18&name=Ada')).json.streak, null);
  }, { timeMachineStreaks: false });
});

test('haiku returns three verified lines and is deterministic', () => withApp(async ({ req }) => {
  const body = JSON.stringify({ name: 'Ada', theme: 'ocean' });
  const a = await req('POST', '/api/haiku', { body });
  const b = await req('POST', '/api/haiku', { body });
  assert.equal(a.status, 200);
  assert.equal(a.json.haiku.length, 3);
  assert.deepEqual(a.json.syllables, [5, 7, 5]);
  assert.equal(a.json.verified, true);
  assert.deepEqual(a.json, b.json);
}));

test('haiku validates body, name, theme and syllables', () => withApp(async ({ req }) => {
  const cases = [
    ['not json', 'name is required'], ['[]', 'name is required'], ['{}', 'name is required'], ['{"name":5}', 'name must be a string'],
    ['{"name":"Ada","theme":"space"}', 'unknown theme'], ['{"name":"Ada","theme":"__proto__"}', 'unknown theme'],
    ['{"name":"Ada","syllables":0}', 'syllables must be an integer 1-6'], ['{"name":"Ada","syllables":7}', 'syllables must be an integer 1-6'],
    ['{"name":"Ada","syllables":"2"}', 'syllables must be an integer 1-6'], ['{"name":"Ada","syllables":1.5}', 'syllables must be an integer 1-6'],
  ];
  for (const [body, msg] of cases) {
    const r = await req('POST', '/api/haiku', { body });
    assert.deepEqual([r.status, r.json], [400, { error: msg }], body);
  }
}));

test('haiku answers 422 for unscannable names and 413 for oversized bodies', () => withApp(async ({ req }) => {
  const r = await req('POST', '/api/haiku', { body: '{"name":"日本"}' });
  assert.equal(r.status, 422);
  assert.deepEqual(r.json, { error: 'name cannot be scanned into a haiku', hint: 'try the syllables field or a shorter name' });
  const big = await req('POST', '/api/haiku', { body: 'x'.repeat(20000), headers: { 'content-length': '20000' } }).catch((e) => ({ err: e }));
  if (big.err) assert.match(big.err.code, /EPIPE|ECONNRESET/); else assert.equal(big.status, 413);
}));

test('read-limited routes answer 429 with retry-after; /hello is not read-limited', () => withApp(async ({ req }) => {
  assert.equal((await req('GET', '/api/weather')).status, 200);
  assert.equal((await req('GET', '/api/weather')).status, 200);
  const r = await req('GET', '/api/sla');
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers['retry-after']) >= 1);
  assert.equal(r.json.error, "You've been greeted enough.");
  assert.equal((await req('GET', '/healthz')).status, 200);
  assert.equal((await req('POST', '/hello', { body: '{}' })).text, CORE);
}, { readLimiter: createRateLimiter({ limit: 2, windowMs: 60000 }) }));

test('federation hello uses its own limiter and validates name, language, tone', () => withApp(async ({ req }) => {
  assert.deepEqual((await req('GET', '/api/federation/hello')).json, { error: 'name is required' });
  assert.deepEqual((await req('GET', '/api/federation/hello?name=Ada&language=zz')).json, { error: 'unknown language' });
  assert.deepEqual((await req('GET', '/api/federation/hello?name=Ada&tone=zz')).json, { error: 'unknown tone' });
  assert.equal((await req('GET', '/api/federation/hello?name=Ada')).status, 429);
}, { fedLimiter: createRateLimiter({ limit: 3, windowMs: 60000 }) }));

test('federation routes pass normalised input to the injected federation', async () => {
  const calls = [];
  const federation = {
    health: async () => ({ configured: false, summary: { total: 0, up: 0, down: 0 }, peers: [] }),
    hello: async (a) => { calls.push(a); return { configured: true, summary: { total: 0, ok: 0, failed: 0 }, results: [] }; },
  };
  await withApp(async ({ req }) => {
    assert.equal((await req('GET', '/api/federation')).json.configured, false);
    const r = await req('GET', '/api/federation/hello?name=%20Ada%20&language=es');
    assert.equal(r.status, 200);
    assert.deepEqual(calls, [{ name: 'Ada', language: 'es', tone: 'formal' }]);
  }, { federation });
});

test('sla answers with a snapshot including streamsOpen and requires the bearer token when set', async () => {
  await withApp(async ({ req }) => {
    await req('GET', '/healthz');
    const r = await req('GET', '/api/sla');
    assert.equal(r.status, 200);
    assert.equal(r.json.streamsOpen, 0);
    assert.ok(r.json.routes.some((x) => x.route === 'GET /healthz'));
  });
  await withApp(async ({ req }) => {
    for (const h of [{}, { authorization: 'Bearer wrong' }, { authorization: 'Bearer s3cret-token-longer' }, { authorization: 's3cret-token' }, { authorization: 'Basic s3cret-token' }]) {
      const r = await req('GET', '/api/sla', { headers: h });
      assert.equal(r.status, 401, JSON.stringify(h));
      assert.deepEqual(r.json, { error: 'unauthorized' });
    }
    assert.equal((await req('GET', '/api/sla', { headers: { authorization: 'Bearer s3cret-token' } })).status, 200);
  }, { slaToken: 's3cret-token' });
});

test('stream sends security headers, replays published events and never carries the name', async () => {
  await withApp(async ({ req, port, deps }) => {
    await req('POST', '/hello', { body: '{"name":"Zelda","language":"es","tone":"pirate"}' });
    const text = await new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, path: '/api/stream', agent: false }, (res) => {
        assert.equal(res.statusCode, 200);
        assert.match(res.headers['content-type'], /^text\/event-stream/);
        assert.equal(res.headers['content-length'], undefined);
        assert.ok(res.headers['content-security-policy']);
        let t = '';
        res.on('data', (c) => { t += c; if (t.includes('event: hello')) { res.destroy(); resolve(t); } });
      });
      r.on('error', (e) => (e.code === 'ECONNRESET' ? undefined : reject(e)));
      r.end();
    });
    assert.ok(text.startsWith('retry: 3000\n\n: connected\n\n'));
    assert.match(text, /"language":"es","tone":"pirate","milestone":"first-visit"/);
    assert.ok(!text.includes('Zelda'));
    assert.ok(await waitFor(() => deps.hub.size() === 0), 'client dropped before the deadline');
    assert.equal(deps.hub.size(), 0);
  }, { hub: createHub({ now: () => NOW }) });
});

test('hello publishes {kind:core} for core hellos and visit/streak for named hellos', async () => {
  const published = [];
  const hub = { publish: (i) => published.push(i), size: () => 0 };
  await withApp(async ({ req }) => {
    assert.equal((await req('POST', '/hello', { body: '{}' })).text, CORE);
    await req('POST', '/hello', { body: '{"name":"Ada","language":"fr","tone":"formal"}' });
    await req('POST', '/hello', { body: '{"name":""}' });
  }, { hub });
  assert.deepEqual(published, [{ kind: 'core' }, { language: 'fr', tone: 'formal', visit: 1, streak: 1 }]);
});

test('a throwing hub never changes the hello response', () => withApp(async ({ req }) => {
  const r = await req('POST', '/hello', { body: '{}' });
  assert.equal(r.status, 200);
  assert.equal(r.text, CORE);
  const named = await req('POST', '/hello', { body: '{"name":"Ada"}' });
  assert.equal(named.status, 200);
  assert.equal(named.json.name, 'Ada');
}, { hub: { publish() { throw new Error('boom'); }, size: () => 0 } }));

test('stream refuses with 503 when the hub is full or the client key is full', async () => {
  for (const verdict of ['full', 'ip-full']) {
    await withApp(async ({ req }) => {
      const r = await req('GET', '/api/stream');
      assert.equal(r.status, 503);
      assert.deepEqual(r.json, { error: 'too many streams' });
      assert.equal(r.headers['retry-after'], '5');
      assert.ok(r.headers['content-security-policy']);
    }, { hub: { subscribe: () => verdict, publish: noop, size: () => 0 } });
  }
});

test('stream passes the client key and Last-Event-ID to the hub', async () => {
  let seen;
  await withApp(async ({ req }) => {
    await req('GET', '/api/stream', { headers: { 'last-event-id': '7' } }).catch(noop);
  }, { hub: { subscribe: (res, o) => { seen = o; res.writeHead(200); res.end(); return 'ok'; }, publish: noop, size: () => 0 } });
  assert.equal(seen.ip, '127.0.0.1');
  assert.equal(seen.lastEventId, '7');
  assert.ok(seen.headers['x-content-type-options']);
});

test('a malformed haiku result becomes 500 internal error', async () => {
  const haiku = require('../src/haiku');
  const orig = haiku.makeHaiku;
  haiku.makeHaiku = () => ({ name: 'Ada', theme: 'morning', haiku: ['one', ''], syllables: [5, 7, 5], verified: true, nameSyllables: 2, limit: '' });
  try {
    await withApp(async ({ req }) => {
      const r = await req('POST', '/api/haiku', { body: '{"name":"Ada"}' });
      assert.equal(r.status, 500);
      assert.deepEqual(r.json, { error: 'internal error' });
    });
  } finally { haiku.makeHaiku = orig; }
});

test('POST /hello stays byte-exact with every v2 dependency injected', () => withApp(async ({ req }) => {
  const r = await req('POST', '/hello', { body: '' });
  assert.equal(r.text, CORE);
  assert.equal((await req('GET', '/hello')).text, CORE);
}, { hub: createHub(), sla: createSla(), federation: { health: async () => ({}), hello: async () => ({}) }, readLimiter: createRateLimiter({ limit: 1, windowMs: 1000 }), fedLimiter: createRateLimiter({ limit: 1, windowMs: 1000 }) }));

test('requests are recorded in the sla under fixed labels', async () => {
  const sla = createSla({ now: () => NOW });
  await withApp(async ({ req }) => {
    await req('GET', '/api/certificates/0123456789abcdef');
    await req('GET', '/nope?x=1');
    await waitFor(() => sla.snapshot().routes.length >= 2);
    const labels = sla.snapshot().routes.map((r) => r.route).sort();
    assert.deepEqual(labels, ['GET /api/certificates/:id', 'other']);
  }, { sla });
});

test('federation hello answers 429 with retry-after from the global limiter before contacting peers', async () => {
  let calls = 0;
  const federation = { health: async () => ({}), hello: async () => { calls++; return { configured: true }; } };
  await withApp(async ({ req }) => {
    assert.equal((await req('GET', '/api/federation/hello?name=Ada')).status, 200);
    assert.equal((await req('GET', '/api/federation/hello?name=Ada')).status, 200);
    const r = await req('GET', '/api/federation/hello?name=Ada');
    assert.equal(r.status, 429);
    assert.match(r.headers['retry-after'], /^[1-9]\d*$/);
    assert.equal(r.json.error, "You've been greeted enough.");
    assert.equal(calls, 2);
    assert.equal((await req('GET', '/api/federation/hello')).status, 400, 'validation errors do not spend the global budget');
    assert.equal((await req('GET', '/api/federation')).status, 200, 'health is not covered by the global limiter');
  }, { federation, fedGlobalLimiter: createRateLimiter({ limit: 2, windowMs: 60000 }) });
});

test('/api/stream is read-limited: connects beyond the budget get 429 with retry-after', () => withApp(async ({ req, port }) => {
  const opened = await new Promise((resolve, reject) => {
    const r = http.get({ host: '127.0.0.1', port, path: '/api/stream', agent: false }, (res) => { res.destroy(); resolve(res.statusCode); });
    r.on('error', (e) => (e.code === 'ECONNRESET' ? undefined : reject(e)));
  });
  assert.equal(opened, 200);
  const r = await req('GET', '/api/stream');
  assert.equal(r.status, 429);
  assert.match(r.headers['retry-after'], /^[1-9]\d*$/);
  assert.equal((await req('GET', '/healthz')).status, 200, 'other routes are untouched');
}, { hub: createHub({ now: () => NOW }), readLimiter: createRateLimiter({ limit: 1, windowMs: 60000 }) }));

test('/api/sla: unset token is open outside production and locked (401) in production', async () => {
  await withApp(async ({ req }) => { assert.equal((await req('GET', '/api/sla')).status, 200); });
  await withApp(async ({ req }) => {
    const r = await req('GET', '/api/sla');
    assert.equal(r.status, 401);
    assert.equal(r.headers['www-authenticate'], 'Bearer');
    assert.equal((await req('GET', '/api/sla', { headers: { authorization: 'Bearer undefined' } })).status, 401);
  }, { production: true });
  const slaToken = 'a-sixteen-char-token'; // harness:allow-secret
  await withApp(async ({ req }) => {
    assert.equal((await req('GET', '/api/sla', { headers: { authorization: `Bearer ${slaToken}` } })).status, 200);
    assert.equal((await req('GET', '/api/sla')).status, 401);
  }, { production: true, slaToken });
});
