// classify, replay, score, fingerprint and solver.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step, result, metric } from '../public/js/engine/engine.js';
import { badness, classify, historyEffects, judge, HARM_DELTA } from '../public/js/engine/classify.js';
import { replay } from '../public/js/engine/replay.js';
import { score } from '../public/js/engine/score.js';
import { fingerprint, scenarioHash, stateHash, chain } from '../public/js/engine/fingerprint.js';
import { firstPageTick, schedule, solve } from '../public/js/engine/solver.js';
import { fnv1a32, hex8, canonicalJson } from '../public/js/engine/hash.js';
import { firingAlerts } from '../public/js/engine/engine.js';
import { fixture, rawFixture } from './fixtures/load.js';

const sc = fixture();
const FP = firstPageTick(sc, 1);
const upTo = (n, scenario = sc) => { let s = createRun(scenario, 1); while (s.tick < n) s = step(s, []); return s; };

// ---------------------------------------------------------------- classify
test('judge: the 0.25 boundary is inclusive on both sides, a strictly earlier resolution is helpful, otherwise none', () => {
  assert.equal(HARM_DELTA, 0.25);
  assert.equal(judge(1.25, 1, null, null), 'harmful');
  assert.equal(judge(1.2499, 1, null, null), 'none');
  assert.equal(judge(1, 1.25, null, null), 'helpful');
  assert.equal(judge(1, 1.2499, null, null), 'none');
  assert.equal(judge(5, 1, 10, 20), 'harmful', 'harm is checked first');
  assert.equal(judge(1, 1, 10, 11), 'helpful');
  assert.equal(judge(1, 1, 10, 10), 'none');
  assert.equal(judge(1, 1, 11, 10), 'none');
  assert.equal(judge(1, 1, 10, null), 'helpful');
  assert.equal(judge(1, 1, null, 10), 'none');
  assert.equal(judge(1, 1, null, null), 'none');
  assert.equal(judge(0.1 + 0.2 + 1, 1.05, null, null), 'harmful', 'float noise around the boundary does not flip it');
});

test('classify: diagnostics, helpful, harmful, none, illegal and unknown actions; it never mutates the state', () => {
  const s = upTo(FP);
  const before = canonicalJson(s);
  assert.equal(classify(s, { id: 'trace-request', node: null }), 'diagnostic');
  assert.equal(classify(s, { id: 'tail-logs', node: null }), 'diagnostic');
  assert.equal(classify(s, { id: 'add-ttl-jitter', node: 'cache' }), 'helpful');
  assert.equal(classify(s, { id: 'failover', node: 'db-primary' }), 'harmful');
  assert.equal(classify(s, { id: 'scale-service', node: 'service-1' }), 'none');
  assert.equal(classify(s, { id: 'rollback', node: 'service-1' }), 'none', 'no effects at all');
  assert.equal(classify(s, { id: 'add-ttl-jitter', node: 'lb' }), 'none', 'illegal target');
  assert.equal(classify(s, { id: 'nope', node: null }), 'none');
  assert.equal(canonicalJson(s), before);
});

test('badness = sum(saturation + 5 errorRate) over nodes + 2 per firing alert, on quantised metrics', () => {
  for (const k of [0, 12, 30]) {
    const s = upTo(k);
    let want = 0;
    for (const n of Object.keys(sc.topology.nodes)) want += metric(s, n, 'saturation') + 5 * metric(s, n, 'errorRate');
    want += 2 * firingAlerts(s).length;
    assert.ok(Math.abs(badness(s) - want) < 1e-9, `tick ${k}`);
  }
});

test('historyEffects reveals an effect at tick t + 5, result().harmful counts revealed harmful ones, and a finished run reveals all', () => {
  const log = [{ t: FP, id: 'trace-request', node: null }, { t: FP + 1, id: 'failover', node: 'db-primary' }];
  const at = (tick) => replay(sc, 1, log, { until: tick, snapshots: false }).final;
  const early = historyEffects(at(FP + 5));
  assert.deepEqual(early.map((h) => [h.t, h.id, h.node]), [[FP, 'trace-request', null], [FP + 1, 'failover', 'db-primary']]);
  assert.equal(early[0].effect, 'diagnostic', 'revealed at t + 5');
  assert.equal(early[1].effect, null, 'not revealed before t + 5');
  assert.equal(result(at(FP + 5)).harmful, 0);
  const late = historyEffects(at(FP + 6));
  assert.deepEqual(late.map((h) => h.effect), ['diagnostic', 'harmful']);
  assert.equal(result(at(FP + 6)).harmful, 1);
  assert.equal(historyEffects(at(FP + 20))[1].effect, 'harmful', 'fixed once revealed');
  assert.deepEqual(historyEffects(createRun(sc, 1)), []);
  const over = { ...at(FP + 2), status: 'out-of-budget' };
  assert.equal(historyEffects(over)[1].effect, 'harmful', 'run end reveals everything');
  assert.equal(result(over).harmful, 1);
});

