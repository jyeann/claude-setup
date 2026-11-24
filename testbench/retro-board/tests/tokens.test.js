'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const t = require('../src/tokens');

test('newToken returns 22 URL-safe characters and never repeats', () => {
  const a = t.newToken();
  assert.match(a, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(a, t.newToken());
  assert.equal(t.isToken(a), true);
});

test('sha256 helpers return stable hex and base64url digests', () => {
  assert.equal(t.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(t.sha256B64('abc').length, 43);
  assert.match(t.sha256B64('abc'), /^[A-Za-z0-9_-]+$/);
});

test('safeEqual compares equal and unequal strings of any length', () => {
  assert.equal(t.safeEqual('same', 'same'), true);
  assert.equal(t.safeEqual('same', 'sam'), false);
  assert.equal(t.safeEqual('', 'x'), false);
});

test('isToken and isClientId reject wrong length, characters and types', () => {
  for (const bad of ['', 'short', 'a'.repeat(23), `${'a'.repeat(21)}!`, null, undefined, 42, ['a'.repeat(22)]]) {
    assert.equal(t.isToken(bad), false, String(bad));
    assert.equal(t.isClientId(bad), false, String(bad));
  }
  assert.equal(t.isClientId('A-_'.repeat(7) + 'B'), true);
});
