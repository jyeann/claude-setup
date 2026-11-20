'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { acceptsGzip, prepareAsset, etagMatches } = require('../src/compress');

test('acceptsGzip is false when the header is missing or empty', () => {
  assert.equal(acceptsGzip(undefined), false);
  assert.equal(acceptsGzip(''), false);
  assert.equal(acceptsGzip('identity'), false);
});

test('acceptsGzip accepts gzip listed plainly or with a positive q', () => {
  assert.equal(acceptsGzip('gzip'), true);
  assert.equal(acceptsGzip('gzip, deflate, br'), true);
  assert.equal(acceptsGzip('br;q=1.0, GZIP;q=0.5'), true);
  assert.equal(acceptsGzip('x-gzip'), true);
});

test('acceptsGzip refuses gzip with q=0 even when a wildcard allows others', () => {
  assert.equal(acceptsGzip('gzip;q=0'), false);
  assert.equal(acceptsGzip('gzip; q=0.000, *'), false);
  assert.equal(acceptsGzip('*;q=0'), false);
});

test('acceptsGzip honours a positive wildcard when gzip is not named', () => {
  assert.equal(acceptsGzip('*'), true);
  assert.equal(acceptsGzip('br, *;q=0.1'), true);
});

test('acceptsGzip ignores malformed q values instead of throwing', () => {
  assert.equal(acceptsGzip('gzip;q=abc'), false);
  assert.equal(acceptsGzip(';;,,gzip'), true);
});

test('prepareAsset precomputes an identity body, a gzip body that round-trips, and a strong etag', () => {
  const a = prepareAsset('<p>héllo</p>'.repeat(50));
  assert.ok(Buffer.isBuffer(a.identity) && Buffer.isBuffer(a.gzip));
  assert.equal(zlib.gunzipSync(a.gzip).toString('utf8'), '<p>héllo</p>'.repeat(50));
  assert.ok(a.gzip.length < a.identity.length);
  assert.match(a.etag, /^"[A-Za-z0-9_-]{22,}"$/);
  assert.equal(prepareAsset('<p>héllo</p>'.repeat(50)).etag, a.etag);
  assert.notEqual(prepareAsset('other').etag, a.etag);
});

test('etagMatches handles exact, listed, weak and wildcard If-None-Match values', () => {
  const tag = '"abc"';
  assert.equal(etagMatches(undefined, tag), false);
  assert.equal(etagMatches('"abc"', tag), true);
  assert.equal(etagMatches('"x", "abc"', tag), true);
  assert.equal(etagMatches('W/"abc"', tag), true);
  assert.equal(etagMatches('*', tag), true);
  assert.equal(etagMatches('"abcd"', tag), false);
});
