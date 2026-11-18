'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startServer, tmpFile } = require(require('node:path').join(process.cwd(), 'acceptance', 'helpers.js'));
const withServer = async (fn, file = tmpFile()) => { const s = await startServer(file); try { await fn(s, file); } finally { await s.stop(); } };

test('reserved slugs api and healthz are rejected', () => withServer(async (s) => {
  for (const slug of ['api', 'healthz']) assert.equal((await s.call('POST', '/api/links', { url: 'https://a.test', slug })).status, 400, slug);
}));
test('slug length boundaries: 3 and 32 accepted, 2 and 33 rejected', () => withServer(async (s) => {
  assert.equal((await s.call('POST', '/api/links', { url: 'https://a.test', slug: 'abc' })).status, 201);
  assert.equal((await s.call('POST', '/api/links', { url: 'https://a.test', slug: 'x'.repeat(32) })).status, 201);
  assert.equal((await s.call('POST', '/api/links', { url: 'https://a.test', slug: 'ab' })).status, 400);
  assert.equal((await s.call('POST', '/api/links', { url: 'https://a.test', slug: 'x'.repeat(33) })).status, 400);
}));
test('slugs are case-sensitive', () => withServer(async (s) => {
  assert.equal((await s.call('POST', '/api/links', { url: 'https://a.test', slug: 'Abc' })).status, 201);
  assert.equal((await s.call('POST', '/api/links', { url: 'https://b.test', slug: 'abc' })).status, 201);
  assert.equal((await s.call('GET', '/Abc')).headers.get('location'), 'https://a.test');
}));
test('ftp and mailto urls are rejected, http is accepted', () => withServer(async (s) => {
  for (const url of ['ftp://a.test/x', 'mailto:a@b.test', 'HTTP://A.TEST/']) {
    const r = await s.call('POST', '/api/links', { url });
    assert.equal(r.status, url.startsWith('HTTP') ? 201 : 400, url);
  }
}));
test('a url over 2048 chars is rejected', () => withServer(async (s) => {
  assert.equal((await s.call('POST', '/api/links', { url: 'https://a.test/' + 'x'.repeat(2040) })).status, 400);
}));
test('an expired link answers 410, does not count the click, and stays listed as expired', () => withServer(async (s) => {
  await s.call('POST', '/api/links', { url: 'https://a.test', slug: 'soon', expiresAt: new Date(Date.now() + 1200).toISOString() });
  assert.equal((await s.call('GET', '/soon')).status, 302);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((await s.call('GET', '/soon')).status, 410);
  const one = await s.call('GET', '/api/links/soon');
  assert.equal(one.body.expired, true);
  assert.equal(one.body.clicks, 1);
  assert.equal((await s.call('DELETE', '/api/links/soon')).status, 204);
}));
test('a body over 10 KB gets 413', () => withServer(async (s) => {
  const r = await s.call('POST', '/api/links', { url: 'https://a.test', pad: 'x'.repeat(11000) });
  assert.equal(r.status, 413);
}));
test('click counts accumulate across a restart', async () => {
  const file = tmpFile();
  await withServer(async (s) => { await s.call('POST', '/api/links', { url: 'https://a.test', slug: 'cnt' }); await s.call('GET', '/cnt'); await s.call('GET', '/cnt'); }, file);
  await withServer(async (s) => { await s.call('GET', '/cnt'); assert.equal((await s.call('GET', '/api/links/cnt')).body.clicks, 3); }, file);
});
