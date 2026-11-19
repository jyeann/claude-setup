'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withServer } = require('./helpers');

test('unknown paths return 404 JSON {"error":"not found"}', () => withServer(async (s) => {
  for (const p of ['/nope', '/api', '/api/nope', '/hello/extra', '/healthz/x', '/index.html', '/api/certificates']) {
    const r = await s.call('GET', p);
    assert.equal(r.status, 404, p);
    assert.equal(r.text, '{"error":"not found"}', p);
    assert.match(r.headers.get('content-type'), /^application\/json/);
  }
  assert.equal((await s.call('POST', '/nope')).status, 404);
}));

test('malformed request targets starting with // return 404', () => withServer(async (s) => {
  for (const p of ['//evil.example/x', '//']) {
    const r = await s.rawRequest('GET', p);
    assert.equal(r.status, 404, p);
    assert.deepEqual(r.body, { error: 'not found' });
  }
}));

test('a single trailing slash is stripped on known routes', () => withServer(async (s) => {
  assert.deepEqual((await s.call('GET', '/healthz/')).body, { ok: true });
  assert.equal((await s.call('GET', '/api/catalogue/')).status, 200);
}));

test('wrong methods on known paths return 405 with an allow header', () => withServer(async (s) => {
  const cases = [['POST', '/', 'GET'], ['POST', '/healthz', 'GET'], ['DELETE', '/api/catalogue', 'GET'], ['POST', '/api/battle', 'GET'], ['GET', '/api/verify', 'POST'], ['GET', '/api/battle/vote', 'POST'], ['POST', '/api/leaderboard', 'GET'], ['PUT', '/api/verify', 'POST']];
  for (const [m, p, allowed] of cases) {
    const r = await s.call(m, p);
    assert.equal(r.status, 405, `${m} ${p}`);
    assert.ok((r.headers.get('allow') || '').includes(allowed), `${m} ${p} allow=${r.headers.get('allow')}`);
    assert.equal(typeof r.body.error, 'string');
  }
}));

test('GET /healthz returns {"ok":true}', () => withServer(async (s) => {
  const r = await s.call('GET', '/healthz');
  assert.equal(r.status, 200);
  assert.equal(r.text, '{"ok":true}');
  assert.match(r.headers.get('content-type'), /^application\/json/);
}));

test('JSON responses carry security headers and no CORS headers', () => withServer(async (s) => {
  for (const [m, p] of [['GET', '/healthz'], ['POST', '/hello'], ['GET', '/nope'], ['GET', '/api/catalogue'], ['POST', '/healthz']]) {
    const r = await s.call(m, p);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer', p);
    assert.equal(r.headers.get('access-control-allow-origin'), null, p);
  }
}));

test('malformed JSON bodies on API routes never leak stack traces or exception text', () => withServer(async (s) => {
  for (const [p, raw] of [['/api/verify', '{"text":'], ['/api/battle/vote', '{{{'], ['/hello', '\u0000\u0001']]) {
    const r = await s.call('POST', p, undefined, raw);
    assert.ok(r.status < 500, p);
    assert.ok(!/SyntaxError|Unexpected token|\bat .*\.js|node_modules/.test(r.text), r.text);
  }
}));
