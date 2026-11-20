// Physics (design.md 3.2), hand-computed. computeTick is driven directly with u = 0.5 so client noise is exactly zero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTick, nextBreakers, retryAmplification, compileTopology, metric, q4, METRICS } from '../public/js/engine/model.js';
import { node, edge, world } from './fixtures/load.js';

const run = (w, { prev = w.prev, breakers = {}, wMult = 1, us = [0.5] } = {}) => computeTick(w.T, w.params, w.edgeParams, prev, breakers, wMult, us);
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const line = (over = {}) => world(
  { clients: node('clients', { rps: 100 }), lb: node('lb', { capacity: 1000, baseMs: 10, ...over.lb }), 'service-1': node('service-1', { capacity: 200, baseMs: 20, ...over.svc }) },
  [edge('clients', 'lb', over.e1), edge('lb', 'service-1', over.e2)],
);

test('retryAmplification: loop sum with the 0.95 cap, backoff keeps a quarter of the extra load', () => {
  assert.equal(retryAmplification(0.5, 2, false), 1.75);
  assert.equal(retryAmplification(0.5, 2, true), 1.1875);
  assert.equal(retryAmplification(0, 3, false), 1);
  assert.equal(retryAmplification(0.99, 1, false), 1.95);
  assert.equal(retryAmplification(1, 1, false), 1.95);
  assert.equal(retryAmplification(0.5, 0, true), 1);
  assert.equal(retryAmplification(-1, 3, false), 1, 'negative error rates are treated as zero');
  assert.equal(retryAmplification(0.5, 5, false), 1.96875);
});

test('compileTopology orders nodes topologically (ties by document order) and marks async and replication edges', () => {
  const w = world(
    { clients: node('clients', { rps: 10 }), lb: node('lb', { capacity: 10 }), 'service-1': node('service-1', { capacity: 10 }), queue: node('queue', { capacity: 10, maxDepth: 100 }),
      consumer: node('consumer', { capacity: 10 }), 'db-primary': node('db-primary', { capacity: 10 }), 'db-replica': node('db-replica', { capacity: 10 }) },
    [edge('clients', 'lb'), edge('lb', 'service-1'), edge('service-1', 'queue'), edge('queue', 'consumer'), edge('consumer', 'db-primary'), edge('db-primary', 'db-replica')],
  );
  assert.deepEqual(w.T.topo, ['clients', 'lb', 'service-1', 'queue', 'consumer', 'db-primary', 'db-replica']);
  assert.deepEqual(w.T.clients, ['clients']);
  assert.equal(w.T.edges.find((e) => e.key === 'queue>consumer').async, true);
  assert.equal(w.T.edges.find((e) => e.key === 'db-primary>db-replica').repl, true);
  assert.equal(w.T.edges.find((e) => e.key === 'lb>service-1').async, false);
  assert.deepEqual(w.T.inE['service-1'].map((e) => e.key), ['lb>service-1']);
});

test('utilisation, saturation and latency of a healthy line: rho = load / capacity, p50 = baseMs / (1 - rho) summed down the path', () => {
  const { m, flow } = run(line());
  assert.equal(m.lb.rps, 100);
  near(m.lb.saturation, 0.1);
  near(m['service-1'].saturation, 0.5);
  near(m['service-1'].p50, 20 / (1 - 0.5));
  near(m['service-1'].p99, 3 * 20 / (1 - 0.5));
  near(m.lb.p50, 10 / 0.9 + 40);
  near(m.lb.p99, 30 / 0.9 + 120);
  assert.equal(m.clients.rps, 100);
  assert.equal(m.clients.saturation, 0);
  near(m.clients.p50, m.lb.p50);
  assert.equal(flow['clients>lb'], 100);
  assert.equal(flow['lb>service-1'], 100);
  assert.equal(m['service-1'].hitRate, null);
  for (const id of Object.keys(m)) for (const k of METRICS) assert.ok(k in m[id], `${id}.${k}`);
});

test('the workload multiplier and the client noise draw scale offered load: rps * W * (1 + 0.02 * (2u - 1))', () => {
  assert.equal(run(line(), { wMult: 3 }).m.lb.rps, 300);
  near(run(line(), { us: [1] }).m.lb.rps, 102);
  near(run(line(), { us: [0] }).m.lb.rps, 98);
});

