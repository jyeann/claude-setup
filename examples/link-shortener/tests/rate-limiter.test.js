'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter } = require('../src/rate-limiter');

test('allows up to the limit then blocks the next hit with retryAfter', () => {
  let t = 1000;
  const rl = createRateLimiter({ limit: 3, windowMs: 60000, now: () => t });
  for (let i = 0; i < 3; i += 1) assert.equal(rl.check('a').allowed, true);
  const r = rl.check('a');
  assert.equal(r.allowed, false);
  assert.equal(r.retryAfter, 60);
});

test('allows again once the window has passed', () => {
  let t = 0;
  const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
  assert.equal(rl.check('a').allowed, true);
  t = 999;
  assert.equal(rl.check('a').allowed, false);
  t = 1000;
  assert.equal(rl.check('a').allowed, true);
});

test('tracks clients independently', () => {
  const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 5 });
  assert.equal(rl.check('a').allowed, true);
  assert.equal(rl.check('b').allowed, true);
  assert.equal(rl.check('a').allowed, false);
});

test('retryAfter rounds up to whole seconds and is at least 1', () => {
  let t = 0;
  const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
  rl.check('a');
  t = 400;
  assert.equal(rl.check('a').retryAfter, 1);
  const rl2 = createRateLimiter({ limit: 1, windowMs: 2500, now: () => t });
  t = 0;
  rl2.check('a');
  assert.equal(rl2.check('a').retryAfter, 3);
});

test('defaults to 30 hits per minute', () => {
  const rl = createRateLimiter();
  for (let i = 0; i < 30; i += 1) assert.equal(rl.check('x').allowed, true);
  assert.equal(rl.check('x').allowed, false);
});

test('stale keys are evicted and the key count stays under the cap', () => {
  const { createRateLimiter } = require('../src/rate-limiter');
  let t = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, maxKeys: 3, now: () => t });
  for (const k of ['a', 'b', 'c']) limiter.check(k);
  assert.equal(limiter.size(), 3);
  t = 5000;
  limiter.check('d');
  assert.equal(limiter.size(), 1);
  for (const k of ['e', 'f', 'g', 'h']) limiter.check(k);
  assert.ok(limiter.size() <= 3);
});
