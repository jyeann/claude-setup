'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateUrl, validateSlug, validateExpiresAt, validateCreate } = require('../src/validation');

test('validateUrl accepts http and https urls in any scheme case', () => {
  assert.equal(validateUrl('http://a.test'), null);
  assert.equal(validateUrl('https://a.test/p?q=1'), null);
  assert.equal(validateUrl('HTTPS://a.test'), null);
});

test('validateUrl rejects other protocols, relative urls and non-strings', () => {
  for (const u of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'ftp://a.test', '/rel', 'a.test', '', 5, null, undefined]) {
    assert.equal(typeof validateUrl(u), 'string', String(u));
  }
});

test('validateUrl allows exactly 2048 chars and rejects 2049', () => {
  const base = 'https://a.test/';
  assert.equal(validateUrl(base + 'x'.repeat(2048 - base.length)), null);
  assert.equal(typeof validateUrl(base + 'x'.repeat(2049 - base.length)), 'string');
});

test('validateUrl rejects whitespace inside the url', () => {
  assert.equal(typeof validateUrl('https://a.test/a b'), 'string');
  assert.equal(typeof validateUrl('https://a.test/\r\nx'), 'string');
});

test('validateSlug enforces length boundaries 3 and 32', () => {
  assert.equal(validateSlug('ab'), 'slug must be 3-32 characters of A-Z, a-z, 0-9, _ or -');
  assert.equal(validateSlug('abc'), null);
  assert.equal(validateSlug('x'.repeat(32)), null);
  assert.equal(typeof validateSlug('x'.repeat(33)), 'string');
});

test('validateSlug rejects bad characters and non-strings', () => {
  for (const s of ['has space', 'a/b', 'dot.dot', 'üüü', 5, null]) assert.equal(typeof validateSlug(s), 'string', String(s));
  assert.equal(validateSlug('A-b_9'), null);
});

test('validateSlug rejects reserved slugs but is case-sensitive', () => {
  assert.equal(validateSlug('api'), 'slug is reserved');
  assert.equal(validateSlug('healthz'), 'slug is reserved');
  assert.equal(validateSlug('API'), null);
});

test('validateExpiresAt accepts only future ISO dates', () => {
  const now = Date.parse('2030-01-01T00:00:00Z');
  assert.equal(validateExpiresAt('2030-01-01T00:00:01Z', now), null);
  assert.equal(typeof validateExpiresAt('2030-01-01T00:00:00Z', now), 'string');
  assert.equal(typeof validateExpiresAt('2000-01-01T00:00:00Z', now), 'string');
  assert.equal(typeof validateExpiresAt('tomorrow-ish', now), 'string');
  assert.equal(typeof validateExpiresAt(12345, now), 'string');
  assert.equal(typeof validateExpiresAt('2031-13-45T00:00:00Z', now), 'string');
});

test('validateCreate rejects non-object bodies and passes a minimal one', () => {
  for (const b of [null, [], 'x', 5]) assert.equal(validateCreate(b), 'body must be a JSON object');
  assert.equal(validateCreate({ url: 'https://a.test' }), null);
  assert.equal(validateCreate({ url: 'https://a.test', slug: 'abc', expiresAt: '2999-01-01T00:00:00Z' }), null);
  assert.equal(typeof validateCreate({ url: 'https://a.test', slug: 'ab' }), 'string');
  assert.equal(typeof validateCreate({ url: 'https://a.test', expiresAt: '2000-01-01T00:00:00Z' }), 'string');
});

test('validateExpiresAt rejects days that do not exist in their month and accepts real ones', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(typeof validateExpiresAt('2030-02-31', now), 'string');
  assert.equal(typeof validateExpiresAt('2030-04-31T10:00:00Z', now), 'string');
  assert.equal(typeof validateExpiresAt('2030-13-01', now), 'string');
  assert.equal(validateExpiresAt('2028-02-29', now), null);
  assert.equal(validateExpiresAt('2030-02-28T10:00:00Z', now), null);
});
