// engine/score.js: formula, tiers, vectors and boundaries (spec.md "engine/score.js", design.md section 8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mod } from './helpers.js';

const base = { result: 'resolved', timeToMitigate: 41, optimalTime: 35, budgetLeft: 4, budget: 6, optimalCost: 1, harmful: 0, hintUsed: false };
const sc = async (o) => (await mod('engine/score')).score({ ...base, ...o });

test('score vector: resolved at 41 s against 35 s with 4 of 6 pager left is 87, Solid, with the pinned parts', async () => {
  const r = await sc({});
  assert.equal(r.score, 87);
  assert.equal(r.tier, 'Solid');
  assert.ok(Math.abs(r.parts.time - 42.68) < 0.01, `time ${r.parts.time}`);
  assert.equal(r.parts.pager, 24);
  assert.equal(r.parts.collateral, 20);
  assert.equal(r.parts.hintCost, 0);
  assert.ok(Number.isInteger(r.score));
});

test('score vector: out of budget with one harmful step and a hint is 5, Escalated', async () => {
  const r = await sc({ result: 'out-of-budget', timeToMitigate: null, budgetLeft: 0, harmful: 1, hintUsed: true });
  assert.equal(r.score, 5);
  assert.equal(r.tier, 'Escalated');
  assert.deepEqual({ ...r.parts }, { time: 0, pager: 0, collateral: 10, hintCost: 5 });
});

test('score vector: out of budget, nothing harmful, no hint is 20, Escalated', async () => {
  const r = await sc({ result: 'out-of-budget', timeToMitigate: null, budgetLeft: 0 });
  assert.equal(r.score, 20);
  assert.equal(r.tier, 'Escalated');
});

test('the optimal run (same time, optimal cost, nothing harmful, no hint) scores exactly 100, Textbook', async () => {
  const r = await sc({ timeToMitigate: 35, budgetLeft: 5 });
  assert.equal(r.score, 100);
  assert.equal(r.tier, 'Textbook');
  assert.equal(r.parts.time, 50);
  assert.equal(r.parts.pager, 30);
});

test('time part is capped at 50 when faster than optimal and pager part is capped at 30', async () => {
  const r = await sc({ timeToMitigate: 10, budgetLeft: 6 });
  assert.equal(r.parts.time, 50);
  assert.equal(r.parts.pager, 30);
  assert.equal(r.score, 100);
});

test('pager part is left / max(1, budget - optimalCost): zero left gives 0, a budget equal to the optimal cost divides by 1', async () => {
  assert.equal((await sc({ budgetLeft: 0 })).parts.pager, 0);
  assert.equal((await sc({ budgetLeft: 1 })).parts.pager, 30 * (1 / 5));
  assert.equal((await sc({ budget: 1, optimalCost: 1, budgetLeft: 0 })).parts.pager, 0);
  assert.equal((await sc({ budget: 1, optimalCost: 1, budgetLeft: 1 })).parts.pager, 30);
  assert.equal((await sc({ budget: 8, optimalCost: 6, budgetLeft: 1 })).parts.pager, 15);
});

test('collateral is 20 minus 10 per harmful step and never below 0; each hint costs 5', async () => {
  assert.equal((await sc({ harmful: 0 })).parts.collateral, 20);
  assert.equal((await sc({ harmful: 1 })).parts.collateral, 10);
  assert.equal((await sc({ harmful: 2 })).parts.collateral, 0);
  assert.equal((await sc({ harmful: 7 })).parts.collateral, 0);
  assert.equal((await sc({ hintUsed: true })).parts.hintCost, 5);
  assert.equal((await sc({ timeToMitigate: 35, budgetLeft: 5, hintUsed: true })).score, 95);
});

test('tier boundaries: 90 is Textbook and 89 is Solid; 70 is Solid and 69 is Survived', async () => {
  const at90 = await sc({ timeToMitigate: 35, budgetLeft: 5, harmful: 1 });
  assert.equal(at90.score, 90);
  assert.equal(at90.tier, 'Textbook');
  const at89 = await sc({ optimalTime: 40, timeToMitigate: 41, budgetLeft: 5, harmful: 1 });
  assert.equal(at89.score, 89);
  assert.equal(at89.tier, 'Solid');
  const at70 = await sc({ optimalTime: 40, timeToMitigate: 100, budgetLeft: 5 });
  assert.equal(at70.score, 70);
  assert.equal(at70.tier, 'Solid');
  const at69 = await sc({ optimalTime: 40, timeToMitigate: 104, budgetLeft: 5 });
  assert.equal(at69.score, 69);
  assert.equal(at69.tier, 'Survived');
});

test('the score is rounded and clamped to 0..100', async () => {
  assert.equal((await sc({ result: 'out-of-budget', timeToMitigate: null, budgetLeft: 0, harmful: 3, hintUsed: true })).score, 0);
  assert.equal((await sc({ timeToMitigate: 1, optimalTime: 500, budgetLeft: 6 })).score <= 100, true);
  const r = await sc({ timeToMitigate: 37 });
  assert.equal(r.score, Math.round(r.parts.time + r.parts.pager + r.parts.collateral - r.parts.hintCost));
});

test('an out-of-budget run is always Escalated, whatever the other inputs say', async () => {
  for (const harmful of [0, 1, 5]) assert.equal((await sc({ result: 'out-of-budget', timeToMitigate: null, budgetLeft: 0, harmful })).tier, 'Escalated');
});
