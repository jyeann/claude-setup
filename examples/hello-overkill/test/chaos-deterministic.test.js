'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideChaos } = require('../src/chaos');
const { mulberry32 } = require('../src/weather');

const seq = (...values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };

test('chaos=1 returns a teapot when the injected random is below one third', () => {
  for (const r of [0, 0.1, 0.3333]) assert.deepEqual(decideChaos('1', seq(r)), { kind: 'teapot', ms: 0 });
});

test('chaos=1 returns a 2000..4000 ms delay between one third and two thirds', () => {
  assert.deepEqual(decideChaos('1', seq(0.5, 0)), { kind: 'delay', ms: 2000 });
  assert.deepEqual(decideChaos('1', seq(0.5, 0.9999)), { kind: 'delay', ms: 4000 });
  assert.equal(decideChaos('1', seq(1 / 3, 0.5)).kind, 'delay');
});

test('chaos=1 answers normally at two thirds and above', () => {
  for (const r of [2 / 3, 0.7, 0.9999]) assert.deepEqual(decideChaos('1', seq(r)), { kind: 'none', ms: 0 });
});

test('chaos=1 outcomes are fully determined by a seeded random, with no timing dependence', () => {
  const kinds = (seed) => { const rnd = mulberry32(seed); return Array.from({ length: 30 }, () => decideChaos('1', rnd).kind); };
  assert.deepEqual(kinds(42), kinds(42));
  const all = new Set([...kinds(1), ...kinds(2), ...kinds(3)]);
  assert.deepEqual([...all].sort(), ['delay', 'none', 'teapot']);
});

test('chaos=418 and chaos=delay ignore the first draw semantics and unknown values are ignored', () => {
  assert.deepEqual(decideChaos('418', seq(0.99)), { kind: 'teapot', ms: 0 });
  assert.deepEqual(decideChaos('delay', seq(0)), { kind: 'delay', ms: 2000 });
  for (const v of [undefined, null, '', '0', 'true', 'ALWAYS418']) assert.deepEqual(decideChaos(v, seq(0)), { kind: 'none', ms: 0 });
});
