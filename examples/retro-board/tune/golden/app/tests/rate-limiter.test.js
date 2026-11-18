'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLimiter } = require('../src/rate-limiter');

test('allows up to the limit per key then refuses with a Retry-After', () => {
  let t = 1000;
  const l = createLimiter({ limit: 2, windowMs: 60000, now: () => t });
  assert.equal(l.hit('a').ok, true);
  assert.equal(l.hit('a').ok, true);
  const third = l.hit('a');
  assert.equal(third.ok, false);
  assert.equal(third.retryAfter, 60);
  assert.equal(l.hit('b').ok, true);
});

test('a new window resets the count', () => {
  let t = 0;
  const l = createLimiter({ limit: 1, windowMs: 1000, now: () => t });
  l.hit('a');
  assert.equal(l.hit('a').ok, false);
  t = 1000;
  assert.equal(l.hit('a').ok, true);
});

test('expired keys are swept once the map grows past maxKeys', () => {
  let t = 0;
  const l = createLimiter({ limit: 5, windowMs: 10, now: () => t, maxKeys: 3 });
  for (const k of ['a', 'b', 'c', 'd']) l.hit(k);
  assert.equal(l.size(), 4);
  t = 100;
  l.hit('e');
  assert.equal(l.size(), 1);
});
