'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter } = require('../src/rate-limiter');

test('allows up to limit hits then blocks with retryAfter', () => {
  let t = 1000;
  const rl = createRateLimiter({ limit: 2, windowMs: 60000, now: () => t });
  assert.deepEqual(rl.check('a'), { allowed: true });
  assert.deepEqual(rl.check('a'), { allowed: true });
  t += 1000;
  assert.deepEqual(rl.check('a'), { allowed: false, retryAfter: 59 });
});

test('allows again after the window slides past', () => {
  let t = 0;
  const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
  assert.equal(rl.check('a').allowed, true);
  assert.equal(rl.check('a').allowed, false);
  t = 1000;
  assert.equal(rl.check('a').allowed, true);
});

test('keys are independent', () => {
  const rl = createRateLimiter({ limit: 1, now: () => 5 });
  assert.equal(rl.check('a').allowed, true);
  assert.equal(rl.check('b').allowed, true);
  assert.equal(rl.check('a').allowed, false);
  assert.equal(rl.size(), 2);
});

test('retryAfter is at least 1 and sweeps cap tracked keys', () => {
  let t = 0;
  const rl = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 3, now: () => t });
  rl.check('a');
  t = 999;
  assert.equal(rl.check('a').retryAfter, 1);
  for (const k of ['b', 'c', 'd', 'e']) rl.check(k);
  assert.ok(rl.size() <= 3);
});

test('sweep of expired keys runs at most once per window', () => {
  let t = 0;
  const rl = createRateLimiter({ limit: 5, windowMs: 1000, maxKeys: 10, now: () => t });
  for (let i = 0; i < 10; i += 1) rl.check(`k${i}`);
  t = 1000; // all expired, first full-table sweep clears them
  rl.check('new');
  assert.equal(rl.size(), 1);
});

test('when full and nothing expired, evicts the oldest 10% in one batch', () => {
  const rl = createRateLimiter({ limit: 5, windowMs: 60000, maxKeys: 100, now: () => 5 });
  for (let i = 0; i < 100; i += 1) rl.check(`k${i}`);
  rl.check('x');
  assert.equal(rl.size(), 91);
  assert.equal(rl.check('k0').allowed, true); // evicted: starts fresh
  assert.equal(rl.size(), 92);
});

test('an existing key at capacity does not trigger eviction', () => {
  const rl = createRateLimiter({ limit: 5, windowMs: 60000, maxKeys: 3, now: () => 5 });
  for (const k of ['a', 'b', 'c']) rl.check(k);
  rl.check('a');
  assert.equal(rl.size(), 3);
});
