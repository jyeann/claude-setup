'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startServer, tmpFile } = require('./helpers');

const withServer = async (fn, file = tmpFile()) => { const s = await startServer(file); try { await fn(s, file); } finally { await s.stop(); } };

test('POST /api/links creates a link with generated 7-char slug, zero clicks and ISO createdAt', () => withServer(async (s) => {
  const r = await s.call('POST', '/api/links', { url: 'https://example.com/a?b=1' });
  assert.equal(r.status, 201);
  assert.match(r.body.slug, /^[a-z0-9]{7}$/);
  assert.equal(r.body.url, 'https://example.com/a?b=1');
  assert.equal(r.body.clicks, 0);
  assert.equal(r.body.expiresAt, null);
  assert.equal(r.body.expired, false);
  assert.equal(new Date(r.body.createdAt).toISOString(), r.body.createdAt);
}));

test('POST /api/links accepts a custom slug and rejects a taken one with 409', () => withServer(async (s) => {
  assert.equal((await s.call('POST', '/api/links', { url: 'https://a.test', slug: 'my-link_1' })).body.slug, 'my-link_1');
  const dup = await s.call('POST', '/api/links', { url: 'https://b.test', slug: 'my-link_1' });
  assert.equal(dup.status, 409);
  assert.equal(typeof dup.body.error, 'string');
}));

test('POST /api/links rejects non-http(s), relative, empty and non-string urls with 400', () => withServer(async (s) => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', '/relative', 'example.com', '', 5, null]) {
    const r = await s.call('POST', '/api/links', { url });
    assert.equal(r.status, 400, String(url));
    assert.equal(typeof r.body.error, 'string');
  }
  assert.equal((await s.call('POST', '/api/links', {})).status, 400);
  assert.equal((await s.call('POST', '/api/links', undefined, '{oops')).status, 400);
}));

test('POST /api/links rejects bad slugs with 400', () => withServer(async (s) => {
  for (const slug of ['ab', 'has space', 'bad/slash', 'dot.dot', 5, 'x'.repeat(33)]) {
    assert.equal((await s.call('POST', '/api/links', { url: 'https://a.test', slug })).status, 400, String(slug));
  }
}));

test('GET /:slug redirects with 302 and counts the click', () => withServer(async (s) => {
  await s.call('POST', '/api/links', { url: 'https://example.com/x', slug: 'go' });
  const hit = await s.call('GET', '/go');
  assert.equal(hit.status, 302);
  assert.equal(hit.headers.get('location'), 'https://example.com/x');
  await s.call('GET', '/go');
  assert.equal((await s.call('GET', '/api/links/go')).body.clicks, 2);
}));

test('GET /:slug is 404 for an unknown slug and does not create anything', () => withServer(async (s) => {
  assert.equal((await s.call('GET', '/nope')).status, 404);
  assert.deepEqual((await s.call('GET', '/api/links')).body, []);
}));

test('GET /api/links lists newest first and GET /api/links/:slug returns one or 404', () => withServer(async (s) => {
  await s.call('POST', '/api/links', { url: 'https://a.test', slug: 'first' });
  await new Promise((r) => setTimeout(r, 5));
  await s.call('POST', '/api/links', { url: 'https://b.test', slug: 'second' });
  assert.deepEqual((await s.call('GET', '/api/links')).body.map((l) => l.slug), ['second', 'first']);
  assert.equal((await s.call('GET', '/api/links/first')).body.url, 'https://a.test');
  assert.equal((await s.call('GET', '/api/links/missing')).status, 404);
}));

test('DELETE /api/links/:slug removes the link, then 404', () => withServer(async (s) => {
  await s.call('POST', '/api/links', { url: 'https://a.test', slug: 'gone' });
  const del = await s.call('DELETE', '/api/links/gone');
  assert.equal(del.status, 204);
  assert.equal(del.text, '');
  assert.equal((await s.call('GET', '/gone')).status, 404);
  assert.equal((await s.call('DELETE', '/api/links/gone')).status, 404);
}));

test('links and click counts survive a restart and are written to DATA_FILE', async () => {
  const file = tmpFile();
  await withServer(async (s) => {
    await s.call('POST', '/api/links', { url: 'https://a.test', slug: 'keep' });
    await s.call('GET', '/keep');
    assert.ok(fs.readFileSync(file, 'utf8').includes('keep'));
  }, file);
  await withServer(async (s) => {
    const r = await s.call('GET', '/api/links/keep');
    assert.equal(r.body.clicks, 1);
  }, file);
});

test('the server exits 0 on SIGTERM', async () => {
  const s = await startServer(tmpFile());
  const result = await s.stop();
  assert.equal(result.code, 0);
});

test('wrong method on a known path is 405 and unknown routes are 404 JSON', () => withServer(async (s) => {
  assert.equal((await s.call('PUT', '/api/links')).status, 405);
  assert.equal((await s.call('POST', '/healthz')).status, 405);
  const nf = await s.call('GET', '/api/nothing/here');
  assert.equal(nf.status, 404);
  assert.equal(typeof nf.body.error, 'string');
}));

test('GET /healthz returns ok', () => withServer(async (s) => {
  const r = await s.call('GET', '/healthz');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
}));

test('the 31st create in a minute gets 429 with Retry-After', () => withServer(async (s) => {
  for (let i = 0; i < 30; i += 1) assert.equal((await s.call('POST', '/api/links', { url: `https://a.test/${i}` })).status, 201);
  const r = await s.call('POST', '/api/links', { url: 'https://a.test/over' });
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
}));

test('GET / serves an html page with the create form and links table', () => withServer(async (s) => {
  const r = await s.call('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.text, /id="create-form"/);
  assert.match(r.text, /name="url"/);
  assert.match(r.text, /name="slug"/);
  assert.match(r.text, /id="links"/);
  assert.doesNotMatch(r.text, /innerHTML/);
}));

test('expiresAt in the past or not a date is rejected with 400, a future one is stored', () => withServer(async (s) => {
  assert.equal((await s.call('POST', '/api/links', { url: 'https://a.test', expiresAt: '2000-01-01T00:00:00Z' })).status, 400);
  assert.equal((await s.call('POST', '/api/links', { url: 'https://a.test', expiresAt: 'tomorrow-ish' })).status, 400);
  const future = new Date(Date.now() + 3600e3).toISOString();
  const ok = await s.call('POST', '/api/links', { url: 'https://a.test', expiresAt: future });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.expiresAt, future);
}));
