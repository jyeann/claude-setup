'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createRouter } = require('../src/router');
const { createStore } = require('../src/store');
const { createRateLimiter } = require('../src/rate-limiter');
const { createSigner } = require('../src/certificates');
const page = require('../src/page');

async function boot() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-gz-')), 'd.json');
  const server = http.createServer(createRouter({
    store: createStore(file, undefined, () => {}),
    limiter: createRateLimiter({ limit: 1000, windowMs: 60000 }),
    voteLimiter: createRateLimiter({ limit: 60, windowMs: 60000 }),
    signer: createSigner('unit'),
  }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const get = (p, headers = {}) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  return { get, close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
}
async function withApp(fn) { const app = await boot(); try { await fn(app); } finally { await app.close(); } }

test('GET / is gzipped for clients that accept gzip, with a correct length and the same page', () => withApp(async ({ get }) => {
  const r = await get('/', { 'accept-encoding': 'gzip, deflate, br' });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-encoding'], 'gzip');
  assert.equal(Number(r.headers['content-length']), r.body.length);
  assert.equal(zlib.gunzipSync(r.body).toString('utf8'), page.html);
  assert.ok(r.body.length < Buffer.byteLength(page.html) / 2, 'gzip at least halves the page');
}));

test('GET / without accept-encoding is sent uncompressed and byte-identical', () => withApp(async ({ get }) => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-encoding'], undefined);
  assert.equal(r.body.toString('utf8'), page.html);
  assert.equal(Number(r.headers['content-length']), Buffer.byteLength(page.html));
}));

test('both page variants carry vary, etag, no-cache and the unchanged security headers', () => withApp(async ({ get }) => {
  for (const headers of [{}, { 'accept-encoding': 'gzip' }]) {
    const r = await get('/', headers);
    assert.match(r.headers.vary, /accept-encoding/i);
    assert.match(r.headers.etag, /^"[A-Za-z0-9_-]+"$/);
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.ok(r.headers['content-security-policy'].includes(page.scriptHash));
    assert.ok(r.headers['content-security-policy'].includes(page.styleHash));
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
  }
}));

test('a matching If-None-Match gets 304 with no body; a stale one gets the page', () => withApp(async ({ get }) => {
  const first = await get('/', { 'accept-encoding': 'gzip' });
  const again = await get('/', { 'accept-encoding': 'gzip', 'if-none-match': first.headers.etag });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
  assert.equal(again.headers.etag, first.headers.etag);
  assert.equal(again.headers['x-content-type-options'], 'nosniff');
  const stale = await get('/', { 'if-none-match': '"stale"' });
  assert.equal(stale.status, 200);
  assert.equal(stale.body.toString('utf8'), page.html);
}));

test('API responses are not compressed', () => withApp(async ({ get }) => {
  const r = await get('/healthz', { 'accept-encoding': 'gzip' });
  assert.equal(r.headers['content-encoding'], undefined);
  assert.equal(r.body.toString(), '{"ok":true}');
}));
