'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  parsePeers, isPrivateAddress, createFederation, validateHealth, validatePeerHello, defaultFetchPeer,
} = require('../src/federation');

const quiet = () => {};

test('parsePeers accepts bare origins, normalises, dedupes and keeps order', () => {
  const got = parsePeers('https://A.example, http://b.example:80 ,https://a.example/,http://c.example:8080', { warn: quiet });
  assert.deepEqual(got, ['https://a.example', 'http://b.example', 'http://c.example:8080']);
});

test('parsePeers rejects paths, userinfo, bad schemes, query, hash and junk with index-only warnings', () => {
  const warns = [];
  const got = parsePeers([
    'https://ok.example', 'https://a.example/path', 'https://u:p@b.example', 'ftp://c.example', 'https://d.example?x=1',
    'https://e.example#h', 'https://f.example/?', 'not a url', 'https://secret-user@g.example',
  ].join(','), { warn: (m) => warns.push(m) });
  assert.deepEqual(got, ['https://ok.example']);
  assert.equal(warns.length, 8);
  assert.ok(warns.every((w) => !/secret|example|:p@/.test(w)));
  assert.ok(warns[0].includes('entry 1'));
});

test('parsePeers handles empty and non-string input', () => {
  for (const v of [undefined, null, '', '  ', ',,', 5]) assert.deepEqual(parsePeers(v, { warn: quiet }), []);
});

test('parsePeers caps at 8 with a warning', () => {
  const warns = [];
  const env = Array.from({ length: 9 }, (_, i) => `https://p${i}.example`).join(',');
  const got = parsePeers(env, { warn: (m) => warns.push(m) });
  assert.equal(got.length, 8);
  assert.equal(got[7], 'https://p7.example');
  assert.equal(warns.length, 1);
});

test('parsePeers keeps private hosts but warns when allowPrivate is on', () => {
  const warns = [];
  assert.deepEqual(parsePeers('http://127.0.0.1:9', { warn: (m) => warns.push(m) }), ['http://127.0.0.1:9']);
  assert.equal(warns.length, 0);
  parsePeers('http://127.0.0.1:9', { allowPrivate: true, warn: (m) => warns.push(m) });
  assert.equal(warns.length, 1);
  assert.deepEqual(parsePeers('http://[::1]:9', { warn: quiet }), ['http://[::1]:9']);
});

test('isPrivateAddress table', () => {
  const priv = [
    '127.0.0.1', '127.255.255.255', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '169.254.0.1',
    '100.64.0.1', '100.127.255.255', '0.0.0.0', '0.1.2.3', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
    '::1', '::', 'fc00::1', 'fdff::1', 'fe80::1', 'febf::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1',
    '::ffff:a9fe:a9fe', '::127.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::1', 'fe80::1%eth0', '0:0:0:0:0:0:0:1',
    'garbage', '', '1.2.3', '999.1.1.1', null, undefined, 42, '::ffff:999.1.1.1',
    '192.0.0.1', '192.0.0.255', '192.0.2.1', '198.18.0.1', '198.19.255.255', '198.51.100.7', '203.0.113.9',
    '64:ff9b:1::1', '64:ff9b:1:ffff::1', 'fec0::1', 'feff::1', '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    '::ffff:0:7f00:1', '::ffff:0:a00:1', '::ffff:192.0.2.1', '::ffff:c000:201', '::ffff:198.18.0.1', '64:ff9b::c633:6401', '2002:c000:201::1', '2002:cb00:7109::1',
  ];
  for (const ip of priv) assert.equal(isPrivateAddress(ip), true, String(ip));
  const pub = [
    '8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '169.253.0.1', '223.255.255.255',
    '192.169.0.1', '11.0.0.1', '2001:4860:4860::8888', '2606:4700::1111', '::ffff:8.8.8.8', '::ffff:808:808', '2002:808:808::1', 'fbff::1', '191.255.255.255', '192.0.1.1', '192.0.3.1', '198.17.255.255', '198.20.0.1', '198.51.99.1', '198.51.101.1', '203.0.112.1', '203.0.114.1', '2001:1::1', '::ffff:0:808:808', '64:ff9b:2::1',
  ];
  for (const ip of pub) assert.equal(isPrivateAddress(ip), false, ip);
});