test('two fixes in the same tick are each judged against the run without that fix', () => {
  const s = upTo(FP);
  const out = step(s, [{ id: 'failover', node: 'db-primary' }, { id: 'add-ttl-jitter', node: 'cache' }]);
  assert.deepEqual(out.pendingClass.map((p) => [p.id, p.t, p.revealAt]), [['failover', FP, FP + 5], ['add-ttl-jitter', FP, FP + 5]]);
  assert.equal(out.pendingClass[0].effect, 'harmful');
  assert.equal(out.pendingClass[1].effect, 'helpful');
});

// ---------------------------------------------------------------- replay
test('replay: final state, snapshots of the pinned shape (index k is the state after k ticks) and dropped entries', () => {
  const log = [{ t: 5, id: 'trace-request', node: null }, { t: 6, id: 'scale-service', node: null }, { t: 7, id: 'inspect', node: 'lb' }, { t: 99999, id: 'trace-request', node: null }];
  const { final, snapshots, dropped } = replay(sc, 1, log);
  assert.equal(dropped, 3);
  assert.deepEqual(final.actionLog, [{ t: 5, id: 'trace-request', node: null }]);
  assert.equal(snapshots.length, final.tick + 1);
  const s0 = snapshots[0];
  assert.deepEqual(Object.keys(s0).sort(), ['budgetLeft', 'firing', 'hash', 'm', 'status', 'statuses', 'tick']);
  assert.equal(s0.tick, 0);
  assert.equal(s0.hash, createRun(sc, 1).hash);
  assert.equal(s0.statuses.cache, 'ok');
  assert.equal(s0.budgetLeft, 6);
  assert.deepEqual(s0.firing, []);
  assert.equal(s0.m.cache.hitRate, 0.95);
  assert.equal(snapshots[6].budgetLeft, 5);
  assert.equal(snapshots.at(-1).tick, final.tick);
  assert.equal(snapshots.at(-1).status, 'out-of-budget');
  assert.ok(snapshots.some((x) => x.firing.includes('checkout-p99')));
  for (let k = 0; k < snapshots.length; k++) assert.equal(snapshots[k].tick, k);
});

test('replay is deterministic, honours until and snapshots:false, and skips log entries in the past', () => {
  const log = schedule(FP, [{ id: 'add-ttl-jitter', node: 'cache' }]);
  const a = replay(sc, 1, log);
  const b = replay(sc, 1, log);
  assert.equal(canonicalJson(a.final), canonicalJson(b.final));
  assert.equal(a.final.status, 'resolved');
  assert.equal(a.dropped, 0);
  const part = replay(sc, 1, log, { until: 10 });
  assert.equal(part.final.tick, 10);
  assert.equal(part.snapshots.length, 11);
  assert.equal(replay(sc, 1, log, { snapshots: false }).snapshots.length, 0);
  assert.equal(replay(sc, 1, [{ t: -1, id: 'trace-request', node: null }]).dropped, 1);
  const unsorted = replay(sc, 1, [{ t: 3, id: 'trace-request', node: null }, { t: 3, id: 'tail-logs', node: null }]);
  assert.deepEqual(unsorted.final.actionLog.map((x) => x.id), ['trace-request', 'tail-logs'], 'several entries in one tick apply in order');
});

test('a full 610-tick replay is fast', () => {
  replay(sc, 1, []);
  const t0 = process.hrtime.bigint();
  const r = replay(sc, 1, []);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(r.final.tick, 610);
  assert.ok(ms < 250, `${ms.toFixed(1)} ms`);
});

// ---------------------------------------------------------------- score
const base = { result: 'resolved', timeToMitigate: 41, optimalTime: 35, budgetLeft: 4, budget: 6, optimalCost: 1, harmful: 0, hintUsed: false };
const sco = (o) => score({ ...base, ...o });