test('overload without a backlog drops the excess and reports it as an error rate', () => {
  const { m } = run(line({ svc: { capacity: 50 } }));
  near(m['service-1'].saturation, 1);
  near(m['service-1'].errorRate, 0.5);
  assert.equal(m['service-1'].queue, 0);
  near(m.lb.errorRate, 0.5, 1e-9);
  assert.equal(m.clients.errorRate, m.lb.errorRate, 'clients see the load balancer error rate with no retries');
});

test('a backlog absorbs overload up to backlogMax, drains at the spare capacity and adds wait time', () => {
  const w = line({ svc: { capacity: 80, backlogMax: 1000 } });
  const a = run(w);
  assert.equal(a.m['service-1'].queue, 20);
  assert.equal(a.m['service-1'].errorRate, 0);
  near(a.m['service-1'].p50, 20 / (1 - 0.95) + 1000 * 20 / 80, 1e-6);
  const spill = run(line({ svc: { capacity: 80, backlogMax: 10 } }));
  assert.equal(spill.m['service-1'].queue, 10);
  near(spill.m['service-1'].errorRate, 10 / 100);
  const drain = run(w, { prev: { ...w.prev, 'service-1': { ...w.prev['service-1'], queue: 50 } }, wMult: 0.5 });
  assert.equal(drain.m['service-1'].queue, 20, 'prev 50 + load 50 - capacity 80');
  assert.equal(drain.m['service-1'].rps, 50);
});

test('saturation is clamp(rho, 0, 1) even while a backlog exists', () => {
  const w = line({ svc: { capacity: 200, backlogMax: 1000 } });
  const r = run(w, { prev: { ...w.prev, 'service-1': { ...w.prev['service-1'], queue: 500 } } });
  assert.ok(r.m['service-1'].queue > 0);
  near(r.m['service-1'].saturation, 0.5);
});

test('shed rejects a fraction at the load balancer without counting it as an error', () => {
  const { m, flow } = run(line({ lb: { shed: 0.4 } }));
  near(flow['lb>service-1'], 60);
  near(m['service-1'].rps, 60);
  assert.equal(m.lb.errorRate, 0);
  assert.equal(m.lb.rps, 100);
});

test('workers cap throughput at workers * instances * 1000 / previous p50, so slow dependencies cascade', () => {
  const w = line({ svc: { capacity: 1000, workers: 10 } });
  const prev = { ...w.prev, 'service-1': { ...w.prev['service-1'], p50: 500 } };
  const r = run(w, { prev });
  near(r.m['service-1'].saturation, 1);
  near(r.m['service-1'].errorRate, 0.8, 1e-9);
  const calm = run(w, { prev: { ...w.prev, 'service-1': { ...w.prev['service-1'], p50: 10 } } });
  assert.equal(calm.m['service-1'].errorRate, 0, '10 workers at 10 ms allow 1000 rps');
});

test('a node timeout adds errors once p99 passes timeoutMs: (p99 - t) / (2t), capped at 1', () => {
  const w = line({ svc: { capacity: 200, baseMs: 20, extraMs: 5000, timeoutMs: 3000 } });
  const r = run(w);
  const p99 = r.m['service-1'].p99;
  assert.ok(p99 > 3000);
  near(r.m['service-1'].errorRate, Math.min(1, (p99 - 3000) / 6000), 1e-9);
  const edgeCase = run(line({ svc: { capacity: 200, baseMs: 20, extraMs: 3000 - 3 * 20 / 0.5 - 0.0, timeoutMs: 3000 } }));
  near(edgeCase.m['service-1'].p99, 3000, 1e-6);
  assert.equal(edgeCase.m['service-1'].errorRate, 0, 'p99 equal to the timeout is not a timeout');
});

test('latency is clamped to 30,000 ms and p99 is never below p50', () => {
  const r = run(line({ svc: { capacity: 200, extraMs: 30000 } }));
  assert.equal(r.m['service-1'].p50, 30000);
  assert.equal(r.m['service-1'].p99, 30000);
  assert.equal(r.m.lb.p99, 30000);
  assert.equal(r.m.lb.p50, 30000);
});

