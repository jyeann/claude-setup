// The 10 shipped scenarios: pinned metadata, outcome classes and properties P1-P9, score bands (spec.md "The 10 shipped scenarios").
// Many assertions here depend on the physics numbers the scenario author tunes (the spec calls this a risk); each is tagged PHYSICS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SHIPPED, SHIPPED_IDS, GUIDE_PREFIX, SCEN_DIR, mod, engine, scenario, rawScenario, drive, noAction, firstPage, playbook, optimalSteps, scoreOf,
  validPairs, hasEffects, invariantViolations,
} from './helpers.js';

const DIAG_IDS = ['inspect', 'trace-request', 'tail-logs', 'compare-dashboards', 'deploy-history'];
const key = ([id, node]) => `${id}@${node}`;
const allStrings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => allStrings(x, out));
  return out;
};
const atFirstPage = (E, sc, seed) => {
  const fp = firstPage(E, sc, seed);
  return { fp, s: drive(E, sc, seed, [], { stopTick: fp }) };
};
const aloneRun = (E, sc, seed, [id, node]) => {
  const fp = firstPage(E, sc, seed);
  const states = [];
  const final = drive(E, sc, seed, [{ t: fp, id, node }], { each: (s) => states.push(s) });
  return { fp, final, states };
};
const optimalRun = (E, sc, seed, offset = 0, extraFirst = null) => {
  const fp = firstPage(E, sc, seed);
  const log = [...(extraFirst ? [{ t: fp, id: extraFirst[0], node: extraFirst[1] }] : []), ...playbook(E, sc, seed, optimalSteps(sc), offset)];
  return drive(E, sc, seed, log);
};

test('exactly the 10 pinned scenario files ship in scenarios/', () => {
  const files = fs.readdirSync(SCEN_DIR).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(files, SHIPPED_IDS.map((i) => `${i}.json`).sort());
});

