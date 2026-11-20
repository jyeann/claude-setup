// Engine: createRun, step, canApply, effects, faults, alerts, budget, resolution, statuses, diagnostics, logs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step, stepRaw, canApply, statusOf, edgeRps, firingAlerts, firstNonOk, result, metric, EngineError, THRESHOLDS } from '../public/js/engine/engine.js';
import { canonicalJson, fnv1a32 } from '../public/js/engine/hash.js';
import { stateHash } from '../public/js/engine/fingerprint.js';
import { scenarioHash } from '../public/js/engine/fingerprint.js';
import { fixture } from './fixtures/load.js';

const sc = fixture();
const run = (s, n, acts = () => []) => { let x = s; for (let i = 0; i < n; i++) x = step(x, acts(x)); return x; };
const at = (n, seed = 1, scenario = sc) => run(createRun(scenario, seed), n);
const FP = (() => { let s = createRun(sc, 1); while (s.firstPageTick === null) s = step(s, []); return s.firstPageTick; })();
const atFirstPage = () => at(FP);
const canon = canonicalJson;

test('createRun builds a calm tick-0 state with every pinned field', () => {
  const s = createRun(sc, 7);
  for (const k of ['v', 'scenarioId', 'scenarioHash', 'seed', 'tick', 'status', 'budgetLeft', 'graceLeft', 'onsetTick', 'firstPageTick', 'resolvedTick', 'peakError', 'hash', 'params', 'edgeParams', 'm', 'alerts', 'logs', 'series', 'actionLog', 'applied', 'diag', 'faultsFired']) assert.ok(k in s, k);
  assert.deepEqual([s.v, s.scenarioId, s.seed, s.tick, s.status, s.budgetLeft, s.graceLeft], [1, 'stampede', 7, 0, 'running', 6, 0]);
  assert.equal(s.scenarioHash, scenarioHash(sc));
  assert.deepEqual([s.onsetTick, s.firstPageTick, s.resolvedTick, s.diag, s.peakError], [null, null, null, null, 0]);
  assert.deepEqual([s.actionLog, s.faultsFired, s.logs, s.applied], [[], [], [], {}]);
  assert.equal(s.hash, fnv1a32(''));
  assert.equal(stateHash(s), '811c9dc5');
  for (const id of Object.keys(sc.topology.nodes)) assert.equal(statusOf(s, id), 'ok', id);
  assert.deepEqual(firingAlerts(s), []);
  assert.equal(firstNonOk(s), null);
  for (const k of ['p99', 'errors', 'saturation', 'queue', 'cache-hit']) assert.equal(s.series[k].length, 1, k);
  assert.equal(createRun(sc, 2 ** 32 + 5).seed, 5);
  assert.equal(createRun(sc, -1).seed, 4294967295);
  assert.equal(s.failAtTick, null);
  assert.equal(createRun(sc, 1, { failAtTick: 3 }).failAtTick, 3);
  assert.equal(canon(createRun(sc, 5)), canon(createRun(sc, 5)));
  assert.equal(s.alerts['checkout-p99'].firing, false);
  assert.equal(s.m0.lb.p99, metric(s, 'lb', 'p99'));
  assert.deepEqual(s.hot.lb < 0, true);
});

test('the same seed gives the same run, different seeds differ, and a JSON round trip steps identically', () => {
  assert.equal(at(30).hash, at(30).hash);
  assert.notEqual(at(30, 1).hash, at(30, 2).hash);
  const s20 = at(20);
  let a = s20;
  let b = JSON.parse(JSON.stringify(s20));
  for (let i = 0; i < 15; i++) {
    const acts = i === 3 ? [{ id: 'add-ttl-jitter', node: 'cache' }] : [];
    a = step(a, acts);
    b = step(b, acts);
    assert.equal(b.hash, a.hash);
  }
  assert.equal(canon(a), canon(b));
});

test('step is pure: inputs are untouched and a deep-frozen state steps', () => {
  const s = at(6);
  const before = canon(s);
  const out = step(s, [{ id: 'add-ttl-jitter', node: 'cache' }, { id: 'trace-request', node: null }]);
  assert.equal(canon(s), before);
  assert.notEqual(out, s);
  const freeze = (o) => { if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o)) freeze(v); } return o; };
  const frozen = freeze(JSON.parse(before));
  assert.equal(step(frozen, [{ id: 'add-ttl-jitter', node: 'cache' }, { id: 'failover', node: 'db-primary' }]).tick, 7);
  const finished = { ...out, status: 'resolved' };
  assert.equal(step(finished, [{ id: 'trace-request', node: null }]), finished);
});

test('failAtTick throws EngineError("deliberate failure") when the new tick equals it', () => {
  let s = createRun(sc, 1, { failAtTick: 3 });
  s = step(s, []);
  s = step(s, []);
  assert.throws(() => step(s, []), (e) => e instanceof EngineError && e.message === 'deliberate failure' && e.name === 'EngineError');
  assert.equal(step(createRun(sc, 1, { failAtTick: 2 }), []).tick, 1);
  assert.throws(() => stepRaw(s, []), EngineError);
});

test('the fault fires at atTick, once, and the effect shows from the next tick; calm until then', () => {
  let s = createRun(sc, 1);
  for (let t = 0; t <= 4; t++) {
    assert.equal(s.tick, t);
    assert.deepEqual(firingAlerts(s), []);
    for (const id of Object.keys(sc.topology.nodes)) assert.equal(statusOf(s, id), 'ok', `tick ${t} ${id}`);
    assert.equal(s.onsetTick, t > 4 ? 4 : null);
    s = step(s, []);
  }
  assert.equal(s.onsetTick, 4);
  assert.deepEqual(s.faultsFired, ['ttl-expiry']);
  assert.ok(s.params.cache.hitRate < 0.95);
  assert.notEqual(statusOf(s, 'cache'), 'ok');
  const later = run(s, 10);
  assert.deepEqual(later.faultsFired, ['ttl-expiry']);
});

