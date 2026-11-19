'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { startServer, withServer, tmpFile, startStub, sendJson, goodPeerHandler, sleep, FED_ENV } = require('./helpers-v2');

const FED = (s) => s.call('GET', '/api/federation');
const FH = (s, q = '?name=Ada') => s.call('GET', `/api/federation/hello${q}`);
const ERRORS = ['timeout', 'refused', 'blocked_address', 'too_large', 'redirect', 'bad_status', 'bad_content_type', 'bad_json', 'bad_shape', 'network'];

// Runs fn with a real peer server (another hello-overkill) and a main server pointing at it.
async function withPair(fn, mainOpts = {}) {
  const peer = await startServer(tmpFile(), { env: { HELLO_RATE_LIMIT: '1000' } });
  try {
    await withServer((main) => fn(main, peer), { ...FED_ENV(peer.base, mainOpts.env || {}), ...(mainOpts.file ? { file: mainOpts.file } : {}) });
  } finally { await peer.stop(); }
}

// Finds a TCP port nobody listens on.
const closedPort = () => new Promise((resolve) => { const srv = net.createServer(); srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); }); });

test('federation: no peers configured gives 200 with the empty shape', () => withServer(async (s) => {
  const r = await FED(s);
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, false);
  assert.deepEqual(r.body.summary, { total: 0, up: 0, down: 0 });
  assert.deepEqual(r.body.peers, []);
  const h = await FH(s);
  assert.equal(h.status, 200);
  assert.equal(h.body.configured, false);
  assert.deepEqual(h.body.results, []);
}, { env: { HELLO_PEERS: null, HELLO_READ_LIMIT: '10000' } }));

test('federation: a real peer shows up healthy with latency and its allowlisted origin', () => withPair(async (main, peer) => {
  const r = await FED(main);
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, true);
  assert.deepEqual(r.body.summary, { total: 1, up: 1, down: 0 });
  assert.ok(!Number.isNaN(Date.parse(r.body.checkedAt)));
  assert.equal(r.body.peers[0].origin, peer.base);
  assert.equal(r.body.peers[0].ok, true);
  assert.equal(typeof r.body.peers[0].latencyMs, 'number');
  assert.match(r.headers.get('content-type'), /^application\/json/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
}));

test('federation: hello fans out to a real peer, which records the visit, and main does not', () => withPair(async (main, peer) => {
  const a = await FH(main, '?name=Ada&language=es&tone=pirate');
  assert.equal(a.status, 200);
  assert.deepEqual(a.body.summary, { total: 1, ok: 1, failed: 0 });
  const res = a.body.results[0];
  assert.equal(res.ok, true);
  assert.equal(res.origin, peer.base);
  assert.ok(res.greeting.includes('Ada'));
  assert.equal(res.visit, 1);
  assert.equal(res.streak, 1);
  assert.equal(typeof res.latencyMs, 'number');
  assert.equal((await FH(main, '?name=Ada')).body.results[0].visit, 2, 'not cached: peer sees a second visit');
  assert.equal((await peer.call('POST', '/hello', { name: 'Ada' })).body.visit, 3);
  assert.equal((await main.call('POST', '/hello', { name: 'Ada' })).body.visit, 1, 'the local greeting is not part of the fan-out');
  assert.ok(!('certificate' in res));
}));

test('federation: the results never include the peer certificate or any non-whitelisted key', () => withPair(async (main) => {
  const res = (await FH(main)).body.results[0];
  for (const k of Object.keys(res)) assert.ok(['origin', 'ok', 'latencyMs', 'greeting', 'visit', 'streak', 'error'].includes(k), k);
  assert.ok(!JSON.stringify(res).includes('signature'));
}));

test('federation: hello validates name, language and tone locally before any peer is contacted', async () => {
  const stub = await startStub(goodPeerHandler);
  try {
    await withServer(async (s) => {
      for (const q of ['', '?name=', `?name=${'a'.repeat(41)}`, '?name=bad%07name', '?name=Ada&language=xx', '?name=Ada&tone=nope']) {
        const r = await FH(s, q);
        assert.equal(r.status, 400, q);
        assert.equal(typeof r.body.error, 'string');
      }
      assert.equal(stub.hits.length, 0);
    }, FED_ENV(stub.origin));
  } finally { await stub.close(); }
});