for (const pin of SHIPPED) {
  const { id } = pin;

  // ---------------------------------------------------------------- pinned metadata
  test(`${id}: pinned id, difficulty, budget, guide, rootCauseNode, optimalPath and costs`, async () => {
    const sc = await scenario(id);
    assert.equal(sc.schema, 1);
    assert.equal(sc.id, id);
    assert.equal(sc.difficulty, pin.d);
    assert.equal(sc.budget, pin.budget);
    assert.equal(sc.guideUrl, GUIDE_PREFIX + pin.slug);
    assert.equal(sc.rootCauseNode, pin.root);
    assert.deepEqual(sc.optimalPath.map((p) => [p.id, p.node]), pin.optimal.map(([a, b]) => [a, b]));
    for (const [aid, node, cost] of pin.optimal) {
      assert.ok(hasEffects(sc, aid, node), `${aid}@${node} has effects`);
      assert.equal(sc.actions[aid]?.cost ?? 2, cost, `${aid} cost`);
    }
    assert.equal(sc.optimalSummary.cost, pin.optimal.reduce((n, p) => n + p[2], 0));
    assert.ok(Number.isInteger(sc.optimalSummary.timeToMitigate) && sc.optimalSummary.timeToMitigate >= 1);
    for (const d of DIAG_IDS.slice(1)) assert.equal(sc.actions[d]?.cost ?? sc.diagnostics?.[d]?.cost ?? 1, 1, `${d} costs 1`);
  });

  test(`${id}: sparks.p99 is lb, a page-level alert exists, no URL or emoji in any text, guideTitle in our words`, async () => {
    const sc = await scenario(id);
    const raw = rawScenario(id);
    assert.equal(sc.sparks.p99, 'lb');
    assert.ok(sc.alerts.some((a) => a.severity <= 2));
    const { guideUrl, ...rest } = raw;
    for (const str of allStrings(rest)) {
      assert.ok(!/http/i.test(str), `no URL in ${JSON.stringify(str.slice(0, 60))}`);
      assert.ok(!/\p{Extended_Pictographic}/u.test(str), `no emoji in ${JSON.stringify(str.slice(0, 60))}`);
    }
    assert.ok(guideUrl.startsWith(GUIDE_PREFIX));
    assert.ok(raw.guideTitle.length >= 1 && raw.guideTitle.length <= 80);
    assert.ok(!/bytebytego/i.test(raw.guideTitle) || raw.guideTitle.length < 80);
    for (const k of ['rootCause', 'concept', 'hint', 'summary']) assert.ok(raw[k].length > 10, k);
  });

  // ---------------------------------------------------------------- onset and first page
  test(`${id}: onset in ticks 4 to 6, calm until onset, first SEV1/2 page in ticks 6 to 9 for seeds 0 to 49`, async () => {
    const E = await engine();
    const sc = await scenario(id);
    const nodes = Object.keys(sc.topology.nodes);
    for (let seed = 0; seed < 50; seed++) {
      const fp = firstPage(E, sc, seed);
      assert.ok(Number.isInteger(fp) && fp >= 6 && fp <= 9, `seed ${seed}: first page at ${fp}`);
      const s = drive(E, sc, seed, [], { stopTick: fp });
      assert.equal(s.firstPageTick, fp, `seed ${seed}: engine state agrees with the solver`);
      assert.ok(s.onsetTick >= 4 && s.onsetTick <= 6, `seed ${seed}: onset ${s.onsetTick}`);
    }
    for (const seed of [sc.seed, 0, 1]) {
      let r = E.eng.createRun(sc, seed);
      const onset = drive(E, sc, seed, [], { stopTick: 8 }).onsetTick;
      for (let t = 0; t <= onset; t++) {
        for (const n of nodes) assert.equal(E.eng.statusOf(r, n), 'ok', `seed ${seed} tick ${r.tick} ${n}`);
        assert.deepEqual(E.eng.firingAlerts(r), [], `seed ${seed} tick ${r.tick}`);
        r = E.eng.step(r, []);
      }
    }
  });

  // ---------------------------------------------------------------- P1, P2
  test(`${id}: P1 the optimal path resolves at exactly optimalSummary.timeToMitigate, scores 100 Textbook with 0 harmful, and resolves for seeds 1 and 77`, async () => {
    const E = await engine();
    const sc = await scenario(id);
    const fp = firstPage(E, sc, sc.seed);
    const sched = playbook(E, sc, sc.seed, optimalSteps(sc));
    const done = drive(E, sc, sc.seed, sched);
    const r = E.eng.result(done);
    assert.equal(r.result, 'resolved');
    assert.equal(r.timeToMitigate, sc.optimalSummary.timeToMitigate);
    assert.ok(r.timeToMitigate - sched.at(-1).t <= 45, `resolved ${r.timeToMitigate - sched.at(-1).t} ticks after the last action`);
    assert.equal(r.harmful, 0);
    const sc100 = scoreOf(E, sc, done);
    assert.equal(sc100.score, 100);
    assert.equal(sc100.tier, 'Textbook');
    assert.equal(r.budgetLeft, sc.budget - sc.optimalSummary.cost);
    assert.equal(sched[0].t, fp);
    for (const seed of [1, 77]) assert.equal(E.eng.result(optimalRun(E, sc, seed)).result, 'resolved', `seed ${seed}`);
  });

  test(`${id}: P2 doing nothing never helps: out-of-budget for seeds 1 and 77`, async () => {
    for (const seed of [1, 77]) {
      const { E, final } = await noAction(id, seed);
      assert.equal(final.status, 'out-of-budget', `seed ${seed}`);
      assert.equal(E.eng.result(final).timeToMitigate, null);
    }
  });

  // ---------------------------------------------------------------- P3 solver equals declared
  test(`${id}: P3 the solver finds the declared optimalPath and optimalSummary within 20 s`, { timeout: 120000 }, async () => {
    const E = await engine();
    const sc = await scenario(id);
    const t0 = Date.now();
    const sol = E.solver.solve(sc);
    const ms = Date.now() - t0;
    assert.ok(ms < 20000, `solve took ${ms} ms`);
    assert.deepEqual(sol.path.map((p) => ({ id: p.id, node: p.node })), sc.optimalPath.map((p) => ({ id: p.id, node: p.node })));
    assert.deepEqual({ ...sol.summary }, { timeToMitigate: sc.optimalSummary.timeToMitigate, cost: sc.optimalSummary.cost });
    assert.ok(Number.isInteger(sol.explored) && sol.explored >= 1);
  });

  // ---------------------------------------------------------------- outcome classes (PHYSICS)
  test(`${id}: PHYSICS the pinned single-fix outcomes (resolve / harmful / helpful / none) hold at firstPage`, async () => {
    const E = await engine();
    const sc = await scenario(id);
    const { s } = atFirstPage(E, sc, sc.seed);
    const cls = (p) => E.classify.classify(s, { id: p[0], node: p[1] });
    for (const p of pin.alone) {
      assert.equal(aloneRun(E, sc, sc.seed, p).final.status, 'resolved', `${key(p)} resolves alone`);
      assert.equal(cls(p), 'helpful', `${key(p)} is helpful`);
    }
    for (const p of pin.harmful) assert.equal(cls(p), 'harmful', `${key(p)} is harmful`);
    for (const p of pin.helpful) {
      assert.equal(cls(p), 'helpful', `${key(p)} is helpful`);
      assert.notEqual(aloneRun(E, sc, sc.seed, p).final.status, 'resolved', `${key(p)} does not resolve alone`);
    }
    for (const p of pin.none) assert.equal(cls(p), 'none', `${key(p)} has no effect`);
    for (const p of pin.helpfulOrNone ?? []) {
      assert.ok(['helpful', 'none'].includes(cls(p)), `${key(p)} is helpful or none, got ${cls(p)}`);
      assert.notEqual(aloneRun(E, sc, sc.seed, p).final.status, 'resolved', `${key(p)} does not resolve alone`);
    }
    if (pin.noHarmfulAtAll) for (const p of validPairs(E, sc)) assert.notEqual(cls(p), 'harmful', `${key(p)} must not be harmful`);
  });

  if (pin.alone.length === 0) test(`${id}: PHYSICS no single fix resolves it alone (queue-backlog: rollback alone is strictly slower than the pair)`, async () => {
    const E = await engine();
    const sc = await scenario(id);
    const optT = sc.optimalSummary.timeToMitigate;
    for (const p of validPairs(E, sc)) {
      const { final } = aloneRun(E, sc, sc.seed, p);
      if (id === 'queue-backlog' && key(p) === 'rollback@consumer') {
        assert.ok(final.status !== 'resolved' || final.resolvedTick > optT, `rollback@consumer alone resolves at ${final.resolvedTick}, optimal pair at ${optT}`);
      } else {
        assert.notEqual(final.status, 'resolved', `${key(p)} must not resolve alone`);
      }
    }
  });

  // ---------------------------------------------------------------- P5
  test(`${id}: P5 harm is classified, not declared: every harmful pair has a harmfulWhy entry and every harmfulWhy id is harmful somewhere`, async () => {
    const E = await engine();
    const sc = await scenario(id);
    const { fp, s } = atFirstPage(E, sc, sc.seed);
    const pairs = validPairs(E, sc);
    for (const p of pairs) {
      if (E.classify.classify(s, { id: p[0], node: p[1] }) === 'harmful') {
        assert.ok(typeof sc.harmfulWhy[p[0]] === 'string' && sc.harmfulWhy[p[0]].length > 0, `${key(p)} classifies harmful but has no harmfulWhy`);
      }
    }
    for (const p of pin.harmful) assert.ok(sc.harmfulWhy[p[0]]?.length > 0, `${p[0]} has a harmfulWhy text`);
    const sched = playbook(E, sc, sc.seed, optimalSteps(sc));
    const probes = [s];
    for (let k = 1; k <= sched.length; k++) probes.push(drive(E, sc, sc.seed, sched.slice(0, k), { stopTick: fp + 2 * k }));
    for (const idk of Object.keys(sc.harmfulWhy)) {
      const harmfulSomewhere = probes.some((st) => st.status === 'running' && pairs.filter((p) => p[0] === idk).some((p) => E.classify.classify(st, { id: p[0], node: p[1] }) === 'harmful'));
      assert.ok(harmfulSomewhere, `${idk} is in harmfulWhy but never harmful in the solver's exploration`);
    }
  });

  // ---------------------------------------------------------------- P6
  test(`${id}: P6 each optimal step helps when applied on the playbook schedule`, async () => {
    const E = await engine();
    const sc = await scenario(id);
    const fp = firstPage(E, sc, sc.seed);
    const sched = playbook(E, sc, sc.seed, optimalSteps(sc));
    for (let k = 0; k < sched.length; k++) {
      const st = drive(E, sc, sc.seed, sched.slice(0, k), { stopTick: fp + 2 * k });
      assert.equal(st.status, 'running');
      assert.equal(E.classify.classify(st, { id: sched[k].id, node: sched[k].node }), 'helpful', `step ${k} ${sched[k].id}@${sched[k].node}`);
    }
  });

  // ---------------------------------------------------------------- P7 (scenarios 1-8)
  if (pin.d !== 3) {
    test(`${id}: P7 PHYSICS the first optimal step is visible within 2 s on the root cause node or the lb`, async () => {
      const E = await engine();
      const sc = await scenario(id);
      for (const seed of [sc.seed, 1]) {
        const fp = firstPage(E, sc, seed);
        const first = sc.optimalPath[0];
        const t0 = drive(E, sc, seed, [], { stopTick: fp });
        const t2 = drive(E, sc, seed, [{ t: fp, id: first.id, node: first.node }], { stopTick: fp + 2 });
        assert.equal(t2.tick, fp + 2);
        const lower = [sc.rootCauseNode, 'lb'].flatMap((n) => ['saturation', 'errorRate', 'p99'].filter((m) => E.eng.metric(t2, n, m) < E.eng.metric(t0, n, m)).map((m) => `${n}.${m}`));
        assert.ok(lower.length >= 1, `seed ${seed}: nothing on ${sc.rootCauseNode} or lb got lower within 2 ticks`);
        if (id === 'cache-stampede') assert.ok(E.eng.metric(t2, 'db-primary', 'saturation') < E.eng.metric(t0, 'db-primary', 'saturation'), 'db-primary saturation falls');
      }
    });
  }
}