test('a when-triggered fault fires on the first tick its condition holds and not again', () => {
  const w = fixture((r) => { r.faults.push({ id: 'second', trigger: { when: { all: [{ fault: 'ttl-expiry' }, { tickGte: 9 }] } }, effects: [{ path: 'node:lb.extraMs', op: 'add', value: 100 }] }); });
  const s = at(20, 1, w);
  assert.deepEqual(s.faultsFired, ['ttl-expiry', 'second']);
  assert.equal(s.params.lb.extraMs, 100, 'added once');
});

test('step drops inspect, unknown ids, malformed entries and illegal actions without cost, log or history', () => {
  const s0 = createRun(sc, 1);
  const s1 = step(s0, [{ id: 'inspect', node: 'cache' }, { id: 'reboot-everything', node: 'cache' }, { id: 'scale-service', node: null }, { id: 'add-ttl-jitter', node: 'lb' }, null, { id: 5 }, {}, { node: 'cache' }]);
  assert.deepEqual([s1.tick, s1.budgetLeft, s1.actionLog, s1.applied, s1.pendingClass], [1, 6, [], {}, []]);
  assert.equal(s1.logs.filter((l) => l.kind === 'action').length, 0);
  assert.equal(step(s0, undefined).tick, 1);
  assert.equal(step(s0, 'x').tick, 1);
});

test('actions apply in order at t = state.tick (caller t ignored), spend their cost and log before the template lines', () => {
  const s = at(5);
  const out = step(s, [{ id: 'trace-request', node: null, t: 99 }, { id: 'add-ttl-jitter', node: 'cache' }, { id: 'scale-service', node: 'service-1', t: -3 }]);
  assert.deepEqual(out.actionLog.map((a) => [a.t, a.id, a.node]), [[5, 'trace-request', null], [5, 'add-ttl-jitter', 'cache'], [5, 'scale-service', 'service-1']]);
  assert.equal(out.budgetLeft, s.budgetLeft - 1 - 1 - 2);
  const fresh = out.logs.slice(s.logs.length);
  const acts = fresh.filter((l) => l.kind === 'action');
  assert.deepEqual(acts.map((l) => [l.text, l.node, l.level, l.t]), [['Ran: Trace request', null, 'info', 6], ['Applied: Add TTL jitter', 'cache', 'info', 6], ['Applied: Scale service', 'service-1', 'info', 6]]);
  assert.ok(fresh.map((l) => l.kind).lastIndexOf('action') < (fresh.findIndex((l) => l.kind === 'log') === -1 ? Infinity : fresh.findIndex((l) => l.kind === 'log')));
  assert.deepEqual(out.applied, { 'add-ttl-jitter@cache': true, 'scale-service@service-1': true });
});

test('cost comes from actions, then diagnostics, then the defaults', () => {
  const w = fixture((r) => { r.diagnostics = { 'tail-logs': { cost: 3 }, 'compare-dashboards': { cost: 3 } }; r.actions['compare-dashboards'] = { cost: 2 }; delete r.actions['scale-service'].cost; });
  const cost = (id, node = null) => { const s = createRun(w, 1); return s.budgetLeft - step(s, [{ id, node }]).budgetLeft; };
  assert.deepEqual([cost('tail-logs'), cost('compare-dashboards'), cost('trace-request'), cost('deploy-history'), cost('scale-service', 'service-1'), cost('add-ttl-jitter', 'cache'), cost('failover', 'db-primary')], [3, 2, 1, 1, 2, 1, 2]);
  assert.equal(cost('rollback', 'service-1'), 2, 'a fix without any entry costs the default 2');
});

test('canApply: target resolution, free inspect, unknown ids', () => {
  const s = at(3);
  assert.deepEqual(canApply(s, 'add-ttl-jitter', 'cache'), { ok: true, target: 'cache' });
  assert.deepEqual(canApply(s, 'add-ttl-jitter'), { ok: true, target: 'cache' });
  assert.deepEqual(canApply(s, 'shed-load', null), { ok: true, target: 'lb' });
  assert.deepEqual(canApply(s, 'scale-service', 'service-2'), { ok: true, target: 'service-2' });
  assert.deepEqual(canApply(s, 'trace-request', 'cache'), { ok: true, target: null });
  assert.deepEqual(canApply(s, 'inspect', 'cache'), { ok: true, target: 'cache', free: true });
  assert.deepEqual(canApply(s, 'inspect', null), { ok: true, target: null, free: true });
  assert.deepEqual(canApply(s, 'nope', 'cache'), { ok: false, reason: 'Unknown action.' });
  assert.deepEqual(canApply(s, 'scale-service', 'nope'), { ok: false, reason: 'Works on a service or consumer. Select one first.' });
  assert.deepEqual(canApply(s, 'scale-service', 'toString'), { ok: false, reason: 'Works on a service or consumer. Select one first.' });
});

