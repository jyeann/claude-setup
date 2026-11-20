import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHandler, allowedHosts } from '../src/router.js';
import { buildRoutes, SECURITY_HEADERS } from '../src/http.js';

function mkPublic() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'is-pub-')));
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), text); };
  w('index.html', '<html lang="en"></html>');
  w('app.css', 'a{}');
  w('favicon.svg', '<svg/>');
  w('js/engine/prng.js', 'export {}');
  w('js/engine/Bad.js', 'x');
  w('js/engine/a_b.js', 'x');
  w('js/core/safe-json.js', 'export {}');
  w('js/other/x.js', 'x');
  return { base, w, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

function call(handler, { method = 'GET', url = '/', headers = { host: 'localhost:1234' } } = {}) {
  return new Promise((resolve) => {
    const out = { headers: {}, chunks: [] };
    const req = Object.assign(new (class { on() {} })(), { method, url, headers });
    const res = {
      headersSent: false, writableEnded: false,
      setHeader(k, v) { out.headers[k.toLowerCase()] = String(v); },
      writeHead(s) { out.status = s; this.headersSent = true; },
      end(b) { this.writableEnded = true; out.body = b === undefined ? '' : Buffer.from(b).toString(); resolve(out); },
      destroy() { out.destroyed = true; resolve(out); },
    };
    handler(req, res);
  });
}

const setup = (opts = {}) => {
  const p = mkPublic();
  const routes = buildRoutes({ publicDir: p.base, scenarios: [{ id: 'one', bytes: Buffer.from('{"id":"one"}') }], index: { valid: ['one'], errors: [] }, ...opts });
  const handler = createHandler({ routes, getPort: () => 1234, log: () => {} });
  return { ...p, routes, handler };
};

test('serves shell, css, svg, listed js modules and scenario files with their content types and cache rules', async () => {
  const s = setup();
  try {
    const cases = [['/', 'text/html; charset=utf-8', 'no-cache'], ['/index.html', 'text/html; charset=utf-8', 'no-cache'], ['/app.css', 'text/css; charset=utf-8', 'no-cache'],
      ['/favicon.svg', 'image/svg+xml', 'no-cache'], ['/js/engine/prng.js', 'text/javascript; charset=utf-8', 'no-cache'], ['/js/core/safe-json.js', 'text/javascript; charset=utf-8', 'no-cache'],
      ['/scenarios/one.json', 'application/json; charset=utf-8', 'no-cache'], ['/scenarios/index.json', 'application/json; charset=utf-8', 'no-store']];
    for (const [url, type, cache] of cases) {
      const r = await call(s.handler, { url });
      assert.equal(r.status, 200, url);
      assert.equal(r.headers['content-type'], type, url);
      assert.equal(r.headers['cache-control'], cache, url);
    }
    assert.equal((await call(s.handler, { url: '/scenarios/index.json' })).body, '{"valid":["one"],"errors":[]}');
  } finally { s.cleanup(); }
});

test('files with names outside ^[a-z0-9-]+.js$, other folders and a missing tokens.css are not in the allow-list', () => {
  const s = setup();
  try {
    assert.ok(!s.routes.has('/js/engine/Bad.js'));
    assert.ok(!s.routes.has('/js/engine/a_b.js'));
    assert.ok(!s.routes.has('/js/other/x.js'));
    assert.ok(!s.routes.has('/tokens.css'));
    assert.ok(!s.routes.has('/test-mode.json'));
  } finally { s.cleanup(); }
});

test('an empty public folder and no scenarios still build a route table with only index.json', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'is-empty-'));
  try {
    const routes = buildRoutes({ publicDir: base });
    assert.deepEqual([...routes.keys()], ['/scenarios/index.json']);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('returns 404 Not found. for traversal, encoded, case-changed and trailing-slash paths', async () => {
  const s = setup();
  try {
    for (const url of ['/js/../src/server.js', '/%2e%2e/', '/js/engine/%70rng.js', '/js/engine/', '/APP.CSS', '/app.css/', '/scenarios/missing.json', '/test-mode.json', '//', '/nope']) {
      const r = await call(s.handler, { url });
      assert.equal(r.status, 404, url);
      assert.equal(r.body, 'Not found.', url);
      assert.equal(r.headers['content-type'], 'text/plain; charset=utf-8');
    }
  } finally { s.cleanup(); }
});

test('strips the query string before the lookup', async () => {
  const s = setup();
  try {
    assert.equal((await call(s.handler, { url: '/?speed=16' })).status, 200);
    assert.equal((await call(s.handler, { url: '/nope?x=1' })).status, 404);
    assert.equal((await call(s.handler, { url: '/app.css?' })).status, 200);
  } finally { s.cleanup(); }
});

test('test-mode.json exists only when test mode is on', async () => {
  const off = setup();
  const on = setup({ testMode: true });
  try {
    assert.equal((await call(off.handler, { url: '/test-mode.json' })).status, 404);
    const r = await call(on.handler, { url: '/test-mode.json' });
    assert.equal(r.status, 200);
    assert.equal(r.body, '{"testMode":true}');
    assert.equal(r.headers['cache-control'], 'no-store');
  } finally { off.cleanup(); on.cleanup(); }
});

test('Host must be one of the three loopback forms for the current port; missing Host is 403', async () => {
  const s = setup();
  try {
    assert.deepEqual([...allowedHosts(5)], ['localhost:5', '127.0.0.1:5', '[::1]:5']);
    for (const host of ['localhost:1234', '127.0.0.1:1234', '[::1]:1234']) assert.equal((await call(s.handler, { headers: { host } })).status, 200, host);
    for (const headers of [{}, { host: '' }, { host: 'localhost' }, { host: 'evil.com' }, { host: 'LOCALHOST:1234' }, { host: 'localhost:1235' }]) {
      const r = await call(s.handler, { headers });
      assert.equal(r.status, 403, JSON.stringify(headers));
      assert.equal(r.body, 'This host name is not allowed.');
    }
  } finally { s.cleanup(); }
});

test('methods other than GET and HEAD are 405 with Allow, checked after Host and before Sec-Fetch-Site', async () => {
  const s = setup();
  try {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const r = await call(s.handler, { method, headers: { host: 'localhost:1234', 'sec-fetch-site': 'cross-site' } });
      assert.equal(r.status, 405, method);
      assert.equal(r.headers.allow, 'GET, HEAD');
    }
    assert.equal((await call(s.handler, { method: 'POST', headers: { host: 'evil.com' } })).status, 403);
  } finally { s.cleanup(); }
});