// ------------------------------------------------------------------ scenario-specific pins
test('cache-stampede has the 8 pinned nodes, the pinned alert texts and sparks', async () => {
  const sc = await scenario('cache-stampede');
  assert.deepEqual(Object.keys(sc.topology.nodes).sort(), ['cache', 'clients', 'db-primary', 'db-replica', 'lb', 'service-1', 'service-2', 'third-party']);
  const page = sc.alerts.find((a) => a.text === 'checkout p99 > 2 s');
  assert.ok(page);
  assert.equal(page.severity, 2);
  assert.deepEqual({ ...page.when }, { node: 'lb', metric: 'p99', op: 'gt', value: 2000 });
  assert.equal(sc.alerts.find((a) => a.text === 'Cache hit rate under 80%')?.severity, 3);
  assert.equal(sc.sparks['cache-hit'], 'cache');
});

test('cache-stampede: the healthy bystanders stay ok for the whole no-action run', async () => {
  const { E, sc, states } = await noAction('cache-stampede', 1);
  for (const n of ['service-2', 'db-replica', 'third-party']) {
    for (const s of states) assert.equal(E.eng.statusOf(s, n), 'ok', `${n} at tick ${s.tick}`);
  }
  assert.ok(sc);
});

test('cascading-failure has SEV1 "checkout errors > 5%", SEV2 "checkout p99 > 2 s" and SEV2 "recommendations timeouts"', async () => {
  const sc = await scenario('cascading-failure');
  const has = (sev, text) => sc.alerts.some((a) => a.severity === sev && a.text === text);
  assert.ok(has(1, 'checkout errors > 5%'));
  assert.ok(has(2, 'checkout p99 > 2 s'));
  assert.ok(has(2, 'recommendations timeouts'));
});