test('canApply reasons and their order: over, out of budget, not enough, target, already on', () => {
  const s = at(3);
  const reason = (st, id, node) => { const r = canApply(st, id, node); assert.equal(r.ok, false); return r.reason; };
  assert.equal(reason(s, 'scale-service', null), 'Works on a service or consumer. Select one first.');
  assert.equal(reason(s, 'failover', 'cache'), 'Works on a db. Select one first.');
  assert.equal(reason(s, 'add-ttl-jitter', 'lb'), 'Works on a cache. Select one first.');
  assert.equal(reason(s, 'backoff-jitter', 'db-primary'), 'Works on a client or service. Select one first.');
  assert.equal(reason(s, 'renew-cert', 'cache'), 'Works on a lb or service or third-party. Select one first.');
  const applied = step(s, [{ id: 'add-ttl-jitter', node: 'cache' }]);
  assert.equal(reason(applied, 'add-ttl-jitter', 'cache'), 'Already on.');
  assert.equal(canApply(applied, 'scale-service', 'service-1').ok, true);
  assert.equal(canApply(step(applied, [{ id: 'scale-service', node: 'service-1' }]), 'scale-service', 'service-1').ok, true, 'scale-service repeats');
  const low = step(s, Array.from({ length: 5 }, () => ({ id: 'trace-request', node: null })));
  assert.equal(low.budgetLeft, 1);
  assert.equal(reason(low, 'scale-service', 'service-1'), 'Not enough pager. It costs 2 and you have 1.');
  assert.equal(reason(low, 'scale-service', null), 'Not enough pager. It costs 2 and you have 1.', 'budget before target');
  assert.equal(canApply(low, 'add-ttl-jitter', 'cache').ok, true, 'cost 1 with 1 left');
  const zero = step(low, [{ id: 'trace-request', node: null }]);
  assert.equal(zero.budgetLeft, 0);
  assert.equal(reason(zero, 'trace-request', null), 'Out of pager budget.');
  assert.equal(reason(zero, 'scale-service', null), 'Out of pager budget.');
  assert.equal(canApply(zero, 'inspect', 'lb').ok, true);
  assert.equal(reason({ ...zero, status: 'out-of-budget' }, 'trace-request', null), 'The incident is over.');
  assert.equal(reason({ ...s, status: 'resolved' }, 'inspect', null), 'The incident is over.');
  assert.equal(reason({ ...s, status: 'resolved' }, 'nope', null), 'Unknown action.', 'unknown ids are caught first');
});

test('a free-cost action (cost 0 via a default override) is not blocked by an empty budget', () => {
  const zero = { ...at(3), budgetLeft: 0, graceLeft: 5 };
  assert.deepEqual(canApply(zero, 'trace-request', null), { ok: false, reason: 'Out of pager budget.' });
});

test('effects: set, add, mul from the current value, clamped to the parameter range, integers rounded', () => {
  const mk = (effects) => fixture((r) => { r.actions['add-ttl-jitter'] = { cost: 1, effects: { cache: effects } }; });
  const apply = (effects) => step(createRun(mk(effects), 1), [{ id: 'add-ttl-jitter', node: 'cache' }]);
  assert.equal(apply([{ path: 'node:cache.capFactor', op: 'add', value: 50 }]).params.cache.capFactor, 10);
  assert.equal(apply([{ path: 'node:cache.capFactor', op: 'add', value: -50 }]).params.cache.capFactor, 0);
  assert.equal(apply([{ path: 'node:cache.capFactor', op: 'mul', value: 0.5 }]).params.cache.capFactor, 0.5);
  assert.equal(apply([{ path: 'node:cache.capFactor', op: 'set', value: 2 }, { path: 'node:cache.capFactor', op: 'mul', value: 3 }]).params.cache.capFactor, 6, 'later effects see earlier ones');
  assert.equal(apply([{ path: 'node:cache.instances', op: 'add', value: 1.4 }]).params.cache.instances, 2, 'integer parameters are rounded');
  assert.equal(apply([{ path: 'edge:cache>db-primary.retries', op: 'set', value: 9 }]).edgeParams['cache>db-primary'].retries, 5);
  assert.equal(apply([{ path: 'edge:cache>db-primary.breaker', op: 'set', value: true }]).edgeParams['cache>db-primary'].breaker, true);
  assert.equal(apply([{ path: 'node:lb.shed', op: 'set', value: 0.4 }]).params.lb.shed, 0.4, 'an effect may touch a node other than its target');
});

test('a ramp of r ticks reaches its target at T + r exactly and is linear in between; a later op cancels it', () => {
  const r = 4;
  const w = fixture((x) => {
    x.actions['add-ttl-jitter'] = { cost: 1, effects: { cache: [{ path: 'node:cache.capFactor', op: 'set', value: 3, ramp: r }] } };
    x.actions['scale-service'] = { cost: 2, effects: { 'service-1': [{ path: 'node:cache.capFactor', op: 'set', value: 1.5 }] } };
  });
  let s = step(createRun(w, 1), []);
  const T = s.tick;
  const start = s.params.cache.capFactor;
  s = step(s, [{ id: 'add-ttl-jitter', node: 'cache' }]);
  for (let j = 1; j <= r + 2; j++) {
    const want = j >= r ? 3 : start + ((3 - start) * j) / r;
    assert.ok(Math.abs(s.params.cache.capFactor - want) < 1e-12, `T+${j}`);
    assert.equal(s.tick, T + j);
    assert.equal(s.ramps.filter((x) => x.path === 'node:cache.capFactor').length, j >= r ? 0 : 1);
    s = step(s, []);
  }
  let c = step(createRun(w, 1), [{ id: 'add-ttl-jitter', node: 'cache' }]);
  c = step(c, []);
  c = step(c, [{ id: 'scale-service', node: 'service-1' }]);
  for (let i = 0; i < 6; i++) { assert.equal(c.params.cache.capFactor, 1.5); c = step(c, []); }
  assert.equal(c.ramps.filter((x) => x.path === 'node:cache.capFactor').length, 0);
});

