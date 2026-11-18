'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withServer, CORE_BODY, hello } = require('./helpers');

const TEAPOT = { error: 'teapot', message: 'The greeter spilled its tea (418).' };

test('POST /hello?chaos=418 always returns 418 with the teapot body', () => withServer(async (s) => {
  for (let i = 0; i < 3; i += 1) {
    const r = await s.call('POST', '/hello?chaos=418', { name: 'Ada' });
    assert.equal(r.status, 418);
    assert.deepEqual(r.body, TEAPOT);
  }
  assert.equal((await s.call('POST', '/hello?chaos=418')).status, 418, 'also for the core call');
}));

test('chaos 418 leaves the store untouched', () => withServer(async (s) => {
  await s.call('POST', '/hello?chaos=418', { name: 'Ada' });
  assert.equal((await hello(s, { name: 'Ada' })).body.visit, 1);
}));

test('POST /hello?chaos=delay waits 2 to 4 seconds then answers normally', () => withServer(async (s) => {
  const t0 = Date.now();
  const r = await s.call('POST', '/hello?chaos=delay', { name: 'Ada' });
  const ms = Date.now() - t0;
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'Ada');
  assert.ok(ms >= 1900, `answered after ${ms}ms`);
  assert.ok(ms < 5000, `answered after ${ms}ms`);
}));

test('chaos=1 yields only 200 or 418 and unknown chaos values are ignored', () => withServer(async (s) => {
  const seen = new Set();
  for (let i = 0; i < 12; i += 1) {
    const t0 = Date.now();
    const r = await Promise.race([s.call('POST', '/hello?chaos=1'), new Promise((_, rej) => setTimeout(() => rej(new Error('chaos=1 took over 6s')), 6000))]);
    assert.ok([200, 418].includes(r.status), String(r.status));
    if (r.status === 200) assert.equal(r.text, CORE_BODY);
    else assert.deepEqual(r.body, TEAPOT);
    seen.add(r.status);
    void t0;
  }
  for (const v of ['0', 'true', 'yes', 'ALWAYS418', '']) {
    const r = await s.call('POST', `/hello?chaos=${v}`);
    assert.equal(r.status, 200, v);
    assert.equal(r.text, CORE_BODY);
  }
}), { timeout: 60000 });

test('429 after the limit carries retry-after, the polite message and a matching retryAfter', () => withServer(async (s) => {
  for (let i = 0; i < 3; i += 1) assert.equal((await s.call('POST', '/hello')).status, 200);
  const r = await s.call('POST', '/hello', { name: 'Ada' });
  assert.equal(r.status, 429);
  assert.match(r.headers.get('retry-after'), /^[1-9]\d*$/);
  assert.match(r.headers.get('content-type'), /^application\/json/);
  assert.equal(r.body.error, "You've been greeted enough.");
  assert.equal(r.body.retryAfter, Number(r.headers.get('retry-after')));
  assert.ok(r.body.retryAfter <= 60);
}, { env: { HELLO_RATE_LIMIT: 3 } }));

test('the hello rate limit covers every method, ignores X-Forwarded-For and spares other routes', () => withServer(async (s) => {
  await s.call('GET', '/hello');
  await s.call('PUT', '/hello');
  await s.call('POST', '/hello');
  const spoofed = await s.call('POST', '/hello', undefined, undefined, { 'x-forwarded-for': '203.0.113.9' });
  assert.equal(spoofed.status, 429);
  assert.equal((await s.call('GET', '/hello')).status, 429);
  for (const [m, u] of [['GET', '/healthz'], ['GET', '/'], ['GET', '/api/catalogue'], ['GET', '/api/battle'], ['GET', '/api/leaderboard']]) {
    assert.equal((await s.call(m, u)).status, 200, u);
  }
  assert.equal((await s.call('POST', '/api/verify', { text: 'x' })).status, 200);
}, { env: { HELLO_RATE_LIMIT: 3 } }));

test('a chaos 418 still consumes a rate-limit hit', () => withServer(async (s) => {
  assert.equal((await s.call('POST', '/hello?chaos=418')).status, 418);
  assert.equal((await s.call('POST', '/hello?chaos=418')).status, 418);
  assert.equal((await s.call('POST', '/hello')).status, 429);
}, { env: { HELLO_RATE_LIMIT: 2 } }));

test('the default rate limit is 10 hellos per minute', () => withServer(async (s) => {
  for (let i = 0; i < 10; i += 1) assert.equal((await s.call('POST', '/hello')).status, 200, `hit ${i + 1}`);
  assert.equal((await s.call('POST', '/hello')).status, 429);
}, { env: { HELLO_RATE_LIMIT: null } }));

test('POST /hello over 16 KB is rejected with 413 and a close', () => withServer(async (s) => {
  const body = JSON.stringify({ name: 'Ada', pad: 'x'.repeat(20000) });
  const r = await s.rawRequest('POST', '/hello', { headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, body });
  assert.equal(r.status, 413);
  assert.deepEqual(r.body, { error: 'request body too large' });
  assert.equal(r.headers.connection, 'close');
  assert.equal((await s.call('POST', '/hello')).text, CORE_BODY, 'server still healthy');
}));

test('a streamed body over 16 KB without content-length is also 413, and the limit applies to /api/verify', () => withServer(async (s) => {
  const big = 'x'.repeat(17000);
  const chunked = await s.rawRequest('POST', '/hello', { headers: { 'transfer-encoding': 'chunked' }, body: big });
  assert.equal(chunked.status, 413);
  const v = await s.rawRequest('POST', '/api/verify', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: big }) });
  assert.equal(v.status, 413);
}));

test('a body just under the cap is still accepted', () => withServer(async (s) => {
  const body = JSON.stringify({ name: 'Ada', pad: 'x'.repeat(15000) });
  const r = await s.call('POST', '/hello', undefined, body);
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'Ada');
}));