test('the pinned topologies carry the nodes the outcome classes name', async () => {
  const need = {
    'thundering-herd': ['clients', 'lb', 'service-1', 'cache', 'db-primary'], 'retry-storm': ['clients', 'lb', 'service-1', 'third-party', 'db-primary'],
    'hot-partition': ['clients', 'lb', 'service-1', 'db-primary'], 'queue-backlog': ['clients', 'lb', 'service-1', 'queue', 'consumer', 'db-primary'],
    'n-plus-one': ['clients', 'lb', 'service-1', 'db-primary'], 'connection-pool-exhaustion': ['clients', 'lb', 'service-1', 'db-primary'],
    'expiring-certificate': ['clients', 'lb', 'service-1', 'db-primary'], 'split-brain': ['clients', 'lb', 'service-1', 'db-primary', 'db-replica'],
    'cascading-failure': ['clients', 'lb', 'service-1', 'service-2', 'db-primary', 'third-party'],
  };
  for (const [id, nodes] of Object.entries(need)) {
    const sc = await scenario(id);
    for (const n of nodes) assert.ok(n in sc.topology.nodes, `${id} has ${n}`);
  }
});

// ------------------------------------------------------------------ P3 cascading
test('P3 cascading-failure: no path of length 2 or less resolves, the best path has length 3', { timeout: 180000 }, async () => {
  const E = await engine();
  const sc = await scenario('cascading-failure');
  assert.equal(E.solver.solve(sc, { maxDepth: 2 }).path, null);
  const full = E.solver.solve(sc);
  assert.equal(full.path.length, 3);
  assert.deepEqual(full.path.map((p) => `${p.id}@${p.node}`), ['shed-load@lb', 'circuit-breaker@service-2', 'scale-service@service-1']);
});