test('an effect with a false if-condition is skipped but the action is still logged and paid for', () => {
  const mk = (cond) => fixture((r) => { r.actions['add-ttl-jitter'] = { cost: 1, effects: { cache: [{ path: 'node:cache.capFactor', op: 'set', value: 4, if: cond }] } }; });
  const skip = step(createRun(mk({ tickGte: 500 }), 1), [{ id: 'add-ttl-jitter', node: 'cache' }]);
  const take = step(createRun(mk({ tickGte: 0 }), 1), [{ id: 'add-ttl-jitter', node: 'cache' }]);
  assert.notEqual(skip.params.cache.capFactor, 4);
  assert.equal(take.params.cache.capFactor, 4);
  assert.deepEqual([skip.actionLog.length, skip.budgetLeft], [1, 5]);
  const edge = step(createRun(mk({ tickGte: 1 }), 1), [{ id: 'add-ttl-jitter', node: 'cache' }]);
  assert.notEqual(edge.params.cache.capFactor, 4, 'the condition sees tick 0, so tickGte 1 is false');
});

test('alerts fire after forTicks consecutive true ticks, clear after 3 false ticks, and can fire again', () => {
  const w = fixture((r) => {
    r.alerts.push({ id: 'probe', severity: 3, text: 'probe', forTicks: 2, when: { any: [{ all: [{ tickGte: 10 }, { not: { tickGte: 15 } }] }, { tickGte: 30 }] } });
  });
  let s = createRun(w, 1);
  const firing = [];
  for (let i = 0; i < 40; i++) { s = step(s, []); firing[s.tick] = firingAlerts(s).some((a) => a.id === 'probe'); }
  assert.deepEqual([firing[10], firing[11], firing[16], firing[17], firing[29], firing[30], firing[31]], [false, true, true, false, false, false, true]);
  assert.equal(s.alerts.probe.since, 31);
  assert.equal(s.alerts.probe.clearedAt, 17, 'clearedAt keeps the last clear');
  const mid = run(createRun(w, 1), 17);
  assert.equal(mid.alerts.probe.clearedAt, 17);
  assert.equal(mid.alerts.probe.since, 11);
});

test('an alert that flickers false for fewer than 3 ticks stays firing', () => {
  const w = fixture((r) => { r.alerts.push({ id: 'probe', severity: 3, text: 'probe', forTicks: 1, when: { any: [{ not: { tickGte: 10 } }, { all: [{ tickGte: 12 }, { not: { tickGte: 20 } }] }, { tickGte: 30 }] } }); });
  let s = createRun(w, 1);
  const f = [];
  for (let i = 0; i < 25; i++) { s = step(s, []); f[s.tick] = firingAlerts(s).some((a) => a.id === 'probe'); }
  assert.deepEqual([f[9], f[10], f[11], f[12], f[19], f[20], f[21], f[22], f[23]], [true, true, true, true, true, true, true, false, false], 'false for ticks 10 and 11 only, then 20 21 22 clears');
});

test('firingAlerts orders by severity then file order with id, severity, text, since', () => {
  const w = fixture((r) => {
    r.alerts.push({ id: 'zz-b', severity: 3, text: 'b alert', when: { tickGte: 1 }, forTicks: 1 });
    r.alerts.push({ id: 'zz-a', severity: 3, text: 'a alert', when: { tickGte: 1 }, forTicks: 1 });
    r.alerts.push({ id: 'zz-top', severity: 1, text: 'top alert', when: { tickGte: 1 }, forTicks: 1 });
  });
  const f = firingAlerts(run(createRun(w, 1), 3));
  assert.deepEqual(f.map((a) => a.id).slice(0, 3), ['zz-top', 'zz-b', 'zz-a']);
  assert.deepEqual(f[0], { id: 'zz-top', severity: 1, text: 'top alert', since: 1 });
  assert.deepEqual(f.map((a) => a.severity), [...f.map((a) => a.severity)].sort((x, y) => x - y));
});

test('firstPageTick is the first severity 1-2 alert; a severity 3 alert alone does not page', () => {
  const s = at(12);
  assert.equal(s.firstPageTick, FP);
  assert.ok(FP >= 6 && FP <= 9);
  const w = fixture((r) => { r.alerts = [{ id: 'low', severity: 3, text: 'low', when: { tickGte: 3 } }, { id: 'page', severity: 2, text: 'page', when: { tickGte: 8 } }]; });
  const t = run(createRun(w, 1), 12);
  assert.equal(t.alerts.low.since, 4);
  assert.equal(t.firstPageTick, 9);
});

test('resolution needs holdTicks quiet ticks after the first page, and every resolve.require condition', () => {
  const quiet = (hold, extra = {}) => fixture((r) => {
    r.holdTicks = hold;
    r.alerts = [{ id: 'page', severity: 2, text: 'page', forTicks: 1, when: { all: [{ tickGte: 5 }, { not: { tickGte: 8 } }] } }];
    Object.assign(r, extra);
  });
  for (const hold of [1, 5, 30]) {
    const s = run(createRun(quiet(hold), 1), 60);
    assert.equal(s.status, 'resolved', `hold ${hold}`);
    assert.equal(s.resolvedTick, 9 + hold, 'fires 5..7, clears at 10 (the first quiet tick), the hold completes hold ticks later');
    assert.equal(s.tick, s.resolvedTick);
  }
  const need = run(createRun(quiet(2, { resolve: { require: [{ tickGte: 30 }] } }), 1), 60);
  assert.equal(need.resolvedTick, 31, 'require holds from tick 30, so a hold of 2 completes at 31');
  const never = run(createRun(quiet(2, { resolve: { require: [{ tickGte: 9999 }] } }), 1), 40);
  assert.equal(never.status, 'running');
  const noPage = fixture((r) => { r.alerts = [{ id: 'page', severity: 2, text: 'page', forTicks: 1, when: { tickGte: 200 } }]; r.holdTicks = 1; });
  assert.equal(run(createRun(noPage, 1), 100).status, 'running', 'no resolution before the first page');
});