test('retries amplify the offered load by the previous error rate of the callee', () => {
  const w = line({ e2: { retries: 2 } });
  const prev = { ...w.prev, 'service-1': { ...w.prev['service-1'], errorRate: 0.5 } };
  near(run(w, { prev }).flow['lb>service-1'], 100 * 1.75);
  const back = line({ e2: { retries: 2, backoff: true } });
  near(run(back, { prev: { ...back.prev, 'service-1': { ...back.prev['service-1'], errorRate: 0.5 } } }).flow['lb>service-1'], 118.75);
  near(run(w).flow['lb>service-1'], 100, 1e-9);
});

test('a child error passes up after retries as err^(retries+1), weighted by calls and share', () => {
  const w = line({ svc: { capacity: 50 }, e2: { retries: 1 } });
  const r = run(w);
  near(r.m['service-1'].errorRate, 1 - 50 / 100, 1e-9);
  near(r.m.lb.errorRate, 0.25, 1e-9);
  const half = line({ svc: { capacity: 50 }, e2: { share: 0.5 } });
  near(run(half).m.lb.errorRate, 0.5 * (1 - 50 / 50), 1e-9, 'half the traffic: 50 rps against capacity 50 is fine');
});

test('calls multiply the downstream flow and latency; share scales it down', () => {
  const r = run(line({ e2: { calls: 3 } }));
  assert.equal(r.flow['lb>service-1'], 300);
  near(r.m.lb.p50, 10 / 0.9 + 3 * r.m['service-1'].p50);
  const s = run(line({ e2: { share: 0.25 } }));
  assert.equal(s.flow['lb>service-1'], 25);
  near(s.m.lb.p99, 30 / 0.9 + 0.25 * s.m['service-1'].p99);
});

test('p99 adds one slow call plus the rest at the median when a node makes one or more calls', () => {
  const r = run(line({ e2: { calls: 3 } }));
  near(r.m.lb.p99, 30 / 0.9 + 2 * r.m['service-1'].p50 + r.m['service-1'].p99);
});

test('a cache sends only misses downstream and carries the reload cost on itself', () => {
  const w = world(
    { clients: node('clients', { rps: 1000 }), 'service-1': node('service-1', { capacity: 5000 }), cache: node('cache', { capacity: 2000, hitRate: 0.9, missCost: 1 }), 'db-primary': node('db-primary', { capacity: 500 }) },
    [edge('clients', 'service-1'), edge('service-1', 'cache'), edge('cache', 'db-primary')],
  );
  const r = run(w, { us: [0.5] });
  near(r.flow['cache>db-primary'], 100);
  near(r.m.cache.missRps, 100);
  near(r.m.cache.hitRate, 0.9);
  near(r.m.cache.saturation, (1000 + 100) / 2000);
  near(r.m['db-primary'].saturation, 100 / 500);
  w.params.cache.hitRate = 0.1;
  const cold = run(w);
  near(cold.m.cache.missRps, 900);
  near(cold.m.cache.saturation, (1000 + 900) / 2000);
  near(cold.m['db-primary'].saturation, 1);
  assert.ok(cold.m['db-primary'].errorRate > 0);
});

test('breaker: closed gives full flow, open cuts it (error 0 with fallback, full weight without), half-open lets 10% through', () => {
  const w = line({ svc: { capacity: 50 }, e2: { breaker: true } });
  const closed = run(w, { breakers: {} });
  assert.equal(closed.flow['lb>service-1'], 100);
  const open = run(w, { breakers: { 'lb>service-1': { state: 'open', left: 3 } } });
  assert.equal(open.flow['lb>service-1'], 0);
  assert.equal(open.m.lb.errorRate, 0, 'fallback true: the caller degrades instead of failing');
  near(open.m.lb.p50, 10 / 0.9);
  w.edgeParams['lb>service-1'].fallback = false;
  assert.equal(run(w, { breakers: { 'lb>service-1': { state: 'open', left: 3 } } }).m.lb.errorRate, 1);
  const half = run(w, { breakers: { 'lb>service-1': { state: 'half', left: 1 } } });
  near(half.flow['lb>service-1'], 10);
  const off = line({ svc: { capacity: 50 } });
  assert.equal(run(off, { breakers: { 'lb>service-1': { state: 'open', left: 3 } } }).flow['lb>service-1'], 100, 'an edge without a breaker ignores the state');
});

