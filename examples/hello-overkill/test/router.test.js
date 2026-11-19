'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRouter, MAX_BODY } = require('../src/router');
const { createStore } = require('../src/store');
const { createRateLimiter } = require('../src/rate-limiter');
const { createSigner } = require('../src/certificates');
const { decideChaos } = require('../src/chaos');
const page = require('../src/page');

const CORE = '{"message":"Hello World! Welcome to the API."}';

async function boot(over = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-r-')), 'd.json');
  const deps = {
    store: createStore(file, undefined, () => {}),
    limiter: createRateLimiter({ limit: 1000, windowMs: 60000 }),
    voteLimiter: createRateLimiter({ limit: 60, windowMs: 60000 }),
    signer: createSigner('unit'),
    ...over,
  };
  const server = http.createServer(createRouter(deps));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const req = (method, p, { body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers, agent: false }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* html */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
  return { req, deps, file, port, close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
}
async function withApp(fn, over) { const app = await boot(over); try { await fn(app); } finally { await app.close(); } }

test('MAX_BODY is 16 KB', () => { assert.equal(MAX_BODY, 16384); });

test('serves the html page with CSP hashes of the inline script and style', () => withApp(async ({ req }) => {
  const r = await req('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^text\/html/);
  assert.equal(r.text, page.html);
  assert.ok(r.headers['content-security-policy'].includes(page.scriptHash));
  assert.ok(r.headers['content-security-policy'].includes(page.styleHash));
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
}));

test('healthz returns ok with security headers and json content type', () => withApp(async ({ req }) => {
  const r = await req('GET', '/healthz');
  assert.deepEqual(r.json, { ok: true });
  assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
  assert.ok(r.headers['content-security-policy']);
}));

test('wrong method on known paths returns 405 with allow', () => withApp(async ({ req }) => {
  for (const [m, p, allow] of [['POST', '/', 'GET'], ['POST', '/healthz', 'GET'], ['GET', '/api/verify', 'POST'], ['POST', '/api/battle', 'GET'], ['GET', '/api/battle/vote', 'POST'], ['DELETE', '/api/leaderboard', 'GET'], ['PUT', '/api/catalogue', 'GET'], ['POST', '/api/certificates/0123456789abcdef', 'GET']]) {
    const r = await req(m, p);
    assert.equal(r.status, 405, `${m} ${p}`);
    assert.equal(r.headers.allow, allow);
    assert.ok(r.json.error);
  }
}));

test('unknown paths and bad targets return json 404', () => withApp(async ({ req }) => {
  for (const p of ['/nope', '//evil.com/x', '//', '/api', '/api/certificates']) {
    const r = await req('GET', p);
    assert.equal(r.status, 404, p);
    assert.deepEqual(r.json, { error: 'not found' });
  }
  const proxy = await req('GET', 'http://example.com/healthz');
  assert.equal(proxy.status, 404);
}));

test('one trailing slash is stripped, two are not', () => withApp(async ({ req }) => {
  assert.equal((await req('GET', '/healthz/')).status, 200);
  assert.equal((await req('GET', '/healthz//')).status, 404);
  assert.equal((await req('GET', '/healthz?x=1')).status, 200);
}));

test('POST /hello returns the exact core body for odd bodies', () => withApp(async ({ req }) => {
  for (const body of [undefined, '', 'garbage', '[]', 'null', '{"foo":1}', '{"language":"es"}', '\xff\xfe{']) {
    const r = await req('POST', '/hello', { body });
    assert.equal(r.status, 200);
    assert.equal(r.text, CORE);
  }
}));

test('other methods on /hello return the core body', () => withApp(async ({ req }) => {
  for (const m of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    const r = await req(m, '/hello?chaos=418', { body: m === 'GET' ? undefined : '{"name":"Ada"}' });
    assert.equal(r.status, 200);
    assert.equal(r.text, CORE);
  }
}));

test('personalised hello returns visit, streak and a certificate that verifies and is retrievable', () => withApp(async ({ req }) => {
  const r = await req('POST', '/hello', { body: '{"name":" Ada ","language":"es","tone":"pirate"}' });
  assert.equal(r.status, 200);
  assert.equal(r.json.name, 'Ada');
  assert.equal(r.json.visit, 1);
  assert.equal(r.json.streak, 1);
  const v = await req('POST', '/api/verify', { body: JSON.stringify({ text: r.json.certificate.text }) });
  assert.deepEqual(v.json, { verdict: 'Authentic' });
  const c = await req('GET', `/api/certificates/${r.json.certificate.id}`);
  assert.equal(c.status, 200);
  assert.equal(c.json.text, r.json.certificate.text);
  assert.equal(c.json.language, 'es');
  const again = await req('POST', '/hello', { body: '{"name":"ada"}' });
  assert.equal(again.json.visit, 2);
}));

test('personalised hello validation errors are 400', () => withApp(async ({ req }) => {
  const cases = [['{"name":""}', 'name is required'], ['{"name":5}', 'name must be a string'], ['{"name":"Ada","language":"xx"}', 'unknown language'], ['{"name":"Ada","tone":"x"}', 'unknown tone']];
  for (const [body, msg] of cases) {
    const r = await req('POST', '/hello', { body });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, msg);
  }
}));

test('hello returns 500 could not save when the store cannot persist', () => withApp(async ({ req, file }) => {
  fs.mkdirSync(file); // a directory where the data file should be makes rename fail
  const r = await req('POST', '/hello', { body: '{"name":"Ada"}' });
  assert.equal(r.status, 500);
  assert.deepEqual(r.json, { error: 'could not save' });
}));

test('429 carries retry-after and consumes hits before reading the body', () => withApp(async ({ req }) => {
  await req('POST', '/hello');
  const r = await req('POST', '/hello', { body: '{"name":"Ada"}' });
  assert.equal(r.status, 429);
  assert.match(r.headers['retry-after'], /^[1-9]\d*$/);
  assert.equal(r.json.error, "You've been greeted enough.");
  assert.equal(r.json.retryAfter, Number(r.headers['retry-after']));
  assert.equal((await req('GET', '/healthz')).status, 200);
}, { limiter: createRateLimiter({ limit: 1, windowMs: 60000 }) }));

test('rate limiter is keyed on the socket address, not X-Forwarded-For', async () => {
  const seen = [];
  const limiter = { check: (k) => { seen.push(k); return { allowed: true }; } };
  await withApp(async ({ req }) => {
    await req('POST', '/hello', { headers: { 'x-forwarded-for': '9.9.9.9' } });
    assert.deepEqual(seen, ['127.0.0.1']);
  }, { limiter });
});

test('chaos 418 returns the teapot, skips the store and still consumes a hit', () => withApp(async ({ req, deps }) => {
  const r = await req('POST', '/hello?chaos=418', { body: '{"name":"Ada"}' });
  assert.equal(r.status, 418);
  assert.deepEqual(r.json, { error: 'teapot', message: 'The greeter spilled its tea (418).' });
  assert.equal(deps.store.stats().visitors, 0);
  assert.equal((await req('POST', '/hello?chaos=418')).status, 429);
}, { limiter: createRateLimiter({ limit: 1, windowMs: 60000 }) }));

test('chaos delay waits the decided time then answers normally', () => withApp(async ({ req }) => {
  const t = Date.now();
  const r = await req('POST', '/hello?chaos=delay', { body: '{"name":"Ada"}' });
  assert.equal(r.status, 200);
  assert.ok(Date.now() - t >= 40);
  assert.equal(r.json.name, 'Ada');
}, { chaos: (v, rnd) => (v === 'delay' ? { kind: 'delay', ms: 50 } : decideChaos(v, rnd)) }));

test('chaos delay is abandoned without touching the store when the client disconnects', async () => {
  await withApp(async ({ deps, port }) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/hello?chaos=delay', agent: false });
    r.on('error', () => {});
    r.end('{"name":"Ada"}');
    await new Promise((res) => setTimeout(res, 100));
    r.destroy();
    await new Promise((res) => setTimeout(res, 100));
    assert.equal(deps.store.stats().visitors, 0);
  }, { chaos: () => ({ kind: 'delay', ms: 150 }) });
});

test('chaos=1 uses the injected random for the three outcomes', async () => {
  for (const [r, status] of [[0.1, 418], [0.9, 200]]) {
    await withApp(async ({ req }) => {
      assert.equal((await req('POST', '/hello?chaos=1')).status, status);
    }, { random: () => r });
  }
});

test('unknown chaos values are ignored', () => withApp(async ({ req }) => {
  assert.equal((await req('POST', '/hello?chaos=banana')).status, 200);
  assert.equal((await req('POST', '/hello?chaos=')).status, 200);
}));

test('declared body over the cap is 413 with connection close', () => withApp(async ({ req }) => {
  const r = await req('POST', '/hello', { body: 'x'.repeat(MAX_BODY + 1), headers: { 'content-length': String(MAX_BODY + 1) } }).catch((e) => ({ err: e }));
  if (r.err) assert.match(r.err.code, /EPIPE|ECONNRESET/);
  else {
    assert.equal(r.status, 413);
    assert.equal(r.headers.connection, 'close');
    assert.deepEqual(r.json, { error: 'request body too large' });
  }
}));

test('streamed body over the cap is 413 and a body at the cap is accepted', () => withApp(async ({ req }) => {
  const big = await req('POST', '/api/verify', { body: 'x'.repeat(MAX_BODY + 10), headers: { 'transfer-encoding': 'chunked' } }).catch((e) => ({ err: e }));
  if (!big.err) { assert.equal(big.status, 413); assert.equal(big.headers.connection, 'close'); }
  const pad = 'x'.repeat(MAX_BODY - 20);
  const ok = await req('POST', '/hello', { body: `{"name":"Ada","pad":"${pad.slice(0, MAX_BODY - 40)}"}` });
  assert.equal(ok.status, 200);
}));

test('catalogue lists 10 languages, 4 tones and defaults', () => withApp(async ({ req }) => {
  const r = await req('GET', '/api/catalogue');
  assert.equal(r.json.languages.length, 10);
  assert.equal(r.json.tones.length, 4);
  assert.deepEqual(r.json.defaults, { language: 'en', tone: 'formal' });
}));

test('certificate lookup 404s for malformed and unknown ids', () => withApp(async ({ req }) => {
  for (const id of ['xyz', '0123456789abcdeg', '0123456789ABCDEF', '0123456789abcdef']) {
    const r = await req('GET', `/api/certificates/${id}`);
    assert.equal(r.status, 404);
    assert.deepEqual(r.json, { error: 'certificate not found' });
  }
}));

test('verify validates input and reports verdicts', () => withApp(async ({ req }) => {
  const post = (body) => req('POST', '/api/verify', { body });
  assert.equal((await post('')).status, 400);
  assert.equal((await post('{"text":5}')).status, 400);
  const long = await post(JSON.stringify({ text: 'x'.repeat(10001) }));
  assert.deepEqual([long.status, long.json], [400, { error: 'too long' }]);
  const bad = await post('{"text":"nope"}');
  assert.deepEqual(bad.json, { verdict: 'Forged', reason: 'unreadable' });
}));

test('battle returns two distinct options', () => withApp(async ({ req }) => {
  const r = await req('GET', '/api/battle');
  assert.equal(r.status, 200);
  assert.notEqual(r.json.a.id, r.json.b.id);
  assert.notEqual(r.json.a.greeting, r.json.b.greeting);
}));

test('votes update the leaderboard and invalid votes are 400', () => withApp(async ({ req }) => {
  assert.deepEqual((await req('GET', '/api/leaderboard')).json, { leaderboard: [] });
  const v = await req('POST', '/api/battle/vote', { body: '{"choice":"en.pirate"}' });
  assert.equal(v.status, 200);
  assert.equal(v.json.ok, true);
  assert.deepEqual(v.json.leaderboard.map((x) => [x.rank, x.id, x.votes]), [[1, 'en.pirate', 1]]);
  assert.deepEqual((await req('GET', '/api/leaderboard')).json.leaderboard, v.json.leaderboard);
  for (const body of ['', '{"choice":"__proto__"}', '{"choice":3}', '{}']) {
    assert.equal((await req('POST', '/api/battle/vote', { body })).status, 400);
  }
}));

test('votes are limited by the vote limiter with retry-after', () => withApp(async ({ req }) => {
  assert.equal((await req('POST', '/api/battle/vote', { body: '{"choice":"en.pirate"}' })).status, 200);
  const r = await req('POST', '/api/battle/vote', { body: '{"choice":"en.pirate"}' });
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers['retry-after']) >= 1);
}, { voteLimiter: createRateLimiter({ limit: 1, windowMs: 60000 }) }));