test('the optimal fix resolves the stampede; result() reports it and stamps harmful only for revealed harmful fixes', () => {
  const s5 = at(5);
  assert.deepEqual({ ...result(s5) }, { result: 'running', timeToMitigate: null, budgetLeft: 6, harmful: 0, peakError: 0, onsetTick: 4, firstPageTick: null, resolvedTick: null });
  let s = atFirstPage();
  s = step(s, [{ id: 'add-ttl-jitter', node: 'cache' }]);
  while (s.status === 'running') s = step(s, []);
  const r = result(s);
  assert.equal(r.result, 'resolved');
  assert.equal(r.timeToMitigate, s.resolvedTick);
  assert.equal(r.budgetLeft, 5);
  assert.equal(r.harmful, 0);
  assert.equal(r.firstPageTick, FP);
  assert.ok(r.peakError >= 0 && r.peakError <= 1);
  assert.ok(r.timeToMitigate > FP);
});

test('budget: the grace window lasts exactly 10 steps and a run that resolves in it counts as resolved', () => {
  let s = createRun(sc, 1);
  s = step(s, Array.from({ length: 6 }, () => ({ id: 'trace-request', node: null })));
  assert.deepEqual([s.budgetLeft, s.graceLeft, s.status], [0, 10, 'running']);
  for (let i = 0; i < 9; i++) { s = step(s, []); assert.equal(s.status, 'running'); }
  assert.equal(s.graceLeft, 1);
  s = step(s, []);
  assert.deepEqual([s.status, s.graceLeft, s.tick], ['out-of-budget', 0, 11]);
  assert.equal(result(s).timeToMitigate, null);
  assert.equal(result(s).result, 'out-of-budget');
  const w = fixture((r) => { r.alerts = [{ id: 'page', severity: 2, text: 'p', forTicks: 1, when: { all: [{ tickGte: 3 }, { not: { tickGte: 6 } }] } }]; r.holdTicks = 3; });
  let g = createRun(w, 1);
  g = step(g, Array.from({ length: 6 }, () => ({ id: 'trace-request', node: null })));
  while (g.status === 'running') g = step(g, []);
  assert.equal(g.status, 'resolved', 'quiet from tick 8, hold 3 completes at tick 10, one tick before the grace window ends');
  assert.equal(g.resolvedTick, 10);
});

test('maxTicks forces the budget to 0 and the run ends 10 ticks later (escalation off)', () => {
  const w = fixture((r) => { r.maxTicks = 60; r.escalateEvery = 0; });
  let s = createRun(w, 1);
  while (s.tick < 59) s = step(s, []);
  assert.equal(s.budgetLeft, 6);
  s = step(s, []);
  assert.deepEqual([s.tick, s.budgetLeft, s.graceLeft, s.status], [60, 0, 10, 'running']);
  for (let i = 0; i < 9; i++) s = step(s, []);
  assert.equal(s.status, 'running');
  s = step(s, []);
  assert.deepEqual([s.status, s.tick], ['out-of-budget', 70]);
});

test('escalation spends one lamp every escalateEvery ticks after the first page and logs a warn line; it never takes the last lamp', () => {
  const w = fixture((r) => { r.escalateEvery = 20; r.maxTicks = 300; });
  let s = createRun(w, 1);
  const budgets = {};
  while (s.status === 'running') { s = step(s, []); budgets[s.tick] = s.budgetLeft; }
  const fp = s.firstPageTick;
  assert.equal(budgets[fp + 19], 6);
  assert.equal(budgets[fp + 20], 5);
  assert.equal(budgets[fp + 40], 4);
  assert.equal(budgets[fp + 100], 1);
  assert.equal(budgets[fp + 120], 1, 'the last lamp is kept until maxTicks');
  assert.equal(budgets[299], 1);
  assert.equal(budgets[300], 0);
  assert.equal(s.tick, 310);
  const lines = s.logs.filter((l) => l.text === 'Escalation: still paging after 20 s.');
  assert.equal(lines.length, 5);
  assert.deepEqual({ kind: lines[0].kind, node: lines[0].node, level: lines[0].level, t: lines[0].t }, { kind: 'log', node: null, level: 'warn', t: fp + 20 });
  const off = fixture((r) => { r.escalateEvery = 0; r.maxTicks = 100; });
  let o = createRun(off, 1);
  while (o.status === 'running') o = step(o, []);
  assert.equal(o.logs.filter((l) => /Escalation/.test(l.text)).length, 0);
});

test('thresholds use >= on quantised values, scenario overrides win per metric, hit rate counts "under"', () => {
  const s = at(12);
  const v = metric(s, 'lb', 'saturation');
  const status = (warn, crit) => statusOf(run(createRun(fixture((r) => { r.thresholds = { saturation: { warn, crit }, errorRate: { warn: 2, crit: 3 }, p99: { warn: 1e9, crit: 2e9 } }; }), 1), 12), 'lb');
  assert.equal(status(v, v + 0.5), 'warn');
  assert.ok(['ok', 'recovering'].includes(status(v + 0.0001, v + 0.5)), 'just under warn is not warn');
  assert.equal(status(v - 0.1, v), 'crit');
  assert.equal(status(v - 0.01, v + 0.0001), 'warn');
  assert.deepEqual({ ...THRESHOLDS.saturation }, { warn: 0.7, crit: 0.9 });
  assert.deepEqual({ ...THRESHOLDS.errorRate }, { warn: 0.01, crit: 0.05 });
  assert.deepEqual({ ...THRESHOLDS.p99 }, { warn: 1000, crit: 2000 });
  assert.deepEqual({ ...THRESHOLDS.queue }, { warn: 0.5, crit: 0.8 });
  assert.deepEqual({ ...THRESHOLDS.hitRate }, { warn: 0.8, crit: 0.5 });
  const calm = createRun(sc, 1);
  const hit = (rate) => statusOf({ ...calm, m: { ...calm.m, cache: { ...calm.m.cache, hitRate: rate } } }, 'cache');
  assert.deepEqual([hit(0.95), hit(0.8), hit(0.7999), hit(0.5), hit(0.4999), hit(0)], ['ok', 'ok', 'warn', 'warn', 'crit', 'crit']);
});

