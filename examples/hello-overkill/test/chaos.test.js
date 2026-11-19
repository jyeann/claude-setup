'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideChaos } = require('../src/chaos');

test('418 always yields teapot', () => {
  assert.deepEqual(decideChaos('418', () => 0.99), { kind: 'teapot', ms: 0 });
});

test('delay yields 2000..4000 ms from random', () => {
  assert.deepEqual(decideChaos('delay', () => 0), { kind: 'delay', ms: 2000 });
  assert.deepEqual(decideChaos('delay', () => 0.9999), { kind: 'delay', ms: 4000 });
  assert.equal(decideChaos('delay', () => 0.5).ms, 3000);
});

test('1 splits by thirds: teapot, delay, none', () => {
  assert.equal(decideChaos('1', () => 0.1).kind, 'teapot');
  assert.equal(decideChaos('1', () => 0.5).kind, 'delay');
  assert.equal(decideChaos('1', () => 0.9).kind, 'none');
  const seq = [0.4, 0.5];
  assert.deepEqual(decideChaos('1', () => seq.shift()), { kind: 'delay', ms: 3000 });
});

test('absent or other values mean none and do not consume random', () => {
  let calls = 0;
  const r = () => { calls += 1; return 0; };
  for (const v of [undefined, null, '', '0', 'true', 'DELAY', '418 ']) assert.deepEqual(decideChaos(v, r), { kind: 'none', ms: 0 });
  assert.equal(calls, 0);
});