test('vote persist failure is 500 could not save', () => withApp(async ({ req, file }) => {
  fs.mkdirSync(file);
  const r = await req('POST', '/api/battle/vote', { body: '{"choice":"en.pirate"}' });
  assert.deepEqual([r.status, r.json], [500, { error: 'could not save' }]);
}));

test('handler exceptions become 500 internal error without details', async () => {
  const store = { getCertificate() { throw new Error('secret detail'); } };
  await withApp(async ({ req }) => {
    const r = await req('GET', '/api/certificates/0123456789abcdef');
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: 'internal error' });
    assert.ok(!r.text.includes('secret detail'));
  }, { store });
});

test('clientKey normalises IPv4-mapped and keys IPv6 by /64', () => {
  const { clientKey } = require('../src/router');
  assert.equal(clientKey('::ffff:1.2.3.4'), '1.2.3.4');
  assert.equal(clientKey('::ffff:102:304'), '1.2.3.4');
  assert.equal(clientKey('1.2.3.4'), '1.2.3.4');
  assert.equal(clientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), clientKey('2001:db8:1:2::1'));
  assert.equal(clientKey('2001:DB8:1:2::1%eth0'), clientKey('2001:db8:1:2:0:0:0:9'));
  assert.notEqual(clientKey('2001:db8:1:2::1'), clientKey('2001:db8:1:3::1'));
  assert.equal(clientKey('::1'), clientKey('0:0:0:0:5::2'));
  assert.equal(clientKey(undefined), 'unknown');
});