test('score vectors from the spec', () => {
  const a = sco({});
  assert.equal(a.score, 87);
  assert.equal(a.tier, 'Solid');
  assert.ok(Math.abs(a.parts.time - 42.68) < 0.01);
  assert.deepEqual([a.parts.pager, a.parts.collateral, a.parts.hintCost], [24, 20, 0]);
  const e = sco({ result: 'out-of-budget', timeToMitigate: null, budgetLeft: 0, harmful: 1, hintUsed: true });
  assert.deepEqual([e.score, e.tier, { ...e.parts }], [5, 'Escalated', { time: 0, pager: 0, collateral: 10, hintCost: 5 }]);
  assert.deepEqual([sco({ result: 'out-of-budget', timeToMitigate: null, budgetLeft: 0 }).score, sco({ result: 'out-of-budget', timeToMitigate: null, budgetLeft: 0, hintUsed: true }).score], [20, 15]);
  assert.equal(sco({ result: 'out-of-budget', timeToMitigate: null, budgetLeft: 0, harmful: 3, hintUsed: true }).score, 0);
  const best = sco({ timeToMitigate: 35, budgetLeft: 5 });
  assert.deepEqual([best.score, best.tier], [100, 'Textbook']);
  assert.equal(sco({ timeToMitigate: 10, budgetLeft: 6 }).parts.time, 50, 'time part is capped');
  assert.equal(sco({ timeToMitigate: 35, budgetLeft: 6 }).parts.pager, 30, 'pager part is capped');
});

test('score tier boundaries (90 and 70) and each part', () => {
  assert.deepEqual([sco({ timeToMitigate: 35, budgetLeft: 5, harmful: 1 }).score, sco({ timeToMitigate: 35, budgetLeft: 5, harmful: 1 }).tier], [90, 'Textbook']);
  assert.deepEqual([sco({ optimalTime: 40, timeToMitigate: 41, budgetLeft: 5, harmful: 1 }).score, sco({ optimalTime: 40, timeToMitigate: 41, budgetLeft: 5, harmful: 1 }).tier], [89, 'Solid']);
  assert.deepEqual([sco({ optimalTime: 40, timeToMitigate: 100, budgetLeft: 5 }).score, sco({ optimalTime: 40, timeToMitigate: 100, budgetLeft: 5 }).tier], [70, 'Solid']);
  assert.deepEqual([sco({ optimalTime: 40, timeToMitigate: 104, budgetLeft: 5 }).score, sco({ optimalTime: 40, timeToMitigate: 104, budgetLeft: 5 }).tier], [69, 'Survived']);
  assert.equal(sco({ budgetLeft: 0 }).parts.pager, 0);
  assert.equal(sco({ budgetLeft: 1 }).parts.pager, 6);
  assert.equal(sco({ budget: 1, optimalCost: 1, budgetLeft: 0 }).parts.pager, 0);
  assert.equal(sco({ budget: 1, optimalCost: 1, budgetLeft: 1 }).parts.pager, 30, 'a budget equal to the optimal cost divides by 1');
  assert.equal(sco({ budget: 8, optimalCost: 6, budgetLeft: 1 }).parts.pager, 15);
  assert.deepEqual([0, 1, 2, 7].map((h) => sco({ harmful: h }).parts.collateral), [20, 10, 0, 0]);
  assert.equal(sco({ timeToMitigate: 35, budgetLeft: 5, hintUsed: true }).score, 95);
  assert.equal(sco({ timeToMitigate: 1, optimalTime: 500, budgetLeft: 6 }).score, 100);
  for (const harmful of [0, 1, 5]) assert.equal(sco({ result: 'out-of-budget', timeToMitigate: null, budgetLeft: 0, harmful }).tier, 'Escalated');
});

