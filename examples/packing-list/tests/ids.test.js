'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newListId, LIST_ID_RE, ITEM_ID_RE } = require('../src/ids');

test('newListId returns 22 base64url characters and never repeats', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const id = newListId();
    assert.match(id, /^[A-Za-z0-9_-]{22}$/);
    seen.add(id);
  }
  assert.equal(seen.size, 200);
});

test('LIST_ID_RE accepts exactly 22 url-safe characters', () => {
  assert.ok(LIST_ID_RE.test('A'.repeat(22)));
  assert.ok(!LIST_ID_RE.test('A'.repeat(21)));
  assert.ok(!LIST_ID_RE.test('A'.repeat(23)));
  assert.ok(!LIST_ID_RE.test(`${'A'.repeat(21)}=`));
  assert.ok(!LIST_ID_RE.test(`${'A'.repeat(21)}\n`));
});

test('ITEM_ID_RE accepts 1 to 10 digits without a leading zero', () => {
  for (const ok of ['1', '9', '10', '1234567890']) assert.ok(ITEM_ID_RE.test(ok), ok);
  for (const bad of ['0', '01', '', '12345678901', '-1', '1.5', 'a', '1\n']) assert.ok(!ITEM_ID_RE.test(bad), bad);
});