test('validateHealth requires a plain object with ok === true', () => {
  assert.equal(validateHealth({ ok: true }), true);
  assert.equal(validateHealth({ ok: true, extra: 1 }), true);
  for (const bad of [{ ok: 'true' }, { ok: 1 }, { ok: false }, {}, null, undefined, [], [{ ok: true }], 'ok', 5, Object.create({ ok: true })]) {
    assert.equal(validateHealth(bad), false, JSON.stringify(bad));
  }
});

test('validatePeerHello keeps only whitelisted fields', () => {
  const out = validatePeerHello({
    greeting: 'Hola, Ada!', visit: 2, streak: 2, certificate: { id: 'x' }, name: 'Ada', __proto__x: 1, nested: { greeting: 'no' },
  });
  assert.deepEqual(out, { greeting: 'Hola, Ada!', visit: 2, streak: 2 });
  assert.deepEqual(validatePeerHello({ greeting: 'Hi' }), { greeting: 'Hi' });
});

test('validatePeerHello strips control and format characters and rejects what becomes empty', () => {
  assert.equal(validatePeerHello({ greeting: 'a\u0000b‮c​d\n' }).greeting, 'abcd');
  assert.equal(validatePeerHello({ greeting: '\u0000​\n' }), null);
  assert.equal(validatePeerHello({ greeting: '<script>alert(1)</script>' }).greeting, '<script>alert(1)</script>');
});

test('validatePeerHello rejects hostile shapes', () => {
  const bad = [
    null, undefined, [], 'greeting', 7, {}, { greeting: '' }, { greeting: 5 }, { greeting: ['x'] }, { greeting: { a: 1 } },
    { greeting: 'x'.repeat(301) }, { greeting: 'x'.repeat(1024 * 1024) }, { message: 'Hello World! Welcome to the API.' },
    { greeting: 'ok', visit: 0 }, { greeting: 'ok', visit: 1.5 }, { greeting: 'ok', visit: '2' }, { greeting: 'ok', streak: 1000001 },
    { greeting: 'ok', streak: -1 }, { greeting: 'ok', visit: null }, Object.create({ greeting: 'inherited' }),
  ];
  for (const b of bad) assert.equal(validatePeerHello(b), null, JSON.stringify(b === undefined ? 'undef' : String(b).slice(0, 20)));
  assert.equal(validatePeerHello({ greeting: 'x'.repeat(300) }).greeting.length, 300);
  assert.equal(validatePeerHello({ greeting: 'ok', visit: 1000000 }).visit, 1000000);
  assert.deepEqual(validatePeerHello(JSON.parse('{"greeting":"ok","__proto__":{"x":1}}')), { greeting: 'ok' });
});

// ---- createFederation with fake fetchPeer ----

const json = (body, extra = {}) => ({ status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, text: JSON.stringify(body), ...extra });
const fail = (code) => Object.assign(new Error(`secret detail for ${code} http://internal/x`), { code });

function clock() {
  const c = { t: Date.parse('2026-11-18T10:00:00.000Z') };
  c.now = () => c.t;
  return c;
}

test('health with no peers is unconfigured and makes no calls', async () => {
  let calls = 0;
  const fed = createFederation({ peers: [], fetchPeer: async () => { calls++; } });
  assert.equal(fed.configured, false);
  assert.deepEqual(await fed.health(), { configured: false, summary: { total: 0, up: 0, down: 0 }, peers: [] });
  assert.deepEqual(await fed.hello({ name: 'Ada' }), { configured: false, summary: { total: 0, ok: 0, failed: 0 }, results: [] });
  assert.equal(calls, 0);
});

test('health calls fixed /healthz paths, keeps allowlist order and measures latency with the injected clock', async () => {
  const c = clock();
  const seen = [];
  const fed = createFederation({
    peers: ['https://a.example', 'https://b.example'], now: c.now,
    fetchPeer: async (req) => { seen.push(req); c.t += req.url.startsWith('https://a') ? 42 : 30; return json({ ok: true }); },
  });
  const out = await fed.health();
  assert.equal(out.configured, true);
  assert.equal(out.checkedAt, '2026-11-18T10:00:00.000Z');
  assert.deepEqual(out.summary, { total: 2, up: 2, down: 0 });
  assert.deepEqual(out.peers.map((p) => p.origin), ['https://a.example', 'https://b.example']);
  assert.ok(out.peers.every((p) => p.ok === true && typeof p.latencyMs === 'number'));
  assert.deepEqual(seen.map((r) => r.url).sort(), ['https://a.example/healthz', 'https://b.example/healthz']);
  for (const r of seen) {
    assert.equal(r.method, 'GET');
    assert.equal(r.timeoutMs, 1500);
    assert.equal(r.maxBytes, 65536);
    assert.equal(r.headers['user-agent'], 'hello-overkill-federation');
  }
});