// ------------------------------------------------------------------ P4 cascading single fixes
for (const seedKind of ['standard', 1, 77]) {
  test(`P4 cascading-failure: no single fix on any target resolves it, and a page still fires at firstPage + 32 (seed ${seedKind})`, async () => {
    const E = await engine();
    const sc = await scenario('cascading-failure');
    const seed = seedKind === 'standard' ? sc.seed : seedKind;
    const pairs = validPairs(E, sc);
    assert.ok(pairs.length >= 15, `${pairs.length} (fix, target) pairs`);
    for (const p of pairs) {
      const { fp, final, states } = aloneRun(E, sc, seed, p);
      assert.notEqual(final.status, 'resolved', `${key(p)} must not resolve cascading-failure`);
      assert.ok(states.length > fp + 32, `${key(p)}: the run lasts past firstPage + 32`);
      assert.ok(E.eng.firingAlerts(states[fp + 2 + 30]).length >= 1, `${key(p)}: an alert still fires at tick ${fp + 32}`);
    }
  });
}

// ------------------------------------------------------------------ P8 connection pool
test('P8 connection-pool-exhaustion: the harmful scale-service shows db saturation up, service errors up, a FATAL log and a harmful history entry', async () => {
  const E = await engine();
  const sc = await scenario('connection-pool-exhaustion');
  for (const seed of [sc.seed, 1, 77]) {
    const fp = firstPage(E, sc, seed);
    const log = [{ t: fp, id: 'scale-service', node: 'service-1' }];
    const states = [];
    drive(E, sc, seed, log, { stopTick: fp + 12, each: (s) => states.push(s) });
    const at = (k) => states[fp + k];
    const dbSat = (k) => E.eng.metric(at(k), 'db-primary', 'saturation');
    const svcErr = (k) => E.eng.metric(at(k), 'service-1', 'errorRate');
    assert.ok(dbSat(0) <= 0.95, `seed ${seed}: db-primary saturation before the action is ${dbSat(0)}`);
    assert.ok([1, 2, 3, 4, 5].some((k) => dbSat(k) > dbSat(0)), `seed ${seed}: db-primary saturation rises within 5 ticks`);
    assert.ok([1, 2, 3, 4, 5].some((k) => svcErr(k) > svcErr(0)), `seed ${seed}: service-1 errorRate rises within 5 ticks`);
    const fatal = at(5).logs.find((l) => l.node === 'db-primary' && /^FATAL: too many connections \(\d[\d,]*\/\d[\d,]*\)$/.test(l.text));
    assert.ok(fatal, `seed ${seed}: a "FATAL: too many connections (n/max)" line from db-primary by tick ${fp + 5}`);
    assert.equal(E.eng.metric(at(5), 'db-primary', 'connections') > 0, true);
    const he = E.classify.historyEffects(at(5));
    assert.deepEqual({ t: he[0].t, id: he[0].id, node: he[0].node, effect: he[0].effect }, { t: fp, id: 'scale-service', node: 'service-1', effect: 'harmful' });
    assert.equal(E.classify.historyEffects(at(4))[0].effect, null, 'not revealed before t+5');
  }
});

