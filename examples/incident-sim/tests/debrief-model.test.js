// core/debrief-model.js: replay of a saved run against the optimal path, narration, steps, tamper detection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validate } from '../public/js/engine/validate.js';
import { firstPageTick, schedule } from '../public/js/engine/solver.js';
import { replay } from '../public/js/engine/replay.js';
import { result } from '../public/js/engine/engine.js';
import { score } from '../public/js/engine/score.js';
import { buildDebrief, narrate, divergence, ribbonLabel, pastTense, biggestMove } from '../public/js/core/debrief-model.js';

const DIR = path.join(import.meta.dirname, '..', 'scenarios');
const load = (id) => validate(JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8')), `${id}.json`).scenario;

function recorded(sc, log, hintUsed = false) {
  const rp = replay(sc, sc.seed, log);
  const res = result(rp.final);
  const sco = score({ result: res.result, timeToMitigate: res.timeToMitigate, optimalTime: sc.optimalSummary.timeToMitigate, budgetLeft: res.budgetLeft, budget: sc.budget, optimalCost: sc.optimalSummary.cost, harmful: res.harmful, hintUsed });
  return { seed: sc.seed, actions: rp.final.actionLog.map((a) => ({ t: a.t, id: a.id, node: a.node })), result: res.result, timeToMitigate: res.timeToMitigate, budgetLeft: res.budgetLeft, hintUsed, score: sco.score, scenarioHash: rp.final.scenarioHash };
}

test('the optimal run scores 100 Textbook, matches its own lane and has no divergence', () => {
  const sc = load('cache-stampede');
  const fp = firstPageTick(sc, sc.seed);
  const run = recorded(sc, schedule(fp, sc.optimalPath));
  const m = buildDebrief({ scenario: sc, run });
  assert.equal(m.unavailable, null);
  assert.equal(m.score, 100);
  assert.equal(m.tier, 'Textbook');
  assert.equal(m.resolved, true);
  assert.equal(m.timeToMitigate, m.optimalTime);
  assert.equal(m.divergence, null);
  assert.deepEqual(m.letters, ['F']);
  assert.equal(m.you.marks[0].kind, 'F');
  assert.equal(m.steps.length, 1);
});

test('a harmful first step shows as x, diverges from optimal and carries the harmfulWhy text', () => {
  const sc = load('cache-stampede');
  const fp = firstPageTick(sc, sc.seed);
  const run = recorded(sc, [{ t: fp, id: 'failover', node: 'db-primary' }, ...schedule(fp + 2, sc.optimalPath)]);
  const m = buildDebrief({ scenario: sc, run });
  assert.equal(m.unavailable, null);
  assert.equal(m.letters[0], 'x');
  assert.ok(m.harmful >= 1);
  assert.ok(m.score < m.optimalTime + 100);
  assert.equal(m.divergence.you.id, 'failover');
  assert.equal(m.divergence.optimal.id, 'add-ttl-jitter');
  assert.equal(m.steps[0].harmful, true);
  assert.equal(m.steps[0].why, sc.harmfulWhy.failover);
  assert.ok(m.p99You.length > 10 && m.p99Opt.length > 10);
  assert.ok(m.ribbon.includes('crit'));
  assert.match(ribbonLabel(m), /^Status by second: ok 00:00 to /);
});

test('a diagnostic then the fix gives D F; time and score stay consistent with the engine', () => {
  const sc = load('cache-stampede');
  const fp = firstPageTick(sc, sc.seed);
  const run = recorded(sc, [{ t: fp, id: 'trace-request', node: null }, ...schedule(fp + 2, sc.optimalPath)]);
  const m = buildDebrief({ scenario: sc, run });
  assert.deepEqual(m.letters, ['D', 'F']);
  assert.equal(m.unavailable, null);
  assert.ok(m.score >= 75 && m.score < 100);
});

test('an out-of-budget run still reveals everything and reports Escalated', () => {
  const sc = load('cache-stampede');
  const run = recorded(sc, []);
  const m = buildDebrief({ scenario: sc, run });
  assert.equal(m.result, 'out-of-budget');
  assert.equal(m.resolved, false);
  assert.equal(m.timeToMitigate, null);
  assert.equal(m.tier, 'Escalated');
  assert.equal(m.unavailable, null);
});

test('a run that no longer replays to the saved outcome is flagged unavailable', () => {
  const sc = load('cache-stampede');
  const fp = firstPageTick(sc, sc.seed);
  const good = recorded(sc, schedule(fp, sc.optimalPath));
  assert.equal(buildDebrief({ scenario: sc, run: { ...good, scenarioHash: 'deadbeef' } }).unavailable, 'hash');
  assert.equal(buildDebrief({ scenario: sc, run: { ...good, timeToMitigate: good.timeToMitigate + 3 } }).unavailable, 'time');
  assert.equal(buildDebrief({ scenario: sc, run: { ...good, budgetLeft: 0 } }).unavailable, 'budget');
  assert.equal(buildDebrief({ scenario: sc, run: { ...good, score: 3 } }).unavailable, 'score');
  assert.equal(buildDebrief({ scenario: sc, run: { ...good, result: 'out-of-budget' } }).unavailable, 'result');
  assert.equal(buildDebrief({ scenario: sc, run: { ...good, actions: [...good.actions, { t: 9999, id: 'failover', node: 'db-primary' }] } }).unavailable, 'dropped');
});

test('narration names the step and the biggest move at the action second, and the state between steps', () => {
  const sc = load('cache-stampede');
  const fp = firstPageTick(sc, sc.seed);
  const run = recorded(sc, [{ t: fp, id: 'failover', node: 'db-primary' }, ...schedule(fp + 2, sc.optimalPath)]);
  const m = buildDebrief({ scenario: sc, run });
  const at = narrate(m, fp);
  assert.match(at.text, /^T\+00:\d\d\. You failed over Orders DB\./);
  assert.equal(at.harmful, true);
  assert.equal(at.mark.id, 'failover');
  const before = narrate(m, 1);
  assert.match(before.text, /^T\+00:01\. All quiet\. No action taken yet\.$/);
  const between = narrate(m, fp + 1);
  assert.match(between.text, /Last step: you failed over Orders DB at T\+/);
  assert.match(narrate(m, 9999).text, /^T\+\d\d:\d\d\. Mitigated\. The pager goes quiet\. Last step: /);
  assert.equal(narrate(m, -4).text.startsWith('T+00:00.'), true);
});

test('pastTense covers every action id and biggestMove is null on a flat run', () => {
  const sc = load('cache-stampede');
  for (const id of ['trace-request', 'tail-logs', 'compare-dashboards', 'deploy-history', 'scale-service', 'add-ttl-jitter', 'circuit-breaker', 'backoff-jitter', 'shed-load', 'failover', 'shard-rekey', 'add-index', 'rollback', 'raise-pool-size', 'renew-cert']) {
    assert.match(pastTense(sc, { id, node: 'cache' }), /^[a-z]/, id);
  }
  assert.equal(pastTense(sc, { id: 'mystery', node: null }), 'ran mystery');
  const snap = { m: { lb: { p99: 100, errorRate: 0, saturation: 0.2, queue: 0, hitRate: null }, 'db-primary': { saturation: 0.2, queue: 0 }, cache: { hitRate: 0.95 } }, statuses: {} };
  assert.equal(biggestMove(sc, [snap, snap, snap, snap, snap, snap, snap], 0), null);
});

test('divergence ignores diagnostics and compares id and node', () => {
  const f = (id, node, effect = 'helpful') => ({ id, node, effect });
  assert.equal(divergence([f('tail-logs', null, 'diagnostic'), f('a', 'x')], [f('a', 'x')]), null);
  assert.equal(divergence([f('a', 'y')], [f('a', 'x')]).you.node, 'y');
  assert.equal(divergence([f('a', 'x'), f('b', 'x')], [f('a', 'x')]).optimal, null);
});

test('every scenario builds a debrief for the no-action run', () => {
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
    const sc = load(f.replace('.json', ''));
    const m = buildDebrief({ scenario: sc, run: recorded(sc, []) });
    assert.equal(m.unavailable, null, sc.id);
    assert.ok(m.opt.res.result === 'resolved', `${sc.id} optimal lane resolves`);
  }
});