test('each error code maps through and one failing peer never affects the others', async () => {
  const peers = ['https://ok.example'];
  const cases = {
    timeout: () => { throw fail('timeout'); },
    refused: () => { throw fail('refused'); },
    blocked_address: () => { throw fail('blocked_address'); },
    too_large: () => { throw fail('too_large'); },
    redirect: () => { throw fail('redirect'); },
    network: () => { throw new Error('ECONNRESET with stack and http://leak'); },
  };
  const responses = {
    redirect: () => ({ status: 302, headers: { location: 'http://evil' }, text: '' }),
    bad_status: () => json({ ok: true }, { status: 500 }),
    bad_content_type: () => ({ status: 200, headers: { 'Content-Type': 'text/html' }, text: '{"ok":true}' }),
    bad_json: () => ({ status: 200, headers: { 'content-type': 'application/json' }, text: '{nope' }),
    bad_shape: () => json({ ok: 'yes' }),
    too_large: () => json({ ok: true }, { text: 'x'.repeat(70000) }),
  };
  const all = { ...Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, v])), ...responses };
  for (const [code, impl] of Object.entries(all)) {
    const fed = createFederation({
      peers: ['https://bad.example', ...peers],
      fetchPeer: async (req) => (req.url.startsWith('https://bad') ? impl() : json({ ok: true })),
    });
    const out = await fed.health();
    assert.deepEqual(out.summary, { total: 2, up: 1, down: 1 }, code);
    assert.equal(out.peers[0].ok, false, code);
    assert.equal(out.peers[0].error, code, code);
    assert.equal(out.peers[1].ok, true, code);
    assert.ok(!JSON.stringify(out).includes('leak') && !JSON.stringify(out).includes('secret'), code);
  }
});

test('health is cached for ttlMs and concurrent callers share one in-flight check', async () => {
  const c = clock();
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const fed = createFederation({
    peers: ['https://a.example'], now: c.now, ttlMs: 5000,
    fetchPeer: async () => { calls++; await gate; return json({ ok: true }); },
  });
  const p1 = fed.health();
  const p2 = fed.health();
  release();
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  c.t += 4999;
  assert.equal(await fed.health(), a);
  assert.equal(calls, 1);
  c.t += 1;
  await fed.health();
  assert.equal(calls, 2);
});

test('health failure is cached too, so polling cannot amplify', async () => {
  const c = clock();
  let calls = 0;
  const fed = createFederation({ peers: ['https://a.example'], now: c.now, fetchPeer: async () => { calls++; throw fail('timeout'); } });
  const a = await fed.health();
  await fed.health();
  assert.equal(calls, 1);
  assert.equal(a.peers[0].error, 'timeout');
});

test('hello posts the fixed body to /hello on every peer and returns only whitelisted fields', async () => {
  const seen = [];
  const fed = createFederation({
    peers: ['https://a.example', 'https://b.example', 'https://c.example'],
    fetchPeer: async (req) => {
      seen.push(req);
      if (req.url.startsWith('https://a')) return json({ greeting: 'Hola, Ada!', visit: 2, streak: 2, certificate: { id: 'zz' }, name: 'x' });
      if (req.url.startsWith('https://b')) return json({ message: 'Hello World! Welcome to the API.' });
      throw fail('timeout');
    },
  });
  const out = await fed.hello({ name: 'Ada', language: 'es', tone: 'formal' });
  assert.deepEqual(out.summary, { total: 3, ok: 1, failed: 2 });
  assert.deepEqual(out.results[0], { origin: 'https://a.example', ok: true, latencyMs: out.results[0].latencyMs, greeting: 'Hola, Ada!', visit: 2, streak: 2 });
  assert.equal(out.results[1].error, 'bad_shape');
  assert.equal(out.results[2].error, 'timeout');
  for (const r of seen) {
    assert.equal(r.method, 'POST');
    assert.ok(r.url.endsWith('/hello'));
    assert.equal(r.headers['content-type'], 'application/json');
    assert.equal(r.headers['x-hello-federation'], '1');
    assert.deepEqual(JSON.parse(r.body), { name: 'Ada', language: 'es', tone: 'formal' });
    assert.equal(r.maxBytes, 65536);
  }
});