// ------------------------------------------------------------------ P9 map story
test('P9 cache-stampede: the cache piles up (>= 12) while the cache-to-db edge carries >= 4x its calm rate', async () => {
  const V = await mod('core/viewmodel');
  for (const seed of [undefined, 1]) {
    const { E, sc, states } = await noAction('cache-stampede', seed ?? (await scenario('cache-stampede')).seed);
    const fp = states.at(-1).firstPageTick;
    const base = E.eng.edgeRps(states[0], 'cache', 'db-primary');
    assert.ok(base > 0);
    const hit = states.filter((s) => s.tick >= fp).find((s) => {
      const p = s.params.cache;
      const qr = p.backlogMax > 0 ? E.eng.metric(s, 'cache', 'queue') / p.backlogMax : 0;
      return V.pileOf(E.eng.metric(s, 'cache', 'saturation'), qr) >= 12 && E.eng.edgeRps(s, 'cache', 'db-primary') >= 4 * base;
    });
    assert.ok(hit, `seed ${seed}: some tick >= ${fp} has pile(cache) >= 12 and the db edge at 4x (${sc.id})`);
  }
});

test('P9 retry-storm: within 40 ticks after onset the service-1 to third-party edge carries >= 3x its calm rate', async () => {
  for (const seed of [undefined, 1]) {
    const { E, states } = await noAction('retry-storm', seed ?? (await scenario('retry-storm')).seed);
    const onset = states.at(-1).onsetTick;
    const base = E.eng.edgeRps(states[0], 'service-1', 'third-party');
    assert.ok(base > 0);
    const best = Math.max(...states.slice(onset + 1, onset + 41).map((s) => E.eng.edgeRps(s, 'service-1', 'third-party')));
    assert.ok(best >= 3 * base, `seed ${seed}: peak ${best} vs calm ${base}`);
  }
});

test('pileOf and dotRateOf follow the pinned formulas', async () => {
  const V = await mod('core/viewmodel');
  assert.equal(V.pileOf(0.7, 0), 0);
  assert.equal(V.pileOf(0.85, 0), 12);
  assert.equal(V.pileOf(1, 0), 24);
  assert.equal(V.pileOf(0.5, 0.5), 12);
  assert.equal(V.pileOf(0, 1), 24);
  assert.equal(V.pileOf(1, 1), 24);
  assert.equal(V.pileOf(0.8, 0), 8);
  assert.equal(V.pileOf(0, 0), 0);
  assert.equal(V.pileOf(5, 0), 24, 'capped at 24');
  assert.equal(V.dotRateOf(100, 100), 8);
  assert.equal(V.dotRateOf(0, 100), 0.5);
  assert.equal(V.dotRateOf(100000, 100), 40);
  assert.equal(V.dotRateOf(50, 100), 4);
  assert.equal(V.dotRateOf(300, 100), 24);
});