test('nextBreakers trips at error >= 0.5 or p99 >= timeout, stays open 5 ticks, then half-opens and closes below 0.2', () => {
  const w = line({ e2: { breaker: true } });
  const m = (err, p99) => ({ 'service-1': { errorRate: err, p99 } });
  const step = (b, mm) => nextBreakers(w.T, w.params, w.edgeParams, b, mm);
  const key = 'lb>service-1';
  assert.equal(step({}, m(0.49, 100))[key].state, 'closed');
  assert.deepEqual(step({}, m(0.5, 100))[key], { state: 'open', left: 5 });
  assert.deepEqual(step({}, m(0, 3000))[key], { state: 'open', left: 5 }, 'p99 equal to the 3000 ms default timeout trips');
  assert.equal(step({}, m(0, 2999))[key].state, 'closed');
  let b = step({}, m(0.9, 100));
  const seen = [];
  for (let i = 0; i < 6; i++) { b = step(b, m(0.9, 100)); seen.push(b[key].state); }
  assert.deepEqual(seen, ['open', 'open', 'open', 'open', 'half', 'open'], 'half-open for one tick, back to open while the child is still failing');
  assert.equal(step({ [key]: { state: 'half', left: 1 } }, m(0.19, 100))[key].state, 'closed');
  assert.equal(step({ [key]: { state: 'half', left: 1 } }, m(0.2, 100))[key].state, 'open');
  assert.deepEqual(nextBreakers(w.T, w.params, { ...w.edgeParams, [key]: { ...w.edgeParams[key], breaker: false } }, { [key]: { state: 'open', left: 2 } }, m(0.9, 1)), {}, 'a removed breaker is forgotten');
});

test('database connections: pools pre-fill, connOverhead adds utilisation and connections above the limit become errors', () => {
  const w = world(
    { clients: node('clients', { rps: 100 }), 'service-1': node('service-1', { capacity: 1000, instances: 3, poolSize: 30 }), 'db-primary': node('db-primary', { capacity: 1000, maxConnections: 120, connOverhead: 0.002 }) },
    [edge('clients', 'service-1'), edge('service-1', 'db-primary')],
  );
  const ok = run(w);
  assert.equal(ok.m['db-primary'].connections, 90);
  near(ok.m['db-primary'].saturation, 0.1 + 0.18);
  assert.equal(ok.m['db-primary'].errorRate, 0);
  w.params['service-1'].instances = 6;
  const over = run(w);
  assert.equal(over.m['db-primary'].connections, 180);
  near(over.m['db-primary'].errorRate, (180 - 120) / 180);
  w.params['service-1'].instances = 4;
  assert.equal(run(w).m['db-primary'].errorRate, 0, '120 connections is exactly the limit');
});

test('pool wait: required concurrency above instances * poolSize becomes errors on the caller', () => {
  const w = world(
    { clients: node('clients', { rps: 1000 }), 'service-1': node('service-1', { capacity: 5000, poolSize: 10 }), 'db-primary': node('db-primary', { capacity: 5000 }) },
    [edge('clients', 'service-1'), edge('service-1', 'db-primary')],
  );
  const prev = { ...w.prev, 'db-primary': { ...w.prev['db-primary'], p50: 40 } };
  const r = run(w, { prev });
  near(r.m['service-1'].errorRate, (40 - 10) / 40 + 0, 1e-9);
  const fine = run(w, { prev: { ...w.prev, 'db-primary': { ...w.prev['db-primary'], p50: 10 } } });
  assert.equal(fine.m['service-1'].errorRate, 0, 'needs exactly 10 connections');
});

test('a hot shard drives database utilisation: rho = max(total, hot share load / per-shard capacity)', () => {
  const mk = (hot) => world(
    { clients: node('clients', { rps: 2000 }), 'service-1': node('service-1', { capacity: 5000 }), 'db-primary': node('db-primary', { capacity: 4000, shards: 4, hotShare: hot }) },
    [edge('clients', 'service-1'), edge('service-1', 'db-primary')],
  );
  near(run(mk(0.25)).m['db-primary'].saturation, 0.5, 1e-9);
  const hot = run(mk(0.7));
  near(hot.m['db-primary'].saturation, 1);
  assert.ok(hot.m['db-primary'].p50 >= 5 / 0.05 - 1e-9, 'rho above 0.95 is capped, so the latency factor is 20');
});

