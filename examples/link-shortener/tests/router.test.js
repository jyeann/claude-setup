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

async function withApp(fn, store) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'router-')), 'links.json');
  const route = createRouter({ store: store || createStore(file), limiter: createRateLimiter({ limit: 30, windowMs: 60000 }) });
  const server = http.createServer((req, res) => { route(req, res).catch(() => { res.writeHead(500); res.end(); }); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
}
const json = (base, p, method, body) => fetch(base + p, { method, redirect: 'manual', headers: { 'content-type': 'application/json' }, body });

test('a request target starting with // is not routed to a different path', () => withApp(async (base) => {
  await json(base, '/api/links', 'POST', JSON.stringify({ url: 'https://a.test', slug: 'abc' }));
  const res = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: new URL(base).port, path: '//example.com/abc' }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); });
    req.end();
  });
  assert.equal(res, 404);
  assert.equal((await (await fetch(`${base}/api/links/abc`)).json()).clicks, 0);
}));

test('a chunked body over 10 KB is rejected with 413', () => withApp(async (base) => {
  const big = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"url":"https://a.test","pad":"' + 'x'.repeat(12000) + '"}')); c.close(); } });
  const res = await fetch(`${base}/api/links`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: big, duplex: 'half' });
  assert.equal(res.status, 413);
}));

test('a wrong method on a known path returns 405 with an Allow header', () => withApp(async (base) => {
  const res = await json(base, '/api/links', 'PUT');
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, POST');
  assert.equal((await json(base, '/healthz', 'DELETE')).headers.get('allow'), 'GET');
}));

test('a malformed percent-encoded slug returns 404 instead of failing', () => withApp(async (base) => {
  assert.equal((await json(base, '/%E0%A4%A', 'GET')).status, 404);
  assert.equal((await json(base, '/api/links/%E0%A4%A', 'GET')).status, 404);
}));

test('every response, including errors, carries the security headers', () => withApp(async (base) => {
  for (const p of ['/', '/nope', '/healthz', '/api/links']) {
    const res = await fetch(base + p);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', p);
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/, p);
    await res.arrayBuffer();
  }
}));

test('a redirect to a non-ASCII url uses the normalised href in Location', () => withApp(async (base) => {
  await json(base, '/api/links', 'POST', JSON.stringify({ url: 'https://exämple.test/pfad', slug: 'uni' }));
  const res = await json(base, '/uni', 'GET');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://xn--exmple-cua.test/pfad');
}));