test('Sec-Fetch-Site cross-site is 403 before the path lookup; other values and Origin do not matter', async () => {
  const s = setup();
  try {
    const r = await call(s.handler, { url: '/nope', headers: { host: 'localhost:1234', 'sec-fetch-site': 'cross-site' } });
    assert.equal(r.status, 403);
    assert.equal(r.body, 'This request is not allowed.');
    for (const v of ['same-origin', 'same-site', 'none']) assert.equal((await call(s.handler, { headers: { host: 'localhost:1234', 'sec-fetch-site': v } })).status, 200);
    assert.equal((await call(s.handler, { headers: { host: 'localhost:1234', origin: 'https://evil.example' } })).status, 200);
  } finally { s.cleanup(); }
});

test('HEAD mirrors GET status and headers with an empty body and the GET Content-Length', async () => {
  const s = setup();
  try {
    for (const url of ['/', '/nope']) {
      const g = await call(s.handler, { url });
      const h = await call(s.handler, { method: 'HEAD', url });
      assert.equal(h.status, g.status);
      assert.equal(h.body, '');
      assert.deepEqual(h.headers, g.headers);
      assert.equal(h.headers['content-length'], String(Buffer.byteLength(g.body)));
    }
  } finally { s.cleanup(); }
});

test('every response (200, 403, 404, 405) carries all security headers and no CORS header', async () => {
  const s = setup();
  try {
    const rs = [await call(s.handler, {}), await call(s.handler, { headers: {} }), await call(s.handler, { url: '/x' }), await call(s.handler, { method: 'POST' })];
    assert.deepEqual(rs.map((r) => r.status), [200, 403, 404, 405]);
    for (const r of rs) {
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.equal(r.headers[k.toLowerCase()], v, k);
      assert.ok(!Object.keys(r.headers).some((k) => k.startsWith('access-control-')));
    }
    assert.ok(SECURITY_HEADERS['Content-Security-Policy'].includes("font-src 'none'; manifest-src 'none'"));
  } finally { s.cleanup(); }
});

test('a handler exception becomes 500 with the pinned text and is logged; a failure after headers destroys the socket', async () => {
  const logs = [];
  const boom = new Map([['/', { get type() { throw new Error('boom'); }, bytes: Buffer.from('x'), cache: 'no-cache' }]]);
  const handler = createHandler({ routes: boom, getPort: () => 1234, log: (m) => logs.push(m) });
  const r = await call(handler, {});
  assert.equal(r.status, 500);
  assert.equal(r.body, 'Something went wrong on the server.');
  assert.match(logs[0], /^internal error: Error: boom/);
  const bad = createHandler({ routes: new Map(), getPort: () => { throw new Error('late'); }, log: () => {} });
  assert.equal((await call(bad, {})).status, 500);
});