test('IPv6 and IPv4-mapped clients share limiter buckets', async () => {
  const hits = [];
  const limiter = { check: (k) => { hits.push(k); return { allowed: true }; } };
  const { createRouter } = require('../src/router');
  const handler = createRouter({ ...(await bootDeps()), limiter });
  for (const addr of ['::ffff:9.9.9.9', '2001:db8::1', '2001:db8::2']) {
    const res = { headersSent: false, writableEnded: false, writeHead() {}, end() {}, setHeader() {}, on() {} };
    await handler({ url: '/hello', method: 'GET', headers: {}, socket: { remoteAddress: addr }, resume() {} }, res);
  }
  assert.equal(hits[0], '9.9.9.9');
  assert.equal(hits[1], hits[2]);
});

async function bootDeps() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-d-')), 'd.json');
  return { store: createStore(file, undefined, () => {}), voteLimiter: createRateLimiter({}), signer: createSigner('unit') };
}

test('cache-control no-store on /api/* only', async () => {
  const s = await boot();
  try {
    assert.equal((await s.req('GET', '/api/catalogue')).headers['cache-control'], 'no-store');
    assert.equal((await s.req('GET', '/api/certificates/nope')).headers['cache-control'], 'no-store');
    assert.equal((await s.req('GET', '/healthz')).headers['cache-control'], undefined);
    assert.equal((await s.req('GET', '/')).headers['cache-control'], undefined);
  } finally { await s.close(); }
});