test('federation: peers receive the documented request (POST /hello, json body, federation headers)', async () => {
  const stub = await startStub(goodPeerHandler);
  try {
    await withServer(async (s) => {
      await FH(s, '?name=Ada&language=fr&tone=pirate');
      await FH(s, '?name=Bo');
      const [first, second] = stub.hits;
      assert.equal(first.method, 'POST');
      assert.equal(first.url, '/hello');
      assert.match(first.headers['content-type'], /^application\/json/);
      assert.equal(first.headers['x-hello-federation'], '1');
      assert.equal(first.headers['user-agent'], 'hello-overkill-federation');
      assert.deepEqual(JSON.parse(first.body), { name: 'Ada', language: 'fr', tone: 'pirate' });
      assert.deepEqual(JSON.parse(second.body), { name: 'Bo', language: 'en', tone: 'formal' });
      await FED(s);
      const health = stub.hits.find((h) => h.url === '/healthz');
      assert.equal(health.method, 'GET');
      assert.equal(health.headers['user-agent'], 'hello-overkill-federation');
      assert.ok(stub.hits.every((h) => h.url === '/hello' || h.url === '/healthz'), 'paths are fixed');
    }, FED_ENV(stub.origin));
  } finally { await stub.close(); }
});

test('federation: health results are cached for about 5 s, hello results are not', async () => {
  const stub = await startStub(goodPeerHandler);
  try {
    await withServer(async (s) => {
      for (let i = 0; i < 3; i += 1) assert.equal((await FED(s)).status, 200);
      assert.equal(stub.count('/healthz'), 1);
      await FH(s); await FH(s);
      assert.equal(stub.count('/hello'), 2);
    }, FED_ENV(stub.origin));
  } finally { await stub.close(); }
});

test('federation: concurrent health callers share one in-flight peer request', async () => {
  const stub = await startStub((req, res) => setTimeout(() => sendJson(res, 200, { ok: true }), 300));
  try {
    await withServer(async (s) => {
      const rs = await Promise.all(Array.from({ length: 6 }, () => FED(s)));
      for (const r of rs) assert.equal(r.body.summary.up, 1);
      assert.equal(stub.count('/healthz'), 1);
    }, FED_ENV(stub.origin));
  } finally { await stub.close(); }
});

test('federation: a peer that refuses the connection is isolated as "refused"', async () => {
  const port = await closedPort();
  const stub = await startStub(goodPeerHandler);
  try {
    await withServer(async (s) => {
      const r = await FED(s);
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.summary, { total: 2, up: 1, down: 1 });
      assert.equal(r.body.peers[0].origin, `http://127.0.0.1:${port}`);
      assert.deepEqual([r.body.peers[0].ok, r.body.peers[0].error], [false, 'refused']);
      assert.equal(r.body.peers[1].ok, true);
    }, FED_ENV([`http://127.0.0.1:${port}`, stub.origin]));
  } finally { await stub.close(); }
});

test('federation: redirects are not followed (error "redirect")', async () => {
  const target = await startStub(goodPeerHandler);
  const redir = await startStub((req, res) => { res.writeHead(302, { location: `${target.origin}${req.url}`, 'content-length': 0 }); res.end(); });
  try {
    await withServer(async (s) => {
      for (const r of [(await FED(s)).body.peers[0], (await FH(s)).body.results[0]]) assert.deepEqual([r.ok, r.error], [false, 'redirect']);
      assert.equal(target.hits.length, 0, 'the redirect target was never contacted');
    }, FED_ENV(redir.origin));
  } finally { await redir.close(); await target.close(); }
});