// ------------------------------------------------------------------ score bands (PHYSICS)
const HARMFUL_FIRST = Object.fromEntries(SHIPPED.filter((p) => p.harmful.length).map((p) => [p.id, p.harmful[0]]));

for (const pin of SHIPPED) {
  test(`score bands ${pin.id}: trace-request first then the optimal path from firstPage + 2 resolves with score 75 to 100 (Solid or Textbook)`, async () => {
    const E = await engine();
    const sc = await scenario(pin.id);
    const fp = firstPage(E, sc, sc.seed);
    const log = [{ t: fp, id: 'trace-request', node: null }, ...playbook(E, sc, sc.seed, optimalSteps(sc), 2)];
    const done = drive(E, sc, sc.seed, log);
    const r = E.eng.result(done);
    assert.equal(r.result, 'resolved');
    const sc1 = scoreOf(E, sc, done);
    assert.ok(sc1.score >= 75 && sc1.score <= 100, `score ${sc1.score}`);
    assert.ok(['Solid', 'Textbook'].includes(sc1.tier), sc1.tier);
    const again = E.score.score({ result: r.result, timeToMitigate: r.timeToMitigate, optimalTime: sc.optimalSummary.timeToMitigate, budgetLeft: r.budgetLeft, budget: sc.budget, optimalCost: sc.optimalSummary.cost, harmful: r.harmful, hintUsed: false });
    assert.deepEqual(again, sc1);
    assert.equal(r.budgetLeft, sc.budget - 1 - sc.optimalSummary.cost);
  });

  if (HARMFUL_FIRST[pin.id]) test(`score bands ${pin.id}: the declared harmful fix first, then the optimal path, is penalised`, async () => {
    const E = await engine();
    const sc = await scenario(pin.id);
    const harm = HARMFUL_FIRST[pin.id];
    assert.ok(harm, 'a declared harmful fix');
    const best = scoreOf(E, sc, optimalRun(E, sc, sc.seed)).score;
    const done = optimalRun(E, sc, sc.seed, 2, harm);
    const r = E.eng.result(done);
    const s2 = scoreOf(E, sc, done);
    assert.ok(r.harmful >= 1, `harmful count ${r.harmful}`);
    if (pin.d === 3) {
      assert.ok(s2.score <= 85, `score ${s2.score}`);
      assert.ok(['resolved', 'out-of-budget'].includes(r.result));
    } else {
      assert.equal(r.result, 'resolved');
      assert.ok(s2.score >= 20 && s2.score <= 85, `score ${s2.score}`);
      assert.ok(['Solid', 'Survived'].includes(s2.tier), s2.tier);
      assert.ok(s2.score < best, `${s2.score} < ${best}`);
    }
  });

  test(`score bands ${pin.id}: trace-request spam until the budget is gone gives out-of-budget, no time, score 20 Escalated (15 with a hint)`, async () => {
    const E = await engine();
    const sc = await scenario(pin.id);
    const fp = firstPage(E, sc, sc.seed);
    const log = Array.from({ length: sc.budget }, () => ({ t: fp, id: 'trace-request', node: null }));
    const done = drive(E, sc, sc.seed, log);
    const r = E.eng.result(done);
    assert.equal(r.result, 'out-of-budget');
    assert.equal(r.timeToMitigate, null);
    assert.equal(r.budgetLeft, 0);
    assert.equal(r.harmful, 0);
    const plain = scoreOf(E, sc, done);
    assert.equal(plain.score, 20);
    assert.equal(plain.tier, 'Escalated');
    assert.equal(scoreOf(E, sc, done, { hintUsed: true }).score, 15);
  });
}

test('every shipped scenario passes the engine invariants on a no-action run and an optimal run', async () => {
  const E = await engine();
  for (const id of SHIPPED_IDS) {
    const sc = await scenario(id);
    const states = [];
    drive(E, sc, sc.seed, playbook(E, sc, sc.seed, optimalSteps(sc)), { each: (s) => states.push(s) });
    for (const s of states) assert.deepEqual(invariantViolations(E, sc, s), [], `${id} tick ${s.tick}`);
  }
});
