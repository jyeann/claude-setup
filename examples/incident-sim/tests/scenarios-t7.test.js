// Tuning guards for scenarios 6 to 10 (the numbers are tuned; these tests keep the stories true when someone retunes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validate } from '../public/js/engine/validate.js';
import { createRun, step, result, firingAlerts, metric } from '../public/js/engine/engine.js';
import { firstPageTick, schedule } from '../public/js/engine/solver.js';

const DIR = path.resolve(import.meta.dirname, '..', 'scenarios');
const load = (id) => {
  const r = validate(JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8')), `${id}.json`);
  assert.ok(r.ok, `${id} valid`);
  return r.scenario;
};
const run = (sc, log, seed = sc.seed, stop = Infinity) => {
  let s = createRun(sc, seed);
  while (s.status === 'running' && s.tick < stop) s = step(s, log.filter((a) => a.t === s.tick).map(({ id, node }) => ({ id, node })));
  return s;
};
const at = (fp, ...acts) => acts.map((a, k) => ({ t: fp + 2 * k, id: a[0], node: a[1] }));

test('cascading-failure: shed first is strictly the fastest ordering and no two-fix combination resolves', () => {
  const sc = load('cascading-failure');
  const fp = firstPageTick(sc, sc.seed);
  const A = ['shed-load', 'lb'];
  const B = ['circuit-breaker', 'service-2'];
  const C = ['scale-service', 'service-1'];
  const times = (orders) => orders.map((o) => {
    const s = run(sc, at(fp, ...o));
    return s.status === 'resolved' ? s.resolvedTick : Infinity;
  });
  const [best] = times([[A, B, C]]);
  assert.ok(Number.isFinite(best));
  for (const t of times([[A, C, B], [B, A, C], [B, C, A], [C, A, B], [C, B, A]])) assert.ok(t >= best, `another order resolves at ${t}, declared at ${best}`);
  for (const [x, y] of [[A, B], [B, A], [A, C], [C, A], [B, C], [C, B]]) {
    assert.notEqual(run(sc, at(fp, x, y)).status, 'resolved', `${x[0]} then ${y[0]} must not resolve`);
  }
});

test('cascading-failure: scale before shed saturates the database and fires its alert within five ticks', () => {
  const sc = load('cascading-failure');
  const fp = firstPageTick(sc, sc.seed);
  const s = run(sc, at(fp, ['scale-service', 'service-1']), sc.seed, fp + 5);
  assert.equal(metric(s, 'db-primary', 'saturation'), 1);
  assert.ok(firingAlerts(s).some((a) => a.id === 'db-hot'));
});

test('cascading-failure: the optimal run resolves for seeds 0 to 49', () => {
  const sc = load('cascading-failure');
  for (let seed = 0; seed < 50; seed++) {
    const fp = firstPageTick(sc, seed);
    assert.equal(run(sc, schedule(fp, sc.optimalPath), seed).status, 'resolved', `seed ${seed}`);
  }
});

test('split-brain: failing over before shedding leaves the replica overloaded, shedding alone leaves the conflicts', () => {
  const sc = load('split-brain');
  const fp = firstPageTick(sc, sc.seed);
  const failoverFirst = run(sc, at(fp, ['failover', 'db-replica'], ['shed-load', 'lb']));
  assert.notEqual(failoverFirst.status, 'resolved');
  const shedOnly = run(sc, at(fp, ['shed-load', 'lb']));
  assert.notEqual(shedOnly.status, 'resolved');
  const calm = run(sc, schedule(fp, sc.optimalPath), sc.seed, fp + 8);
  assert.equal(metric(calm, 'db-primary', 'errorRate'), 0);
  assert.equal(calm.params['db-replica'].writers, 1);
});

test('connection-pool-exhaustion: the pool fix still resolves after a harmful scale-out (the pool is re-sized for six instances)', () => {
  const sc = load('connection-pool-exhaustion');
  const fp = firstPageTick(sc, sc.seed);
  const s = run(sc, at(fp, ['scale-service', 'service-1'], ['raise-pool-size', 'service-1']));
  assert.equal(s.status, 'resolved');
  assert.ok(s.params['service-1'].instances * s.params['service-1'].poolSize <= s.params['db-primary'].maxConnections);
  const plain = run(sc, schedule(fp, sc.optimalPath));
  assert.equal(plain.params['service-1'].instances * plain.params['service-1'].poolSize, 120);
});

test('n-plus-one: rolling back restores one query per request', () => {
  const sc = load('n-plus-one');
  const fp = firstPageTick(sc, sc.seed);
  const calm = run(sc, schedule(fp, sc.optimalPath), sc.seed, fp + 6);
  assert.equal(calm.edgeParams['service-1>db-primary'].calls, 1);
  assert.ok(metric(calm, 'db-primary', 'rps') < 2000);
  const sick = run(sc, [], sc.seed, fp + 3);
  assert.ok(metric(sick, 'db-primary', 'rps') > 8000);
});

test('expiring-certificate: renewing clears the handshake errors on the next tick and the result is Textbook-fast', () => {
  const sc = load('expiring-certificate');
  const fp = firstPageTick(sc, sc.seed);
  const sick = run(sc, [], sc.seed, fp);
  assert.ok(metric(sick, 'lb', 'errorRate') > 0.5);
  const fixed = run(sc, schedule(fp, sc.optimalPath), sc.seed, fp + 2);
  assert.ok(metric(fixed, 'lb', 'errorRate') < 0.01);
  assert.equal(result(run(sc, schedule(fp, sc.optimalPath))).harmful, 0);
});