test('federation: an oversized (70 KB) response is cut off as "too_large"', async () => {
  const big = await startStub((req, res) => { const text = JSON.stringify({ ok: true, greeting: 'x'.repeat(70 * 1024) }); res.writeHead(200, { 'content-type': 'application/json' }); res.end(text); });
  try {
    await withServer(async (s) => {
      assert.equal((await FED(s)).body.peers[0].error, 'too_large');
      assert.equal((await FH(s)).body.results[0].error, 'too_large');
    }, FED_ENV(big.origin));
  } finally { await big.close(); }
});

test('federation: an endless response is cut off as "too_large" without hanging', async () => {
  const stream = await startStub((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    const t = setInterval(() => { if (res.destroyed) return clearInterval(t); return res.write('x'.repeat(8192)); }, 5);
    res.on('close', () => clearInterval(t));
  });
  try {
    await withServer(async (s) => {
      const t0 = Date.now();
      const r = await FED(s);
      assert.equal(r.body.peers[0].error, 'too_large');
      assert.ok(Date.now() - t0 < 3000);
    }, FED_ENV(stream.origin));
  } finally { await stream.close(); }
});

test('federation: a peer that hangs times out in under 1.7 s without delaying a good peer', async () => {
  const hang = await startStub(() => { /* never answers */ });
  const good = await startStub(goodPeerHandler);
  try {
    await withServer(async (s) => {
      const t0 = Date.now();
      const r = await FED(s);
      const took = Date.now() - t0;
      assert.ok(took < 2500, `took ${took} ms`);
      assert.deepEqual([r.body.peers[0].ok, r.body.peers[0].error], [false, 'timeout']);
      assert.ok(r.body.peers[0].latencyMs >= 1000 && r.body.peers[0].latencyMs < 1900, `latency ${r.body.peers[0].latencyMs}`);
      assert.equal(r.body.peers[1].ok, true);
      assert.ok(r.body.peers[1].latencyMs < 1000);
      const h = await FH(s);
      assert.equal(h.body.results[0].error, 'timeout');
      assert.equal(h.body.results[1].ok, true);
    }, FED_ENV([hang.origin, good.origin]));
  } finally { await hang.close(); await good.close(); }
});

test('federation: garbage responses map to the documented error codes, one peer at a time', async () => {
  const cases = {
    status: [(req, res) => sendJson(res, 500, { ok: true }), 'bad_status'],
    html: [(req, res) => sendJson(res, 200, '<html>hi</html>', 'text/html'), 'bad_content_type'],
    notjson: [(req, res) => sendJson(res, 200, 'not json {'), 'bad_json'],
    notok: [(req, res) => sendJson(res, 200, { ok: false }), 'bad_shape'],
    stringok: [(req, res) => sendJson(res, 200, { ok: 'true' }), 'bad_shape'],
    array: [(req, res) => sendJson(res, 200, [{ ok: true }]), 'bad_shape'],
  };
  const stubs = {};
  for (const [k, [h]] of Object.entries(cases)) stubs[k] = await startStub(h);
  const good = await startStub(goodPeerHandler);
  try {
    const order = [...Object.keys(cases)];
    await withServer(async (s) => {
      const r = await FED(s);
      assert.equal(r.status, 200);
      order.forEach((k, i) => { assert.equal(r.body.peers[i].ok, false, k); assert.equal(r.body.peers[i].error, cases[k][1], k); assert.equal(r.body.peers[i].origin, stubs[k].origin); });
      assert.equal(r.body.peers[order.length].ok, true, 'the good peer is unaffected');
      assert.deepEqual(r.body.summary, { total: order.length + 1, up: 1, down: order.length });
      assert.ok(r.body.peers.every((p) => p.ok || ERRORS.includes(p.error)));
    }, FED_ENV([...order.map((k) => stubs[k].origin), good.origin]));
  } finally { for (const st of [...Object.values(stubs), good]) await st.close(); }
});

