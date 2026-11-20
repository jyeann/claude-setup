// Property test (D8 style) on a stress scenario: wild effects, retries, breakers, pools, spikes. The engine must never throw an invariant error
// and an independent re-check of every tick must pass. Also: runs are bounded and never resolve without help.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step, canApply, metric, result } from '../public/js/engine/engine.js';
import { next, initial } from '../public/js/engine/prng.js';
import { FIX_IDS, NODE_TYPES } from '../public/js/engine/catalogue.js';
import { fixture } from './fixtures/load.js';

const eff = (path, op, value, extra = {}) => ({ path, op, value, ...extra });
const stress = () => fixture((r) => {
  r.workload = [[0, 1], [20, 20], [40, 0], [60, 5]];
  r.topology.nodes['service-1'].workers = 50;
  r.topology.nodes['service-1'].poolSize = 20;
  r.topology.nodes['service-1'].backlogMax = 500;
  r.topology.nodes['db-primary'].maxConnections = 30;
  r.topology.nodes['db-primary'].connOverhead = 0.005;
  r.topology.nodes['db-primary'].shards = 4;
  r.topology.nodes['db-primary'].hotShare = 0.25;
  r.topology.edges.find((e) => e.from === 'lb' && e.to === 'service-1').retries = 5;
  r.topology.edges.find((e) => e.from === 'cache').retries = 3;
  r.actions = {
    'scale-service': { cost: 1, effects: { 'service-1': [eff('node:service-1.instances', 'add', 7), eff('node:service-2.capFactor', 'mul', 0)], 'service-2': [eff('node:service-2.capFactor', 'set', 0)] } },
    'add-ttl-jitter': { cost: 1, effects: { cache: [eff('node:cache.hitRate', 'set', 1, { ramp: 7 })] } },
    'circuit-breaker': { cost: 1, effects: { 'service-1': [eff('edge:lb>service-1.breaker', 'set', true), eff('edge:lb>service-1.fallback', 'set', false)], 'service-2': [eff('edge:service-2>third-party.breaker', 'set', true)] } },
    'backoff-jitter': { cost: 1, effects: { 'service-1': [eff('edge:lb>service-1.backoff', 'set', true), eff('edge:lb>service-1.retries', 'add', 5)] } },
    'shed-load': { cost: 1, effects: { lb: [eff('node:lb.shed', 'set', 0.9, { ramp: 3 })] } },
    failover: { cost: 1, effects: { 'db-primary': [eff('node:db-primary.capFactor', 'set', 0), eff('node:db-primary.writers', 'set', 2), eff('node:db-primary.conflictRate', 'set', 1)] } },
    'shard-rekey': { cost: 1, effects: { 'db-primary': [eff('node:db-primary.hotShare', 'set', 1), eff('node:db-primary.shards', 'set', 64)] } },
    rollback: { cost: 1, effects: { 'service-1': [eff('node:service-1.extraMs', 'set', 30000), eff('node:service-1.baseMs', 'set', 10000)] } },
    'raise-pool-size': { cost: 1, effects: { 'service-1': [eff('node:service-1.poolSize', 'set', 1000)] } },
    'renew-cert': { cost: 1, effects: { lb: [eff('node:lb.errorBase', 'set', 1), eff('node:lb.timeoutMs', 'set', 50)] } },
  };
  r.optimalPath = [{ id: 'add-ttl-jitter', node: 'cache' }];
  r.budget = 12;
  r.harmfulWhy = {};
});

const violations = (sc, s) => {
  const bad = [];
  for (const id of Object.keys(s.params)) {
    for (const name of ['p50', 'p99', 'queue', 'rps', 'missRps', 'connections', 'errorRate', 'saturation']) if (!Number.isFinite(metric(s, id, name))) bad.push(`non-finite ${name} on ${id}`);
    if (!(metric(s, id, 'errorRate') >= 0 && metric(s, id, 'errorRate') <= 1)) bad.push(`errorRate ${id}`);
    if (!(metric(s, id, 'saturation') >= 0 && metric(s, id, 'saturation') <= 1)) bad.push(`saturation ${id}`);
    if (!(metric(s, id, 'p50') >= 0 && metric(s, id, 'p50') <= metric(s, id, 'p99') && metric(s, id, 'p99') <= 30000)) bad.push(`latency ${id}`);
    const cap = s.params[id].maxDepth ?? s.params[id].backlogMax;
    if (typeof cap === 'number' && !(metric(s, id, 'queue') >= 0 && metric(s, id, 'queue') <= cap)) bad.push(`queue ${id}`);
  }
  if (!(Number.isInteger(s.budgetLeft) && s.budgetLeft >= 0 && s.budgetLeft <= sc.budget)) bad.push('budget');
  if (!(s.tick <= sc.maxTicks + 10)) bad.push('tick');
  return bad;
};

test('invariants hold for 25 seeds of random legal action logs on a stress scenario, and every run ends within maxTicks + 10', () => {
  const sc = stress();
  const nodes = Object.keys(sc.topology.nodes);
  for (let seed = 0; seed < 25; seed++) {
    let rng = initial(`inv-${seed}`, seed);
    const draw = () => { const [n, u] = next(rng); rng = n; return u; };
    const plan = [];
    const n = 1 + Math.floor(draw() * 12);
    for (let i = 0; i < n; i++) {
      const pick = Math.floor(draw() * (nodes.length + 1));
      plan.push({ t: Math.floor(draw() * 61), id: FIX_IDS[Math.floor(draw() * FIX_IDS.length)], node: pick === nodes.length ? null : nodes[pick] });
    }
    plan.sort((a, b) => a.t - b.t);
    let s = createRun(sc, seed);
    let p = 0;
    let guard = 0;
    while (s.status === 'running') {
      const acts = [];
      while (p < plan.length && plan[p].t < s.tick) p++;
      while (p < plan.length && plan[p].t === s.tick) { if (canApply(s, plan[p].id, plan[p].node).ok) acts.push({ id: plan[p].id, node: plan[p].node }); p++; }
      s = step(s, acts);
      assert.deepEqual(violations(sc, s), [], `seed ${seed} tick ${s.tick}`);
      assert.ok(++guard <= 611);
    }
    assert.ok(['resolved', 'out-of-budget'].includes(s.status));
    assert.ok(s.series.p99.length <= 611);
  }
});

test('every action type can be applied to every legal node without breaking an invariant', () => {
  const sc = stress();
  for (const id of FIX_IDS) {
    for (const node of Object.keys(sc.topology.nodes)) {
      let s = createRun(sc, 3);
      for (let i = 0; i < 6; i++) s = step(s, []);
      if (!canApply(s, id, node).ok) continue;
      s = step(s, [{ id, node }]);
      for (let i = 0; i < 40 && s.status === 'running'; i++) s = step(s, []);
      assert.deepEqual(violations(sc, s), [], `${id}@${node} (${NODE_TYPES[node]})`);
    }
  }
});

test('with no actions every run ends out-of-budget inside maxTicks + 10 and never resolves', () => {
  for (const maxTicks of [60, 600]) {
    const sc = fixture((r) => { r.maxTicks = maxTicks; });
    let s = createRun(sc, 1);
    while (s.status === 'running') s = step(s, []);
    assert.equal(s.status, 'out-of-budget');
    assert.ok(s.tick <= maxTicks + 10);
    assert.equal(result(s).timeToMitigate, null);
    assert.equal(s.series.p99.length, s.tick + 1);
  }
});