// ---------------------------------------------------------------- fingerprint
test('fingerprint follows the pinned v1 formula and reacts to every input; scenarioHash ignores key order', () => {
  const f = { scenarioId: 'cache-stampede', scenarioHash: 'abcd1234', seed: 7, hintUsed: true, actionLog: [{ t: 12, id: 'trace-request', node: null }, { t: 14, id: 'add-ttl-jitter', node: 'cache' }] };
  const want = hex8(fnv1a32('v1|cache-stampede|abcd1234|7|12:trace-request@-;14:add-ttl-jitter@cache|h'));
  assert.equal(fingerprint(f), want);
  assert.equal(fingerprint({ ...f, hintUsed: false }), hex8(fnv1a32('v1|cache-stampede|abcd1234|7|12:trace-request@-;14:add-ttl-jitter@cache|')));
  assert.equal(fingerprint({ ...f, actionLog: [] }), hex8(fnv1a32('v1|cache-stampede|abcd1234|7||h')));
  for (const v of [{ seed: 8 }, { scenarioHash: 'abcd1235' }, { scenarioId: 'retry-storm' }, { actionLog: [f.actionLog[1]] }]) assert.notEqual(fingerprint({ ...f, ...v }), want);
  assert.equal(scenarioHash(sc), hex8(fnv1a32(canonicalJson(sc))));
  assert.equal(scenarioHash(sc), scenarioHash(sc), 'memoised for frozen scenarios');
  assert.equal(scenarioHash(Object.fromEntries(Object.entries({ ...sc }).reverse())), scenarioHash(sc));
  assert.notEqual(scenarioHash({ ...sc, hint: 'x' }), scenarioHash(sc));
  assert.equal(stateHash({ hash: 255 }), '000000ff');
  assert.equal(chain(1, 'x'), fnv1a32('00000001|x'));
});

// ---------------------------------------------------------------- solver
test('schedule puts action k at firstPage + gap * k, default gap 2, without mutating the path', () => {
  const A = { id: 'a', node: 'x' }; const B = { id: 'b', node: 'y' }; const C = { id: 'c', node: null };
  assert.deepEqual(schedule(8, [A, B, C]), [{ t: 8, id: 'a', node: 'x' }, { t: 10, id: 'b', node: 'y' }, { t: 12, id: 'c', node: null }]);
  assert.deepEqual(schedule(6, [A, B], 3), [{ t: 6, id: 'a', node: 'x' }, { t: 9, id: 'b', node: 'y' }]);
  assert.deepEqual(schedule(7, []), []);
  const input = [A];
  schedule(1, input);
  assert.deepEqual(input, [A]);
});

test('firstPageTick matches the engine and is null when nothing pages', () => {
  for (const seed of [0, 1, 77, 4294967295]) {
    const fp = firstPageTick(sc, seed);
    assert.equal(upTo(fp).firstPageTick === null, false);
    const s = (() => { let x = createRun(sc, seed); while (x.tick < fp) x = step(x, []); return x; })();
    assert.equal(s.firstPageTick, fp);
    assert.ok(firingAlerts(s).some((a) => a.severity <= 2));
  }
  const quiet = fixture((r) => { r.alerts = [{ id: 'low', severity: 3, text: 'low', when: { tickGte: 3 } }, { id: 'never', severity: 2, text: 'never', when: { tickGte: 9999 } }]; });
  assert.equal(firstPageTick(quiet, 1), null);
  assert.deepEqual(solve(quiet), { path: null, summary: null, explored: 0 });
});

test('solve finds the single resolving fix with the engine-measured time and cost', () => {
  const sol = solve(sc);
  assert.deepEqual(sol.path, [{ id: 'add-ttl-jitter', node: 'cache' }]);
  const done = replay(sc, sc.seed, schedule(FP, sol.path), { snapshots: false }).final;
  assert.equal(done.status, 'resolved');
  assert.deepEqual(sol.summary, { timeToMitigate: done.resolvedTick, cost: 1 });
  assert.ok(Number.isInteger(sol.explored) && sol.explored >= 3);
  assert.deepEqual(solve(sc), sol);
  assert.deepEqual(solve(sc, { seed: 1 }).path, sol.path);
});

test('solve returns null path and summary when no candidate has effects or none resolves', () => {
  const none = fixture((r) => { for (const k of Object.keys(r.actions)) delete r.actions[k].effects; });
  const s = solve(none);
  assert.deepEqual([s.path, s.summary, s.explored], [null, null, 0]);
  const useless = fixture((r) => { r.actions['add-ttl-jitter'].effects.cache = [{ path: 'node:cache.capFactor', op: 'set', value: 1 }]; });
  const u = solve(useless);
  assert.equal(u.path, null);
  assert.ok(u.explored > 0);
});

const pairScenario = (mutate) => fixture((r) => {
  r.alerts = [{ id: 'page', severity: 2, text: 'page', forTicks: 1, when: { all: [{ tickGte: 6 }, { not: { tickGte: 12 } }] } }];
  r.resolve = { require: [{ all: [{ applied: 'add-ttl-jitter' }, { applied: 'scale-service' }] }] };
  r.actions['add-ttl-jitter'].effects.cache = [{ path: 'node:cache.capFactor', op: 'set', value: 1 }];
  r.actions['scale-service'].effects['service-1'] = [{ path: 'node:service-1.capFactor', op: 'set', value: 1 }];
  if (mutate) mutate(r);
});