test('hello treats non-200, wrong content type and hostile greetings as per-peer failures', async () => {
  const fed = createFederation({
    peers: ['https://a.example', 'https://b.example', 'https://c.example', 'https://d.example'],
    fetchPeer: async (req) => {
      if (req.url.startsWith('https://a')) return json({ greeting: 'x' }, { status: 201 });
      if (req.url.startsWith('https://b')) return { status: 200, headers: {}, text: '{"greeting":"x"}' };
      if (req.url.startsWith('https://c')) return json({ greeting: 'y'.repeat(5000) });
      return json({ greeting: 'a\u0000<b>' });
    },
  });
  const out = await fed.hello({ name: 'Ada' });
  assert.deepEqual(out.results.map((r) => r.error), ['bad_status', 'bad_content_type', 'bad_shape', undefined]);
  assert.equal(out.results[3].greeting, 'a<b>');
  assert.deepEqual(out.summary, { total: 4, ok: 1, failed: 3 });
});

test('a malformed fetchPeer result is a network error, not a throw', async () => {
  const fed = createFederation({ peers: ['https://a.example'], fetchPeer: async () => undefined });
  assert.equal((await fed.health()).peers[0].error, 'network');
});

test('peer count is capped at 8 in createFederation', async () => {
  const peers = Array.from({ length: 12 }, (_, i) => `https://p${i}.example`);
  const fed = createFederation({ peers, fetchPeer: async () => json({ ok: true }) });
  assert.equal((await fed.health()).summary.total, 8);
});

// ---- defaultFetchPeer against real local servers ----

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}
const close = (s) => new Promise((r) => { s.closeAllConnections(); s.close(r); });

test('defaultFetchPeer talks to a real local server when private peers are allowed', async () => {
  const requests = [];
  const { server, origin } = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(req.url === '/healthz' ? '{"ok":true}' : '{"greeting":"Hola, Ada!","visit":3,"streak":1,"certificate":"x"}');
    });
  });
  try {
    const fed = createFederation({ peers: [origin], fetchPeer: defaultFetchPeer({ allowPrivate: true }) });
    const h = await fed.health();
    assert.deepEqual(h.summary, { total: 1, up: 1, down: 0 });
    const out = await fed.hello({ name: 'Ada', language: 'es', tone: 'formal' });
    assert.equal(out.results[0].greeting, 'Hola, Ada!');
    assert.equal(out.results[0].certificate, undefined);
    assert.equal(requests[0].headers['user-agent'], 'hello-overkill-federation');
    assert.equal(requests[0].headers.connection, 'close');
    assert.equal(requests[1].method, 'POST');
    assert.equal(requests[1].headers['x-hello-federation'], '1');
    assert.deepEqual(JSON.parse(requests[1].body), { name: 'Ada', language: 'es', tone: 'formal' });
  } finally { await close(server); }
});

test('defaultFetchPeer refuses loopback unless allowPrivate and never connects', async () => {
  let hit = 0;
  const { server, origin } = await listen((req, res) => { hit++; res.end('{}'); });
  try {
    await assert.rejects(defaultFetchPeer()({ url: `${origin}/healthz` }), { code: 'blocked_address' });
    await assert.rejects(defaultFetchPeer({ allowPrivate: false })({ url: 'http://[::1]:9/healthz' }), { code: 'blocked_address' });
    assert.equal(hit, 0);
  } finally { await close(server); }
});

test('defaultFetchPeer vets every resolved address and pins the connection to the vetted one', async () => {
  const { server, origin } = await listen((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); });
  const port = new URL(origin).port;
  try {
    const mixed = async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }];
    await assert.rejects(defaultFetchPeer({ lookup: mixed })({ url: `http://peer.test:${port}/healthz` }), { code: 'blocked_address' });
    let lookups = 0;
    const once = async (host, opts) => { lookups++; assert.equal(host, 'peer.test'); assert.equal(opts.all, true); return [{ address: '127.0.0.1', family: 4 }]; };
    const r = await defaultFetchPeer({ allowPrivate: true, lookup: once })({ url: `http://peer.test:${port}/healthz` });
    assert.equal(r.status, 200);
    assert.equal(r.text, '{"ok":true}');
    assert.equal(lookups, 1);
    const none = async () => [];
    await assert.rejects(defaultFetchPeer({ lookup: none })({ url: 'http://x.test/' }), { code: 'network' });
    const nx = async () => { throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' }); };
    await assert.rejects(defaultFetchPeer({ lookup: nx })({ url: 'http://x.test/' }), { code: 'network' });
  } finally { await close(server); }
});