test('federation: hello validates peer responses (core body, garbage, wrong type, bad status)', async () => {
  const cases = [
    [(req, res) => sendJson(res, 200, { message: 'Hello World! Welcome to the API.' }), 'bad_shape'],
    [(req, res) => sendJson(res, 200, { greeting: 42 }), 'bad_shape'],
    [(req, res) => sendJson(res, 200, { greeting: '' }), 'bad_shape'],
    [(req, res) => sendJson(res, 200, { greeting: 'hi' }, 'text/plain'), 'bad_content_type'],
    [(req, res) => sendJson(res, 200, 'nope{'), 'bad_json'],
    [(req, res) => sendJson(res, 400, { error: 'x' }), 'bad_status'],
  ];
  const stubs = [];
  for (const [h] of cases) stubs.push(await startStub(h));
  const good = await startStub(goodPeerHandler);
  try {
    await withServer(async (s) => {
      const r = await FH(s);
      assert.equal(r.status, 200);
      cases.forEach(([, want], i) => assert.deepEqual([r.body.results[i].ok, r.body.results[i].error], [false, want], `case ${i}`));
      assert.equal(r.body.results[cases.length].ok, true);
      assert.equal(r.body.results[cases.length].greeting, 'Hola, Ada!');
      assert.deepEqual(r.body.summary, { total: cases.length + 1, ok: 1, failed: cases.length });
    }, FED_ENV([...stubs.map((x) => x.origin), good.origin]));
  } finally { for (const st of [...stubs, good]) await st.close(); }
});

test('federation: hostile peer data is whitelisted and stripped (script text stays plain data)', async () => {
  const evil = await startStub((req, res) => sendJson(res, 200, {
    greeting: '<script>alert(1)</script>\u0000\u0007hi​!', visit: 3, streak: 2,
    certificate: { id: 'x', signature: 'y' }, origin: 'http://evil.example', ok: true, nested: { a: { b: 1 } }, __proto__x: 1,
  }));
  try {
    await withServer(async (s) => {
      const res = (await FH(s)).body.results[0];
      assert.equal(res.ok, true);
      assert.equal(res.origin, evil.origin, 'origin comes from the allowlist, not peer data');
      assert.ok(res.greeting.includes('<script>alert(1)</script>'));
      assert.ok(!/[\u0000-\u001f\u007f​]/.test(res.greeting), JSON.stringify(res.greeting));
      assert.deepEqual(Object.keys(res).sort(), ['greeting', 'latencyMs', 'ok', 'origin', 'streak', 'visit']);
    }, FED_ENV(evil.origin));
  } finally { await evil.close(); }
});

test('federation: a 1 MB greeting is refused as too_large and never relayed', async () => {
  const huge = await startStub((req, res) => sendJson(res, 200, { greeting: 'A'.repeat(1024 * 1024) }));
  try {
    await withServer(async (s) => {
      const r = await FH(s);
      assert.equal(r.body.results[0].error, 'too_large');
      assert.ok(r.text.length < 2000);
    }, FED_ENV(huge.origin));
  } finally { await huge.close(); }
});

test('federation: error responses never leak raw peer text, urls or stack traces', async () => {
  const leaky = await startStub((req, res) => sendJson(res, 500, { error: 'SECRET-INTERNAL at /var/app/server.js:12 stack trace' }));
  const port = await closedPort();
  try {
    await withServer(async (s) => {
      const text = (await FED(s)).text + (await FH(s)).text;
      assert.ok(!/SECRET-INTERNAL|stack|\/var\/app|ECONNREFUSED|at Object/.test(text), text);
      assert.ok(!text.includes('/healthz') && !text.includes('/hello"'), 'no urls');
    }, FED_ENV([leaky.origin, `http://127.0.0.1:${port}`]));
  } finally { await leaky.close(); }
});