test('readBody gives up when the client closes mid-body', async () => {
  const s = await boot();
  try {
    const net = require('node:net');
    const sock = net.connect(s.port, '127.0.0.1');
    await new Promise((r) => sock.on('connect', r));
    sock.write('POST /hello HTTP/1.1\r\nhost: x\r\ncontent-length: 50\r\ncontent-type: application/json\r\n\r\n{"na');
    await new Promise((r) => setTimeout(r, 50));
    sock.destroy();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await s.req('GET', '/healthz')).status, 200);
  } finally { await s.close(); }
});

test('vote: only a persist failure maps to 500 could not save', async () => {
  const bad = { vote() { throw new TypeError('boom'); }, votes: () => new Map(), getCertificate: () => null };
  const s = await boot({ store: bad });
  try {
    const r = await s.req('POST', '/api/battle/vote', { body: JSON.stringify({ choice: 'en.formal' }) });
    assert.equal(r.status, 500);
    assert.equal(r.json.error, 'internal error');
  } finally { await s.close(); }
  const { PersistError } = require('../src/store');
  const bad2 = { vote() { throw new PersistError(new Error('x')); }, votes: () => new Map(), getCertificate: () => null };
  const s2 = await boot({ store: bad2 });
  try {
    const r = await s2.req('POST', '/api/battle/vote', { body: JSON.stringify({ choice: 'en.formal' }) });
    assert.equal(r.json.error, 'could not save');
  } finally { await s2.close(); }
});