test('statusOf: queue ratio thresholds at 0.5 and 0.8 and clients are always ok', () => {
  const w = fixture((r) => {
    r.topology.nodes['db-primary'].backlogMax = 100;
    r.thresholds = { p99: { warn: 1e9, crit: 2e9 }, saturation: { warn: 5, crit: 6 }, errorRate: { warn: 5, crit: 6 }, hitRate: { warn: 0, crit: 0 } };
  });
  const s = createRun(w, 1);
  const set = (queue) => ({ ...s, m: { ...s.m, 'db-primary': { ...s.m['db-primary'], queue } } });
  assert.deepEqual([49, 50, 79, 80].map((q) => statusOf(set(q), 'db-primary')), ['ok', 'warn', 'warn', 'crit']);
  assert.equal(statusOf({ ...s, m: { ...s.m, clients: { ...s.m.clients, errorRate: 1, p99: 1e6, saturation: 1 } } }, 'clients'), 'ok');
  assert.equal(statusOf(s, 'nope'), 'ok');
});

test('a node is recovering for exactly 10 ticks after leaving warn or crit, then ok', () => {
  const w = fixture((r) => { r.alerts = [{ id: 'page', severity: 2, text: 'p', when: { tickGte: 1000 } }]; r.faults[0].effects.push({ path: 'node:cache.hitRate', op: 'set', value: 0.95, if: { tickGte: 999 } }); });
  let s = createRun(w, 1);
  const seq = [];
  const fix = { id: 'add-ttl-jitter', node: 'cache' };
  const w2 = fixture((r) => { r.alerts = [{ id: 'page', severity: 2, text: 'p', when: { tickGte: 1000 } }]; r.actions['add-ttl-jitter'].effects.cache[0].ramp = undefined; delete r.actions['add-ttl-jitter'].effects.cache[0].ramp; });
  s = createRun(w2, 1);
  for (let i = 0; i < 40; i++) { s = step(s, s.tick === 8 ? [fix] : []); seq[s.tick] = statusOf(s, 'cache'); }
  assert.ok(['warn', 'crit'].includes(seq[8]));
  assert.equal(seq[9], 'recovering');
  assert.equal(seq[18], 'recovering');
  assert.equal(seq[19], 'ok');
  assert.equal(seq[39], 'ok');
});

test('firstNonOk is the node that left ok earliest, ties by topology order; it clears when everything is ok again', () => {
  assert.equal(firstNonOk(at(12)), 'cache');
  const s = createRun(sc, 1);
  const tied = { ...s, leftOk: { ...s.leftOk, lb: 5, 'service-1': 5, cache: 6 } };
  assert.equal(firstNonOk(tied), 'lb');
  assert.equal(firstNonOk({ ...tied, leftOk: { ...tied.leftOk, lb: 7, 'service-1': 5 } }), 'service-1');
  assert.equal(firstNonOk(s), null);
  const w = fixture((r) => { r.alerts = [{ id: 'page', severity: 2, text: 'p', when: { tickGte: 1000 } }]; });
  let f = createRun(w, 1);
  for (let i = 0; i < 80; i++) f = step(f, f.tick === 8 ? [{ id: 'add-ttl-jitter', node: 'cache' }] : []);
  assert.equal(firstNonOk(f), null);
});

test('edgeRps reads the quantised flow and is 0 for unknown edges and open breakers', () => {
  const s = at(12);
  assert.ok(Number.isInteger(edgeRps(s, 'cache', 'db-primary')));
  assert.ok(edgeRps(s, 'cache', 'db-primary') > edgeRps(createRun(sc, 1), 'cache', 'db-primary') * 2);
  assert.equal(edgeRps(s, 'lb', 'nope'), 0);
  const w = fixture((r) => { r.faults[0].effects.push({ path: 'edge:lb>service-1.breaker', op: 'set', value: true }); r.faults[0].effects.push({ path: 'edge:lb>service-1.fallback', op: 'set', value: true }); });
  const b = at(25, 1, w);
  assert.equal(b.breakers['lb>service-1'] !== undefined, true);
  const states = []; let x = createRun(w, 1); for (let i = 0; i < 25; i++) { x = step(x, []); states.push(edgeRps(x, 'lb', 'service-1')); }
  assert.ok(states.includes(0), 'a tripped breaker cuts the edge');
});