test('split brain: each extra writer adds conflictRate to the error rate', () => {
  const w = world(
    { clients: node('clients', { rps: 100 }), 'service-1': node('service-1', { capacity: 5000 }), 'db-primary': node('db-primary', { capacity: 5000, writers: 2, conflictRate: 0.08 }) },
    [edge('clients', 'service-1'), edge('service-1', 'db-primary')],
  );
  near(run(w).m['db-primary'].errorRate, 0.08);
  near(run(w).m['service-1'].errorRate, 0.08);
  w.params['db-primary'].writers = 1;
  assert.equal(run(w).m['db-primary'].errorRate, 0);
});

test('queue: producers fill it, the consumer capacity drains it, overflow is dropped and errors flow back to the producer only', () => {
  const w = world(
    { clients: node('clients', { rps: 100 }), 'service-1': node('service-1', { capacity: 5000 }), queue: node('queue', { capacity: 5000, maxDepth: 1000 }), consumer: node('consumer', { capacity: 60 }), 'db-primary': node('db-primary', { capacity: 5000 }) },
    [edge('clients', 'service-1'), edge('service-1', 'queue'), edge('queue', 'consumer'), edge('consumer', 'db-primary')],
  );
  const a = run(w);
  assert.equal(a.m.queue.queue, 40, 'depth = 100 in - 60 drained');
  assert.equal(a.m.consumer.rps, 60);
  near(a.m.queue.saturation, 40 / 1000);
  assert.equal(a.m['db-primary'].rps, 60);
  assert.equal(a.m['service-1'].errorRate, 0);
  const full = run(w, { prev: { ...w.prev, queue: { ...w.prev.queue, queue: 990 } } });
  assert.equal(full.m.queue.queue, 1000);
  near(full.m.queue.errorRate, 30 / 100);
  near(full.m['service-1'].errorRate, 0.3);
  near(full.m.consumer.errorRate, 0, 1e-12);
  assert.ok(full.m.queue.p50 > a.m.queue.p50, 'queue wait grows with depth');
  assert.ok(full.m['service-1'].p50 < 100, 'producers only see the enqueue time, not the wait');
});

test('a replication edge between databases carries no load, latency or error', () => {
  const w = world(
    { clients: node('clients', { rps: 100 }), 'service-1': node('service-1', { capacity: 5000 }), 'db-primary': node('db-primary', { capacity: 5000 }), 'db-replica': node('db-replica', { capacity: 5000, extraMs: 900 }) },
    [edge('clients', 'service-1'), edge('service-1', 'db-primary'), edge('db-primary', 'db-replica', { calls: 0.2 })],
  );
  const r = run(w);
  assert.equal(r.m['db-replica'].rps, 0);
  assert.ok(r.m['db-primary'].p50 < 100, 'replica latency does not leak into the primary');
  near(r.flow['db-primary>db-replica'], 20);
});

test('a node with zero capacity reads as saturated and fails everything instead of dividing by zero', () => {
  const r = run(line({ svc: { capFactor: 0 } }));
  assert.equal(r.m['service-1'].saturation, 1);
  assert.equal(r.m['service-1'].errorRate, 1);
  const idle = run(line({ svc: { capFactor: 0 } }), { wMult: 0 });
  assert.equal(idle.m['service-1'].saturation, 0);
  assert.equal(idle.m['service-1'].errorRate, 0);
});

test('metric() quantises: integers for ms, rps and queue, four decimals for rates, null for missing hitRate', () => {
  const state = { m: { x: { p50: 12.5, p99: 12.4, errorRate: 0.123456, saturation: 0.99995, queue: 3.5, hitRate: 0.87654, rps: 99.5, missRps: 0.4, connections: 7.2 }, y: { hitRate: null, p50: 1 } } };
  assert.equal(metric(state, 'x', 'p50'), 13);
  assert.equal(metric(state, 'x', 'p99'), 12);
  assert.equal(metric(state, 'x', 'errorRate'), 0.1235);
  assert.equal(metric(state, 'x', 'saturation'), 1);
  assert.equal(metric(state, 'x', 'queue'), 4);
  assert.equal(metric(state, 'x', 'hitRate'), 0.8765);
  assert.equal(metric(state, 'x', 'rps'), 100);
  assert.equal(metric(state, 'x', 'missRps'), 0);
  assert.equal(metric(state, 'x', 'connections'), 7);
  assert.equal(metric(state, 'y', 'hitRate'), null);
  assert.equal(metric(state, 'nope', 'p50'), null);
  assert.equal(q4(0.00005), 0.0001);
  assert.equal(q4(0.00004), 0);
});