test('federation: user-supplied URLs are impossible (no query parameter selects or adds a peer)', async () => {
  const attacker = await startStub(goodPeerHandler);
  const good = await startStub(goodPeerHandler);
  try {
    await withServer(async (s) => {
      const evil = encodeURIComponent(attacker.origin);
      const qs = `peer=${evil}&peers=${evil}&url=${evil}&origin=${evil}&target=${evil}&host=${evil}&u=${evil}`;
      const a = await s.call('GET', `/api/federation?${qs}`);
      const b = await s.call('GET', `/api/federation/hello?name=Ada&${qs}`);
      const c = await s.call('POST', `/api/federation/hello?name=Ada&${qs}`, { url: attacker.origin, peer: attacker.origin });
      assert.deepEqual(a.body.peers.map((p) => p.origin), [good.origin]);
      assert.deepEqual(b.body.results.map((p) => p.origin), [good.origin]);
      assert.equal(c.status, 405);
      assert.equal(attacker.hits.length, 0, 'attacker origin never contacted');
      for (const h of ['x-forwarded-host', 'host', 'x-peer', 'x-origin']) await s.call('GET', '/api/federation', undefined, undefined, { [h]: attacker.origin.replace('http://', '') });
      assert.equal(attacker.hits.length, 0);
    }, FED_ENV(good.origin));
  } finally { await attacker.close(); await good.close(); }
});

test('federation: with no peers configured a supplied url is still never contacted', async () => {
  const attacker = await startStub(goodPeerHandler);
  try {
    await withServer(async (s) => {
      const r = await s.call('GET', `/api/federation?url=${encodeURIComponent(attacker.origin)}&peer=${encodeURIComponent(attacker.origin)}`);
      assert.equal(r.body.configured, false);
      assert.deepEqual(r.body.peers, []);
      await s.call('GET', `/api/federation/hello?name=Ada&peer=${encodeURIComponent(attacker.origin)}`);
      assert.equal(attacker.hits.length, 0);
    }, { env: { HELLO_PEERS: null, HELLO_READ_LIMIT: '10000' } });
  } finally { await attacker.close(); }
});

test('federation: without HELLO_PEERS_ALLOW_PRIVATE a loopback peer is refused (blocked_address) and never contacted', async () => {
  const stub = await startStub(goodPeerHandler);
  try {
    await withServer(async (s) => {
      const h = await FED(s);
      assert.equal(h.status, 200);
      assert.deepEqual([h.body.peers[0].ok, h.body.peers[0].error], [false, 'blocked_address']);
      assert.deepEqual(h.body.summary, { total: 1, up: 0, down: 1 });
      const r = await FH(s);
      assert.deepEqual([r.body.results[0].ok, r.body.results[0].error], [false, 'blocked_address']);
      assert.equal(stub.hits.length, 0, 'no connection was made');
    }, { env: { HELLO_PEERS: stub.origin, HELLO_PEERS_ALLOW_PRIVATE: null, HELLO_READ_LIMIT: '10000', HELLO_FED_LIMIT: '1000' } });
  } finally { await stub.close(); }
});

test('federation: private, loopback, link-local, metadata and mapped-IPv6 hosts are blocked by default', async () => {
  const hosts = ['http://127.0.0.2:9', 'http://localhost:9', 'http://10.0.0.1:9', 'http://172.16.5.5:9', 'http://192.168.1.1:9', 'http://169.254.169.254', 'http://100.64.0.1:9', 'http://0.0.0.0:9', 'http://[::1]:9', 'http://[::ffff:127.0.0.1]:9', 'http://[fe80::1]:9', 'http://[fd00::1]:9'];
  await withServer(async (s) => {
    const t0 = Date.now();
    const r = await FED(s);
    assert.ok(Date.now() - t0 < 2500, 'blocked peers fail fast without connecting');
    assert.equal(r.body.peers.length, 8, 'peer list is capped at 8');
    for (const p of r.body.peers) assert.deepEqual([p.ok, p.error], [false, 'blocked_address'], p.origin);
  }, { env: { HELLO_PEERS: hosts.join(','), HELLO_PEERS_ALLOW_PRIVATE: null, HELLO_READ_LIMIT: '10000' } });
  await withServer(async (s) => {
    const r = await FED(s);
    const origins = r.body.peers.map((p) => p.origin);
    assert.ok(origins.includes('http://169.254.169.254'));
    for (const p of r.body.peers) assert.equal(p.error, 'blocked_address', p.origin);
  }, { env: { HELLO_PEERS: 'http://169.254.169.254,http://[::ffff:127.0.0.1]:9,http://localhost:9', HELLO_PEERS_ALLOW_PRIVATE: null, HELLO_READ_LIMIT: '10000' } });
});