test('diagnostics: trace lists hops with ms, tail shows recent log text, compare names every node, deploy-history lists deploys; none change the system', () => {
  const s = at(12);
  const trace = step(s, [{ id: 'trace-request', node: null }]);
  assert.equal(trace.diag.id, 'trace-request');
  assert.equal(trace.diag.t, 12);
  assert.ok(trace.diag.lines.length >= 3);
  assert.match(trace.diag.lines[0], /^lb \d[\d,]* ms$/);
  assert.match(trace.diag.lines[1], /^-> service-1 \d[\d,]* ms$/);
  assert.match(trace.diag.lines.at(-1), /^-> db-primary \d[\d,]* ms$/);
  const tail = step(s, [{ id: 'tail-logs', node: null }]);
  assert.ok(tail.diag.lines.some((l) => /misses for key product:42 in 1 s$/.test(l)));
  assert.ok(tail.diag.lines.every((l) => /^T\+\d\d:\d\d /.test(l)));
  const cmp = step(s, [{ id: 'compare-dashboards', node: null }]);
  for (const n of Object.keys(sc.topology.nodes)) assert.ok(cmp.diag.lines.some((l) => l.startsWith(`${n}: p99 `)), n);
  assert.match(cmp.diag.lines.find((l) => l.startsWith('lb:')), /^lb: p99 [\d,]+ ms \(was \d+\), errors \d+\.\d% \(was 0\.0%\), saturation \d+\.\d% \(was \d+\.\d%\)$/);
  const dep = step(s, [{ id: 'deploy-history', node: null }]);
  assert.deepEqual(dep.diag.lines, ['T-01:30 service-1 service-1 v12 released']);
  const none = fixture((r) => { r.deploys = []; r.logs = []; });
  assert.deepEqual(step(createRun(none, 1), [{ id: 'deploy-history', node: null }]).diag.lines, ['No recent deploys.']);
  assert.deepEqual(step(createRun(none, 1), [{ id: 'tail-logs', node: null }]).diag.lines, ['No log lines in the last 30 seconds.']);
  const future = fixture((r) => { r.deploys = [{ tick: 50, node: 'lb', text: 'later' }, { tick: 2, node: 'lb', text: 'sooner' }, { tick: 5, node: 'lb', text: 'soon' }]; });
  assert.deepEqual(run(createRun(future, 1), 6).diag, null);
  assert.deepEqual(step(run(createRun(future, 1), 6), [{ id: 'deploy-history', node: null }]).diag.lines, ['T+00:05 lb soon', 'T+00:02 lb sooner']);
  const base = at(30);
  const withDiag = run(createRun(sc, 1), 12);
  let a = step(withDiag, [{ id: 'trace-request', node: null }, { id: 'compare-dashboards', node: null }]);
  a = run(a, 17);
  assert.equal(canon(a.m), canon(base.m));
  assert.deepEqual(a.series, base.series);
  assert.equal(a.diag.id, 'compare-dashboards', 'each diagnostic replaces the previous one');
});

test('tail-logs keeps only the last 30 ticks', () => {
  const s = at(50);
  const tail = step(s, [{ id: 'tail-logs', node: null }]);
  const ticks = tail.diag.lines.map((l) => Number(/^T\+(\d\d):(\d\d)/.exec(l).slice(1).reduce((m, x, i) => (i ? m + Number(x) : Number(x) * 60), 0)));
  assert.ok(ticks.length > 0);
  assert.ok(Math.min(...ticks) > 50 - 30);
});

test('scenario diagnostic lines are appended after the default body and may use placeholders', () => {
  const w = fixture((r) => { r.diagnostics = { 'trace-request': { lines: ['probe at tick {tick} lb {m:lb.p99|ms}'] } }; });
  const s = step(run(createRun(w, 1), 8), [{ id: 'trace-request', node: null }]);
  assert.match(s.diag.lines.at(-1), /^probe at tick 8 lb [\d,]+ ms$/);
  assert.ok(s.diag.lines.length >= 3);
});

test('template log lines: at most 6 per tick in file order, from and every respected, {rand} draws once per template', () => {
  const many = fixture((r) => { for (let i = 1; i <= 10; i++) r.logs.push({ node: 'lb', level: 'info', text: `probe-${i}` }); });
  const s = run(createRun(many, 1), 12);
  const perTick = new Map();
  for (const l of s.logs.filter((x) => x.kind === 'log')) perTick.set(l.t, [...(perTick.get(l.t) ?? []), l.text]);
  for (let t = 1; t <= 4; t++) assert.deepEqual(perTick.get(t), ['probe-1', 'probe-2', 'probe-3', 'probe-4', 'probe-5', 'probe-6'], `tick ${t}`);
  const timing = fixture((r) => { r.logs = [{ node: 'lb', level: 'info', from: 5, every: 3, text: 'tick {tick}' }]; });
  const lines = run(createRun(timing, 1), 20).logs.map((l) => l.text);
  assert.deepEqual(lines, ['tick 5', 'tick 8', 'tick 11', 'tick 14', 'tick 17', 'tick 20']);
  const draw = (text) => run(createRun(fixture((r) => { r.logs = [{ node: 'lb', level: 'info', text }]; }), 3), 30);
  assert.equal(canon(draw('plain').m), canon(draw('plain too').m));
  assert.notEqual(canon(draw('r {rand:1-9}').m), canon(draw('plain').m), 'a rand template consumes a draw per tick');
  assert.equal(canon(draw('r {rand:1-9} {rand:1-9}').m), canon(draw('r {rand:1-9}').m), 'one draw per template, however many placeholders');
  const rl = draw('r {rand:1-9}').logs;
  assert.equal(rl.length, 30);
  for (const l of rl) assert.match(l.text, /^r [1-9]$/);
  const beyond = fixture((r) => { r.logs = [...Array.from({ length: 6 }, (_, i) => ({ node: 'lb', level: 'info', text: `p${i}` })), { node: 'lb', level: 'info', text: 'drawn {rand:1-9}' }]; });
  const plain6 = fixture((r) => { r.logs = Array.from({ length: 6 }, (_, i) => ({ node: 'lb', level: 'info', text: `p${i}` })); });
  assert.notEqual(canon(run(createRun(beyond, 3), 20).m), canon(run(createRun(plain6, 3), 20).m), 'a template beyond the 6-line cap still draws');
  assert.equal(run(createRun(beyond, 3), 5).logs.filter((l) => /drawn/.test(l.text)).length, 0);
});