test('defaultFetchPeer rejects redirects without following them', async () => {
  let followed = 0;
  const { server, origin } = await listen((req, res) => {
    if (req.url === '/target') { followed++; res.end('{}'); return; }
    res.writeHead(302, { location: '/target' });
    res.end();
  });
  try {
    await assert.rejects(defaultFetchPeer({ allowPrivate: true })({ url: `${origin}/healthz` }), { code: 'redirect' });
    assert.equal(followed, 0);
  } finally { await close(server); }
});

test('defaultFetchPeer aborts with too_large once the cap is exceeded', async () => {
  const { server, origin } = await listen((req, res) => {
    if (req.url === '/declared') { res.setHeader('content-length', '70000'); res.end('x'.repeat(70000)); return; }
    res.write('x'.repeat(40000));
    res.write('x'.repeat(40000));
    res.write('x'.repeat(40000)); // chunked, no content-length
    res.end();
  });
  try {
    const f = defaultFetchPeer({ allowPrivate: true });
    await assert.rejects(f({ url: `${origin}/declared` }), { code: 'too_large' });
    await assert.rejects(f({ url: `${origin}/chunked` }), { code: 'too_large' });
    const ok = await f({ url: `${origin}/chunked`, maxBytes: 200000 });
    assert.equal(ok.text.length, 120000);
  } finally { await close(server); }
});

test('defaultFetchPeer times out on a hanging peer within the deadline', async () => {
  const { server, origin } = await listen(() => { /* never answers */ });
  try {
    const t0 = Date.now();
    await assert.rejects(defaultFetchPeer({ allowPrivate: true })({ url: `${origin}/healthz`, timeoutMs: 150 }), { code: 'timeout' });
    assert.ok(Date.now() - t0 < 1000);
  } finally { await close(server); }
});

test('defaultFetchPeer times out when DNS hangs', async () => {
  const hang = () => new Promise(() => {});
  await assert.rejects(defaultFetchPeer({ lookup: hang })({ url: 'http://slow.test/', timeoutMs: 100 }), { code: 'timeout' });
});

test('defaultFetchPeer maps a closed port to refused and bad urls to network', async () => {
  const { server, origin } = await listen(() => {});
  await close(server);
  await assert.rejects(defaultFetchPeer({ allowPrivate: true })({ url: `${origin}/healthz` }), { code: 'refused' });
  await assert.rejects(defaultFetchPeer()({ url: 'ftp://x.test/' }), { code: 'network' });
  await assert.rejects(defaultFetchPeer()({ url: 'nope' }), { code: 'network' });
  await assert.rejects(defaultFetchPeer()({}), { code: 'network' });
});

test('defaultFetchPeer maps a connection dropped mid-response to network', async () => {
  const { server, origin } = await listen((req, res) => {
    res.writeHead(200, { 'content-length': '100' });
    res.write('abc');
    setTimeout(() => res.socket.destroy(), 20);
  });
  try {
    await assert.rejects(defaultFetchPeer({ allowPrivate: true })({ url: `${origin}/healthz` }), { code: 'network' });
  } finally { await close(server); }
});

test('parsePeers warns once per non-loopback http peer and never for https or loopback', () => {
  const w = [];
  const out = parsePeers('http://example.com,https://secure.example.com,http://localhost:3000,http://127.0.0.1:4000,http://[::1]:5000,http://10.1.2.3', { warn: (m) => w.push(m) });
  assert.equal(out.length, 6);
  assert.equal(w.length, 2);
  assert.ok(w[0].includes('http://example.com') && /plain http/.test(w[0]));
  assert.ok(w[1].includes('http://10.1.2.3'));
  const none = [];
  parsePeers('https://a.example.com,http://localhost:1', { warn: (m) => none.push(m) });
  assert.deepEqual(none, []);
});