test('federation: ALLOW_PRIVATE logs a startup warning on stderr', async () => {
  const stub = await startStub(goodPeerHandler);
  try {
    const s = await startServer(tmpFile(), FED_ENV(stub.origin));
    try { assert.match(s.stderr(), /PEERS_ALLOW_PRIVATE|private/i); } finally { await s.stop(); }
  } finally { await stub.close(); }
});

test('federation: HELLO_PEERS parsing keeps order, drops duplicates and invalid entries without echoing them', async () => {
  const a = await startStub(goodPeerHandler);
  const b = await startStub(goodPeerHandler);
  try {
    const entries = [b.origin, 'ftp://127.0.0.1:9', 'http://user:pw@127.0.0.1:9', `${a.origin}/some/path`, `${a.origin}?x=1`, `${a.origin}#frag`, 'not a url', 'http://secret-host.invalid.example:9/zzz', `${a.origin}/`, a.origin, b.origin.toUpperCase().replace('HTTP', 'http')];
    const s = await startServer(tmpFile(), FED_ENV(entries));
    try {
      const r = await s.call('GET', '/api/federation');
      assert.deepEqual(r.body.peers.map((p) => p.origin), [b.origin, a.origin]);
      assert.deepEqual(r.body.summary, { total: 2, up: 2, down: 0 });
      assert.ok(!/secret-host|user:pw|pw@/.test(s.stderr()), 'warnings name the entry index, not its content');
      assert.ok(s.stderr().length > 0, 'a warning was logged for dropped entries');
    } finally { await s.stop(); }
  } finally { await a.close(); await b.close(); }
});

test('federation: at most 8 peers are used', async () => {
  const ports = [];
  for (let i = 0; i < 10; i += 1) ports.push(await closedPort());
  await withServer(async (s) => {
    const r = await FED(s);
    assert.equal(r.body.peers.length, 8);
    assert.deepEqual(r.body.peers.map((p) => p.origin), ports.slice(0, 8).map((p) => `http://127.0.0.1:${p}`));
    assert.equal(r.body.summary.total, 8);
  }, FED_ENV(ports.map((p) => `http://127.0.0.1:${p}`)));
});

test('federation: GET/POST methods are enforced (405 with allow GET)', () => withServer(async (s) => {
  for (const p of ['/api/federation', '/api/federation/hello?name=Ada']) {
    const r = await s.call('POST', p, {});
    assert.equal(r.status, 405, p);
    assert.match(r.headers.get('allow'), /GET/);
  }
}, FED_ENV('')));

test('federation: hello is limited by its own per-client limiter (HELLO_FED_LIMIT)', async () => {
  const stub = await startStub(goodPeerHandler);
  try {
    await withServer(async (s) => {
      assert.equal((await FH(s)).status, 200);
      assert.equal((await FH(s)).status, 200);
      const r = await FH(s);
      assert.equal(r.status, 429);
      assert.ok(r.headers.get('retry-after'));
      assert.equal(stub.count('/hello'), 2, 'the limited request did not fan out');
    }, FED_ENV(stub.origin, { HELLO_FED_LIMIT: '2' }));
  } finally { await stub.close(); }
});

test('federation: the health route is rate limited per client (read or federation limiter)', () => withServer(async (s) => {
  await FED(s); await FED(s);
  assert.equal((await FED(s)).status, 429);
}, FED_ENV('', { HELLO_READ_LIMIT: '2', HELLO_FED_LIMIT: '2' })));

test('federation: v1 behaviour is unchanged on the main server (core hello byte-exact, /healthz)', async () => {
  const stub = await startStub(goodPeerHandler);
  try {
    await withServer(async (s) => {
      assert.equal((await s.call('POST', '/hello', {})).text, '{"message":"Hello World! Welcome to the API."}');
      assert.deepEqual((await s.call('GET', '/healthz')).body, { ok: true });
      await sleep(10);
      assert.equal(stub.hits.length, 0, 'core hello and healthz never fan out to peers');
    }, FED_ENV(stub.origin));
  } finally { await stub.close(); }
});