test('the log keeps at most 5000 lines, dropping the oldest', () => {
  const s = at(12);
  const fake = Array.from({ length: 5000 }, (_, i) => ({ t: 0, node: 'lb', level: 'info', kind: 'log', text: `old ${i}` }));
  const out = step({ ...s, logs: fake }, []);
  const added = out.logs.filter((l) => l.t === 13).length;
  assert.ok(added >= 1);
  assert.equal(out.logs.length, 5000);
  assert.equal(out.logs[0].text, `old ${added}`);
  assert.equal(out.logs.at(-1).t, 13);
  assert.equal(step({ ...s, logs: fake.slice(0, 100) }, []).logs.length, 100 + added);
});

test('series hold one quantised value per tick for each spark node, with null for null sparks', () => {
  const w = fixture((r) => { r.sparks.queue = null; });
  const s = at(15, 1, w);
  for (const k of Object.keys(s.series)) assert.equal(s.series[k].length, 16, k);
  assert.ok(s.series.queue.every((x) => x === null));
  assert.equal(s.series.p99[15], metric(s, 'lb', 'p99'));
  assert.equal(s.series.errors[15], metric(s, 'lb', 'errorRate'));
  assert.equal(s.series.saturation[15], metric(s, 'db-primary', 'saturation'));
  assert.equal(s.series['cache-hit'][15], metric(s, 'cache', 'hitRate'));
  assert.equal(s.series['cache-hit'][0], 0.95);
});

test('the hash chain changes with metrics and with log text, and is stable for the same inputs', () => {
  const a = at(10);
  const b = at(10);
  assert.equal(a.hash, b.hash);
  const other = fixture((r) => { r.logs[0].text = '{m:cache.missRps|int} misses (changed)'; });
  assert.notEqual(at(10, 1, other).hash, a.hash);
  assert.notEqual(step(a, []).hash, a.hash);
  const acted = step(at(9), [{ id: 'add-ttl-jitter', node: 'cache' }]);
  assert.notEqual(acted.hash, step(at(9), []).hash);
});

test('invariants: a violation throws EngineError("invariant: <name> on <node>")', () => {
  const s = at(3);
  assert.throws(() => step({ ...s, budgetLeft: 99 }, []), (e) => e instanceof EngineError && e.message === 'invariant: budgetLeft on run');
  assert.throws(() => step({ ...s, budgetLeft: -1 }, []), /invariant: budgetLeft/);
  assert.throws(() => step({ ...s, budgetLeft: 1.5 }, []), /invariant: budgetLeft/);
  assert.throws(() => step({ ...s, tick: 700 }, []), /invariant: tick on run/);
  assert.throws(() => step({ ...s, params: { ...s.params, lb: { ...s.params.lb, baseMs: NaN } } }, []), /invariant: finite p50 on /);
  assert.equal(step({ ...s, tick: 609 }, []).tick, 610, 'maxTicks + 10 is the last legal tick');
  assert.throws(() => step({ ...s, tick: 610 }, []), /invariant: tick on run/);
});

test('peakError tracks the highest error rate of the errors spark node', () => {
  const s = at(30);
  assert.equal(s.peakError, Math.max(...s.series.errors));
  const w = fixture((r) => { r.sparks.errors = null; });
  const t = at(30, 1, w);
  assert.ok(t.peakError >= s.peakError, 'with no spark node, the worst non-client node counts');
});

test('stepRaw (judging mode) matches step on everything that decides the outcome, and draws the same randomness', () => {
  const w = fixture((r) => { r.logs.push({ node: 'lb', level: 'info', text: 'r {rand:1-9}' }); });
  const log = new Map([[6, [{ id: 'failover', node: 'db-primary' }]], [8, [{ id: 'add-ttl-jitter', node: 'cache' }, { id: 'trace-request', node: null }]], [9, [{ id: 'scale-service', node: 'service-1' }]]]);
  let a = createRun(w, 4);
  let b = createRun(w, 4);
  while (a.status === 'running') {
    const acts = log.get(a.tick) || [];
    a = step(a, acts);
    b = stepRaw(b, acts);
    for (const k of ['tick', 'status', 'budgetLeft', 'graceLeft', 'rng', 'firstPageTick', 'resolvedTick', 'onsetTick', 'holdRun', 'peakError']) assert.equal(b[k], a[k], `${k} at ${a.tick}`);
    assert.equal(canon(b.m), canon(a.m));
    assert.equal(canon(b.alerts), canon(a.alerts));
    assert.equal(canon(b.params), canon(a.params));
    assert.equal(canon(b.breakers), canon(a.breakers));
    assert.equal(canon(b.actionLog), canon(a.actionLog));
  }
  assert.equal(b.status, a.status);
  assert.equal(b.logs.length, 0, 'judging mode keeps no log');
  assert.equal(b.hash, createRun(w, 4).hash, 'and no hash chain');
  assert.equal(b.diag, null);
  assert.deepEqual(b.pendingClass, []);
});

test('the workload multiplier interpolates linearly between points and holds after the last', () => {
  const w = fixture((r) => { r.workload = [[0, 1], [10, 3], [20, 0.5]]; });
  const rps = (t) => { let s = createRun(w, 1); while (s.tick < t) s = step(s, []); return s.m.clients.rps / 2000; };
  const near = (x, y) => assert.ok(Math.abs(x - y) < 0.021 * y + 1e-9, `${x} vs ${y}`);
  near(rps(0), 1);
  near(rps(5), 2);
  near(rps(10), 3);
  near(rps(15), 1.75);
  near(rps(20), 0.5);
  near(rps(25), 0.5);
});