test('solve searches pairs, respects maxDepth and never repeats a (fix, node) pair', () => {
  const sc2 = pairScenario();
  const full = solve(sc2);
  assert.equal(full.path.length, 2);
  assert.deepEqual(full.path.map((p) => p.id).sort(), ['add-ttl-jitter', 'scale-service']);
  assert.equal(new Set(full.path.map((p) => `${p.id}@${p.node}`)).size, 2);
  assert.equal(solve(sc2, { maxDepth: 1 }).path, null);
  assert.ok(solve(sc2, { maxDepth: 1 }).explored > 0);
  assert.deepEqual(full.summary.cost, 3);
});

test('solve objective: earliest time, then lower cost, then shorter, then lexicographic id@node', () => {
  const any = (cost1, cost2) => pairScenario((r) => {
    r.resolve = { require: [{ any: [{ applied: 'add-ttl-jitter' }, { applied: 'scale-service' }] }] };
    r.actions['add-ttl-jitter'].cost = cost1;
    r.actions['scale-service'].cost = cost2;
  });
  assert.deepEqual(solve(any(2, 2)).path, [{ id: 'add-ttl-jitter', node: 'cache' }], 'equal time and cost: lexicographic order');
  assert.deepEqual(solve(any(2, 1)).path, [{ id: 'scale-service', node: 'service-1' }], 'lower cost wins the tie');
  assert.deepEqual(solve(any(1, 2)).path, [{ id: 'add-ttl-jitter', node: 'cache' }]);
  const early = pairScenario((r) => {
    r.resolve = { require: [{ any: [{ applied: 'add-ttl-jitter' }, { applied: 'scale-service' }] }] };
    r.actions['scale-service'].cost = 1;
    r.actions['add-ttl-jitter'].cost = 1;
  });
  const sol = solve(early);
  assert.equal(sol.path.length, 1, 'a longer path with the same time and cost loses on length');
  assert.deepEqual(sol.summary.cost, 1);
});

test('solve prunes paths over the budget', () => {
  const tight = pairScenario((r) => { r.budget = 2; r.optimalPath = [{ id: 'add-ttl-jitter', node: 'cache' }]; r.actions['add-ttl-jitter'].cost = 1; r.actions['scale-service'].cost = 2; });
  assert.equal(solve(tight).path, null, 'the pair costs 3 against a budget of 2');
});

test('solve skips a prefix that is no longer running and fixes that canApply rejects', () => {
  const sc3 = pairScenario((r) => { r.holdTicks = 1; r.resolve = { require: [{ applied: 'add-ttl-jitter' }] }; });
  const sol = solve(sc3, { maxDepth: 3 });
  assert.deepEqual(sol.path, [{ id: 'add-ttl-jitter', node: 'cache' }]);
});

test('the fixture declares what the solver finds, and playing it scores 100 Textbook with no harm', () => {
  const sol = solve(sc);
  assert.deepEqual(sol.path, sc.optimalPath.map((p) => ({ id: p.id, node: p.node })));
  assert.deepEqual(sol.summary, { ...sc.optimalSummary });
  const done = replay(sc, sc.seed, schedule(FP, sc.optimalPath), { snapshots: false }).final;
  const r = result(done);
  const out = score({ result: r.result, timeToMitigate: r.timeToMitigate, optimalTime: sc.optimalSummary.timeToMitigate, budgetLeft: r.budgetLeft, budget: sc.budget, optimalCost: sc.optimalSummary.cost, harmful: r.harmful, hintUsed: false });
  assert.deepEqual([out.score, out.tier, r.harmful], [100, 'Textbook', 0]);
});

test('a harmful fix first still resolves but scores lower and counts the harm', () => {
  const log = [{ t: FP, id: 'failover', node: 'db-primary' }, ...schedule(FP + 2, sc.optimalPath)];
  const done = replay(sc, sc.seed, log, { snapshots: false }).final;
  const r = result(done);
  assert.equal(r.result, 'resolved');
  assert.equal(r.harmful, 1);
  const out = score({ result: r.result, timeToMitigate: r.timeToMitigate, optimalTime: sc.optimalSummary.timeToMitigate, budgetLeft: r.budgetLeft, budget: sc.budget, optimalCost: sc.optimalSummary.cost, harmful: r.harmful, hintUsed: false });
  assert.ok(out.score < 100 && out.parts.collateral === 10);
});
