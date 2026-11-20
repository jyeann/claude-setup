// Hash, PRNG goldens and the determinism recipes D1-D10 (spec.md "Determinism contract and exact test recipes").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  SHIPPED_IDS, JS_DIR, mod, engine, scenario, rawScenario, clone, validateRaw, drive, noAction, firstPage, optimalSteps,
  invariantViolations, walkFiles, stripComments,
} from './helpers.js';

// ------------------------------------------------------------------ hash.js
const refFnv = (str) => {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(str, 'utf8')) h = Math.imul(h ^ b, 16777619) >>> 0;
  return h;
};

test('fnv1a32 matches the spec vectors for "", "a" and "foobar"', async () => {
  const { fnv1a32, hex8 } = await mod('engine/hash');
  assert.equal(hex8(fnv1a32('')), '811c9dc5');
  assert.equal(hex8(fnv1a32('a')), 'e40c292c');
  assert.equal(hex8(fnv1a32('foobar')), 'bf9cf968');
  assert.equal(fnv1a32(''), 0x811c9dc5);
});

test('fnv1a32 hashes UTF-8 bytes, not UTF-16 code units', async () => {
  const { fnv1a32 } = await mod('engine/hash');
  for (const s of ['é', '€', '\u{1F600}', 'café ☃', 'daily:2026-11-19', 'a'.repeat(1000)]) {
    assert.equal(fnv1a32(s), refFnv(s), JSON.stringify(s));
  }
  assert.ok(Number.isInteger(fnv1a32('x')) && fnv1a32('x') >= 0 && fnv1a32('x') <= 0xffffffff);
});

test('hex8 gives 8 lowercase hex digits, zero padded', async () => {
  const { hex8 } = await mod('engine/hash');
  assert.equal(hex8(0), '00000000');
  assert.equal(hex8(255), '000000ff');
  assert.equal(hex8(0xffffffff), 'ffffffff');
  assert.equal(hex8(0xABCDEF), '00abcdef');
});

test('canonicalJson sorts keys by code unit, has no whitespace and ignores input key order', async () => {
  const { canonicalJson } = await mod('engine/hash');
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
  assert.equal(canonicalJson({ a: 1, b: 2, c: 3 }), canonicalJson({ c: 3, a: 1, b: 2 }));
  assert.equal(canonicalJson({ a: 'a', B: 'B', _: '_' }), '{"B":"B","_":"_","a":"a"}');
  assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]');
  assert.equal(canonicalJson({ n: 1.5, m: -0, t: true, f: false, z: null, s: 'a"b' }), '{"f":false,"m":0,"n":1.5,"s":"a\\"b","t":true,"z":null}');
  assert.equal(canonicalJson([]), '[]');
  assert.equal(canonicalJson({}), '{}');
});

// ------------------------------------------------------------------ prng.js
test('mulberry32 from state 1 produces the 8 golden values exactly', async () => {
  const { next } = await mod('engine/prng');
  const want = [0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849, 0.281103502959013, 0.6128388606011868, 0.7207431411370635];
  let s = 1;
  const got = [];
  for (let i = 0; i < 8; i++) { const [ns, u] = next(s); s = ns; got.push(u); }
  assert.deepEqual(got, want);
});

test('prng initial("cache-stampede", 1) is 991975984 and its first 8 draws match the goldens', async () => {
  const { next, initial } = await mod('engine/prng');
  assert.equal(initial('cache-stampede', 1), 991975984);
  const want = [0.13986613787710667, 0.10009580221958458, 0.5148854400031269, 0.6781341361347586, 0.7575293970294297, 0.9323439956642687, 0.75363909592852, 0.8480869282502681];
  let s = initial('cache-stampede', 1);
  for (let i = 0; i < 8; i++) { const [ns, u] = next(s); s = ns; assert.equal(u, want[i], `draw ${i}`); }
});

test('prng next is pure, returns a uint32 state and u in [0,1)', async () => {
  const { next } = await mod('engine/prng');
  const a = next(12345); const b = next(12345);
  assert.deepEqual(a, b);
  assert.ok(Number.isInteger(a[0]) && a[0] >= 0 && a[0] <= 0xffffffff);
  let s = 7; let sum = 0;
  for (let i = 0; i < 5000; i++) { const [ns, u] = next(s); s = ns; assert.ok(u >= 0 && u < 1); sum += u; }
  assert.ok(sum / 5000 > 0.45 && sum / 5000 < 0.55);
});

test('prng initial hashes "<id>:<seed>" with the seed taken >>> 0', async () => {
  const { initial } = await mod('engine/prng');
  const { fnv1a32 } = await mod('engine/hash');
  assert.equal(initial('retry-storm', 77), fnv1a32('retry-storm:77') || 0x9E3779B9);
  assert.equal(initial('x', -1), initial('x', 4294967295));
  assert.equal(initial('x', 4294967296), initial('x', 0));
  assert.notEqual(initial('a', 1), initial('b', 1));
  assert.notEqual(initial('a', 1), initial('a', 2));
});

// ------------------------------------------------------------------ D1 replay equality
const logFor = (E, sc, seed) => {
  const fp = firstPage(E, sc, seed);
  return [{ t: fp, id: 'trace-request', node: null }, ...E.solver.schedule(fp + 2, sc.optimalPath.map((p) => ({ id: p.id, node: p.node })))];
};

for (const id of SHIPPED_IDS) {
  test(`D1 replay equality: ${id} replays to identical final state and snapshot hashes for 5 seeds`, async () => {
    const E = await engine();
    const sc = await scenario(id);
    for (const seed of [sc.seed, 0, 1, 77, 4294967295]) {
      const log = logFor(E, sc, seed);
      const a = E.replay.replay(sc, seed, log);
      const b = E.replay.replay(sc, seed, log);
      assert.equal(E.hash.canonicalJson(a.final), E.hash.canonicalJson(b.final), `seed ${seed}`);
      assert.equal(a.snapshots.length, b.snapshots.length);
      for (let k = 0; k < a.snapshots.length; k++) assert.equal(a.snapshots[k].hash, b.snapshots[k].hash, `seed ${seed} tick ${k}`);
      assert.equal(a.snapshots.length, a.final.tick + 1, 'snapshots[k] is the state after k ticks');
      assert.equal(a.dropped, 0);
    }
  });
}

test('replay snapshots have the pinned shape and replay counts unreachable or illegal entries as dropped', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  const { final, snapshots, dropped } = E.replay.replay(sc, 1, [
    { t: 5, id: 'trace-request', node: null },
    { t: 6, id: 'scale-service', node: null }, // several candidate services: canApply rejects
    { t: 99999, id: 'trace-request', node: null }, // never reached
  ]);
  assert.equal(dropped, 2);
  assert.equal(final.actionLog.length, 1);
  assert.deepEqual(final.actionLog[0], { t: 5, id: 'trace-request', node: null });
  const s0 = snapshots[0];
  assert.equal(s0.tick, 0);
  for (const key of ['tick', 'hash', 'm', 'statuses', 'firing', 'budgetLeft', 'status']) assert.ok(key in s0, key);
  assert.ok(Array.isArray(s0.firing));
  assert.equal(s0.statuses['cache'], 'ok');
  assert.equal(s0.budgetLeft, sc.budget);
  assert.equal(snapshots.at(-1).tick, final.tick);
});

test('a full 610-tick replay finishes in under 250 ms', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  E.replay.replay(sc, 1, []); // warm up
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t0 = process.hrtime.bigint();
    const r = E.replay.replay(sc, 1, []);
    best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6);
    assert.ok(r.final.tick >= 600);
  }
  assert.ok(best < 250, `best of 3 took ${best.toFixed(1)} ms`);
});

// ------------------------------------------------------------------ D2 chunking
for (const id of SHIPPED_IDS) {
  test(`D2 chunking: ${id} hashes at every tick equal replay for chunks of 1, 5 and 64 ticks`, async () => {
    const E = await engine();
    const sc = await scenario(id);
    const seed = sc.seed;
    const log = logFor(E, sc, seed);
    const rep = E.replay.replay(sc, seed, log);
    for (const chunk of [1, 5, 64]) {
      let s = E.eng.createRun(sc, seed);
      const hashes = [s.hash];
      let i = 0;
      while (s.status === 'running') {
        for (let c = 0; c < chunk && s.status === 'running'; c++) {
          const acts = [];
          while (i < log.length && log[i].t === s.tick) { acts.push({ id: log[i].id, node: log[i].node }); i++; }
          s = E.eng.step(s, acts);
          hashes.push(s.hash);
        }
      }
      assert.equal(hashes.length, rep.snapshots.length, `chunk ${chunk}`);
      for (let k = 0; k < hashes.length; k++) {
        assert.ok(rep.snapshots[k].hash === hashes[k] || rep.snapshots[k].hash === E.fingerprint.stateHash({ hash: hashes[k] }), `chunk ${chunk} tick ${k}`);
      }
    }
  });
}

// ------------------------------------------------------------------ D3 speed independence
test('dueTicks is floor(elapsedMs*speed/1000)-ticksRun, never below 0 and capped at min(speed, 64) per call', async () => {
  const { dueTicks } = await mod('core/scheduler-math');
  assert.equal(dueTicks({ elapsedMs: 999, speed: 1, ticksRun: 0 }), 0);
  assert.equal(dueTicks({ elapsedMs: 1000, speed: 1, ticksRun: 0 }), 1);
  assert.equal(dueTicks({ elapsedMs: 999, speed: 2, ticksRun: 0 }), 1, 'floor(1.998)');
  assert.equal(dueTicks({ elapsedMs: 1999, speed: 2, ticksRun: 0 }), 2, 'floor(3.998) = 3 is capped at the speed');
  assert.equal(dueTicks({ elapsedMs: 2500, speed: 1, ticksRun: 0 }), 1, 'floor(2.5) = 2 is capped at the speed');
  assert.equal(dueTicks({ elapsedMs: 1000, speed: 4, ticksRun: 0 }), 4);
  assert.equal(dueTicks({ elapsedMs: 1000, speed: 4, ticksRun: 3 }), 1);
  assert.equal(dueTicks({ elapsedMs: 100, speed: 4, ticksRun: 9 }), 0, 'never below 0');
  assert.equal(dueTicks({ elapsedMs: 60000, speed: 4, ticksRun: 0 }), 4, 'capped at speed per call');
  assert.equal(dueTicks({ elapsedMs: 600000, speed: 64, ticksRun: 0 }), 64);
  assert.equal(dueTicks({ elapsedMs: 600000, speed: 128, ticksRun: 0 }), 64, 'capped at 64 even above speed 64');
});

for (const id of SHIPPED_IDS) {
  test(`D3 speed independence: ${id} reaches identical hash, series, logs and budget at speeds 1 to 64`, async () => {
    const E = await engine();
    const { dueTicks } = await mod('core/scheduler-math');
    const sc = await scenario(id);
    const first = sc.optimalPath[0];
    const results = [];
    for (const speed of [1, 2, 4, 8, 16, 32, 64]) {
      let s = E.eng.createRun(sc, sc.seed);
      let ticksRun = 0;
      for (let ms = 0; ms <= 400000 && s.tick < 60 && s.status === 'running'; ms += 16) {
        let due = dueTicks({ elapsedMs: ms, speed, ticksRun });
        while (due-- > 0 && s.tick < 60 && s.status === 'running') {
          s = E.eng.step(s, s.tick === 12 ? [{ id: first.id, node: first.node }] : []);
          ticksRun++;
        }
      }
      results.push({ speed, s });
    }
    const base = results[0].s;
    assert.ok(base.tick === 60 || base.status !== 'running', 'ran to tick 60 or to the end');
    for (const { speed, s } of results) {
      assert.equal(s.tick, base.tick, `speed ${speed}`);
      assert.equal(s.hash, base.hash, `speed ${speed}`);
      assert.deepEqual(s.series, base.series, `speed ${speed}`);
      assert.deepEqual(s.logs, base.logs, `speed ${speed}`);
      assert.equal(s.budgetLeft, base.budgetLeft, `speed ${speed}`);
    }
    assert.ok(base.actionLog.some((a) => a.t === 12 && a.id === first.id));
  });
}

// ------------------------------------------------------------------ D4 seed sensitivity
for (const id of SHIPPED_IDS) {
  test(`D4 seed sensitivity: ${id} seeds 1 and 2 differ at tick 30, the same seed twice matches`, async () => {
    const E = await engine();
    const sc = await scenario(id);
    const at30 = (seed) => drive(E, sc, seed, [], { stopTick: 30 });
    const a = at30(1); const b = at30(2); const c = at30(1);
    assert.equal(a.tick, 30);
    assert.notEqual(a.hash, b.hash);
    assert.equal(a.hash, c.hash);
    assert.equal(E.hash.canonicalJson(a), E.hash.canonicalJson(c));
  });
}

// ------------------------------------------------------------------ D5 serialisation
for (const id of SHIPPED_IDS) {
  test(`D5 serialisation: ${id} state survives JSON round trip at tick 20 and steps to the same hashes`, async () => {
    const E = await engine();
    const sc = await scenario(id);
    const s20 = drive(E, sc, sc.seed, [], { stopTick: 20 });
    let a = s20;
    let b = JSON.parse(JSON.stringify(s20));
    const first = sc.optimalPath[0];
    for (let i = 0; i < 20; i++) {
      const acts = i === 5 ? [{ id: first.id, node: first.node }] : [];
      a = E.eng.step(a, acts);
      b = E.eng.step(b, acts);
      assert.equal(b.hash, a.hash, `step ${i}`);
    }
    assert.equal(E.hash.canonicalJson(a), E.hash.canonicalJson(b));
  });
}

// ------------------------------------------------------------------ D6 stamping, effects, ramps
async function derived(mutate, fileName = 'cache-stampede.json') {
  const raw = clone(rawScenario('cache-stampede'));
  mutate(raw);
  const r = await validateRaw(raw, fileName);
  assert.ok(r.ok, `derived scenario must validate: ${r.ok ? '' : r.errors.map((e) => `${e.field}: ${e.message}`).join(' | ')}`);
  return r.scenario;
}

test('D6 stamping: step stamps t = state.tick whatever t the caller wrote, and resolves the single target', async () => {
  const E = await engine();
  const sc = await derived((raw) => { raw.actions['add-ttl-jitter'] = { cost: 1, effects: { cache: [{ path: 'node:cache.capFactor', op: 'set', value: 2 }] } }; });
  let s = E.eng.createRun(sc, 1);
  for (let i = 0; i < 3; i++) s = E.eng.step(s, []);
  assert.equal(s.tick, 3);
  const before = E.hash.canonicalJson(s);
  const next = E.eng.step(s, [{ id: 'add-ttl-jitter', node: 'cache', t: 999 }]);
  assert.equal(E.hash.canonicalJson(s), before, 'input state untouched');
  assert.deepEqual(next.actionLog, [{ t: 3, id: 'add-ttl-jitter', node: 'cache' }]);
  assert.equal(next.tick, 4);
  assert.equal(next.params.cache.capFactor, 2);
  assert.notEqual(s.params.cache.capFactor, 2, 'metrics and params of tick T are unchanged');
  assert.equal(next.budgetLeft, s.budgetLeft - 1);
});

test('D6 an unramped effect shows in the very next tick and a mul effect moves the metric', async () => {
  const E = await engine();
  const sc = await derived((raw) => { raw.actions['add-ttl-jitter'] = { cost: 1, effects: { cache: [{ path: 'node:cache.capFactor', op: 'mul', value: 0.5 }] } }; });
  const s0 = E.eng.createRun(sc, 1);
  const start = s0.params.cache.capFactor;
  const s1 = E.eng.step(s0, [{ id: 'add-ttl-jitter', node: 'cache' }]);
  assert.equal(s1.params.cache.capFactor, start * 0.5);
  assert.ok(E.eng.metric(s1, 'cache', 'saturation') > E.eng.metric(s0, 'cache', 'saturation'), 'half the capacity means higher saturation at T+1');
});

test('D6 a ramp of r ticks reaches its final value at T+r exactly and is linear in between', async () => {
  const E = await engine();
  const r = 4;
  const sc = await derived((raw) => { raw.actions['add-ttl-jitter'] = { cost: 1, effects: { cache: [{ path: 'node:cache.capFactor', op: 'set', value: 3, ramp: r }] } }; });
  let s = E.eng.createRun(sc, 1);
  s = E.eng.step(s, []);
  const T = s.tick;
  const start = s.params.cache.capFactor;
  s = E.eng.step(s, [{ id: 'add-ttl-jitter', node: 'cache' }]);
  for (let j = 1; j <= r + 2; j++) {
    const want = j >= r ? 3 : start + (3 - start) * j / r;
    assert.ok(Math.abs(s.params.cache.capFactor - want) < 1e-9, `tick T+${j}: ${s.params.cache.capFactor} vs ${want}`);
    assert.equal(s.tick, T + j);
    s = E.eng.step(s, []);
  }
});

test('D6 add and mul are computed from the current value and clamped to the param range', async () => {
  const E = await engine();
  const sc = await derived((raw) => { raw.actions['add-ttl-jitter'] = { cost: 1, effects: { cache: [{ path: 'node:cache.capFactor', op: 'add', value: 50 }] } }; });
  const s0 = E.eng.createRun(sc, 1);
  const s1 = E.eng.step(s0, [{ id: 'add-ttl-jitter', node: 'cache' }]);
  assert.equal(s1.params.cache.capFactor, E.catalogue.PARAMS.cache.capFactor.max, 'clamped to the max of capFactor');
});

test('D6 a later op on the same path cancels a pending ramp', async () => {
  const E = await engine();
  const sc = await derived((raw) => {
    raw.actions['circuit-breaker'] = { cost: 2, effects: { 'service-1': [{ path: 'node:service-1.capFactor', op: 'set', value: 0.2, ramp: 10 }] } };
    raw.actions['scale-service'] = { cost: 2, effects: { 'service-1': [{ path: 'node:service-1.capFactor', op: 'set', value: 1.5 }] } };
  });
  let s = E.eng.createRun(sc, 1);
  s = E.eng.step(s, [{ id: 'circuit-breaker', node: 'service-1' }]);
  s = E.eng.step(s, []);
  s = E.eng.step(s, [{ id: 'scale-service', node: 'service-1' }]);
  for (let i = 0; i < 12; i++) {
    assert.equal(s.params['service-1'].capFactor, 1.5, `tick ${s.tick}`);
    s = E.eng.step(s, []);
  }
});

test('D6 an effect with a false if-condition is skipped and a true one applies', async () => {
  const E = await engine();
  const mk = (cond) => derived((raw) => { raw.actions['add-ttl-jitter'] = { cost: 1, effects: { cache: [{ path: 'node:cache.capFactor', op: 'set', value: 4, if: cond }] } }; });
  const skip = await mk({ tickGte: 500 });
  const take = await mk({ tickGte: 0 });
  const a = E.eng.step(E.eng.createRun(skip, 1), [{ id: 'add-ttl-jitter', node: 'cache' }]);
  const b = E.eng.step(E.eng.createRun(take, 1), [{ id: 'add-ttl-jitter', node: 'cache' }]);
  assert.notEqual(a.params.cache.capFactor, 4);
  assert.equal(b.params.cache.capFactor, 4);
  assert.equal(a.actionLog.length, 1, 'the action is still logged and paid for');
});

// ------------------------------------------------------------------ D7 no hidden inputs
test('D7 engine modules contain no banned API (Math.random, Date, performance, timers, crypto, Intl, transcendental Math, **)', () => {
  const dir = path.join(JS_DIR, 'engine');
  const files = walkFiles(dir, (p) => p.endsWith('.js'));
  const names = files.map((f) => path.basename(f, '.js')).sort();
  for (const n of ['prng', 'hash', 'catalogue', 'guides', 'conditions', 'model', 'engine', 'classify', 'replay', 'score', 'solver', 'fingerprint', 'validate', 'template']) {
    assert.ok(names.includes(n), `engine/${n}.js exists`);
  }
  const banned = [
    /Math\.random/, /\bDate\b/, /\bperformance\b/, /\bsetTimeout\b/, /\bsetInterval\b/, /\bcrypto\b/, /\bglobalThis\b/, /\bwindow\b/,
    /\bdocument\b/, /\bfetch\b/, /Math\.(?:exp|log|pow|sin|cos|tan|atan2|cbrt|hypot)/, /\*\*/, /\bIntl\b/, /toLocaleString/,
  ];
  const hits = [];
  for (const f of files) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    for (const re of banned) if (re.test(src)) hits.push(`${path.relative(JS_DIR, f)}: ${re}`);
  }
  assert.deepEqual(hits, []);
});

test('D7 nothing under public/js uses innerHTML, outerHTML, insertAdjacentHTML, document.write, eval or new Function', () => {
  const files = walkFiles(JS_DIR, (p) => p.endsWith('.js'));
  assert.ok(files.length >= 30, `found ${files.length} js files`);
  const banned = [/\binnerHTML\b/, /\bouterHTML\b/, /\binsertAdjacentHTML\b/, /document\.write/, /\beval\s*\(/, /new\s+Function\b/];
  const hits = [];
  for (const f of files) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    for (const re of banned) if (re.test(src)) hits.push(`${path.relative(JS_DIR, f)}: ${re}`);
  }
  assert.deepEqual(hits, []);
});

test('D7 engine/ and core/ do not touch DOM, storage or Node built-ins at import time', () => {
  const files = [...walkFiles(path.join(JS_DIR, 'engine'), (p) => p.endsWith('.js')), ...walkFiles(path.join(JS_DIR, 'core'), (p) => p.endsWith('.js'))];
  assert.ok(files.length >= 29, `found ${files.length} engine and core files`);
  const hits = [];
  for (const f of files) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    if (/\bfrom\s+['"]node:/.test(src) || /\brequire\s*\(/.test(src)) hits.push(`${path.relative(JS_DIR, f)}: node import`);
    if (/\blocalStorage\b|\bnavigator\b|\bprocess\./.test(src)) hits.push(`${path.relative(JS_DIR, f)}: environment access`);
  }
  assert.deepEqual(hits, []);
});

// ------------------------------------------------------------------ D8 invariants
for (const id of SHIPPED_IDS) {
  test(`D8 invariants: ${id} holds for 25 seeds with seeded random legal action logs`, async () => {
    const E = await engine();
    const sc = await scenario(id);
    const fixIds = E.catalogue.ACTION_IDS.filter((a) => a !== 'inspect');
    for (let seed = 0; seed < 25; seed++) {
      let rng = E.prng.initial(`d8-${id}`, seed);
      const draw = () => { const [ns, u] = E.prng.next(rng); rng = ns; return u; };
      const nodes = Object.keys(sc.topology.nodes);
      const plan = [];
      const n = 1 + Math.floor(draw() * 12);
      for (let i = 0; i < n; i++) {
        const t = Math.floor(draw() * 61);
        const aid = fixIds[Math.floor(draw() * fixIds.length)];
        const pick = Math.floor(draw() * (nodes.length + 1));
        plan.push({ t, id: aid, node: pick === nodes.length ? null : nodes[pick] });
      }
      plan.sort((a, b) => a.t - b.t);
      let s = E.eng.createRun(sc, seed);
      let p = 0;
      let guard = 0;
      while (s.status === 'running') {
        const acts = [];
        while (p < plan.length && plan[p].t < s.tick) p++;
        while (p < plan.length && plan[p].t === s.tick) {
          if (E.eng.canApply(s, plan[p].id, plan[p].node).ok) acts.push({ id: plan[p].id, node: plan[p].node });
          p++;
        }
        s = E.eng.step(s, acts);
        const bad = invariantViolations(E, sc, s);
        assert.deepEqual(bad, [], `seed ${seed} tick ${s.tick}`);
        assert.ok(++guard < 700, 'run is bounded');
      }
      assert.ok(['resolved', 'out-of-budget'].includes(s.status));
    }
  });
}

// ------------------------------------------------------------------ D9 bounded runs
for (const id of SHIPPED_IDS) {
  test(`D9 bounded runs: ${id} with no actions ends out-of-budget within maxTicks + 10 and never resolves`, async () => {
    const { E, sc, final } = await noAction(id, 1);
    assert.equal(final.status, 'out-of-budget');
    assert.ok(final.tick <= (sc.maxTicks) + 10, `ended at ${final.tick}`);
    assert.ok(final.series.p99.length <= 611);
    assert.equal(final.series.p99.length, final.tick + 1);
    const r = E.eng.result(final);
    assert.equal(r.result, 'out-of-budget');
    assert.equal(r.timeToMitigate, null);
    assert.equal(final.resolvedTick, null);
    assert.equal(r.harmful, 0);
  });
}

test('D9 grace window: budget 0 starts graceLeft 10, still running after 9 more steps, out-of-budget after the 10th', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  let s = E.eng.createRun(sc, 1);
  s = E.eng.step(s, Array.from({ length: sc.budget }, () => ({ id: 'trace-request', node: null })));
  assert.equal(s.budgetLeft, 0);
  assert.equal(s.graceLeft, 10);
  assert.equal(s.status, 'running');
  for (let i = 0; i < 9; i++) { s = E.eng.step(s, []); assert.equal(s.status, 'running', `after ${i + 1} more steps`); }
  s = E.eng.step(s, []);
  assert.equal(s.status, 'out-of-budget');
  const frozen = E.eng.step(s, [{ id: 'trace-request', node: null }]);
  assert.equal(E.hash.canonicalJson(frozen), E.hash.canonicalJson(s), 'a finished run does not change');
});

test('D9 at tick === maxTicks the budget is forced to 0 and the run ends 10 ticks later', async () => {
  const E = await engine();
  const sc = await derived((raw) => { raw.maxTicks = 60; raw.escalateEvery = 0; });
  let s = E.eng.createRun(sc, 1);
  while (s.tick < 59) s = E.eng.step(s, []);
  assert.equal(s.budgetLeft, sc.budget, 'escalateEvery 0 means no drain before maxTicks');
  s = E.eng.step(s, []);
  assert.equal(s.tick, 60);
  assert.equal(s.budgetLeft, 0);
  assert.equal(s.graceLeft, 10);
  assert.equal(s.status, 'running');
  for (let i = 0; i < 9; i++) s = E.eng.step(s, []);
  assert.equal(s.status, 'running');
  s = E.eng.step(s, []);
  assert.equal(s.status, 'out-of-budget');
  assert.equal(s.tick, 70);
});

test('escalation spends one lamp every escalateEvery ticks after the first page and logs the warn line', async () => {
  const { E, sc, states } = await noAction('cache-stampede', 1);
  const fp = states.at(-1).firstPageTick;
  assert.equal(sc.escalateEvery, 90);
  const lines = states.at(-1).logs.filter((l) => l.text === 'Escalation: still paging after 90 s.');
  assert.ok(lines.length >= 2);
  assert.deepEqual({ kind: lines[0].kind, node: lines[0].node, level: lines[0].level }, { kind: 'log', node: null, level: 'warn' });
  assert.equal(lines[0].t, fp + 90);
  assert.equal(lines[1].t, fp + 180);
  assert.equal(states[fp + 89].budgetLeft, sc.budget);
  assert.equal(states[fp + 90].budgetLeft, sc.budget - 1);
  assert.equal(states[fp + 180].budgetLeft, sc.budget - 2);
  assert.ok(E);
});

// ------------------------------------------------------------------ D10 purity
for (const id of SHIPPED_IDS) {
  test(`D10 purity: ${id} step never mutates its input and createRun is repeatable`, async () => {
    const E = await engine();
    const sc = await scenario(id);
    assert.equal(E.hash.canonicalJson(E.eng.createRun(sc, 5)), E.hash.canonicalJson(E.eng.createRun(sc, 5)));
    let s = E.eng.createRun(sc, 5);
    const first = sc.optimalPath[0];
    for (let i = 0; i < 12; i++) {
      const before = E.hash.canonicalJson(s);
      const acts = i === 7 ? [{ id: first.id, node: first.node }, { id: 'trace-request', node: null }, { id: 'inspect', node: 'lb' }] : [];
      const out = E.eng.step(s, acts);
      assert.equal(E.hash.canonicalJson(s), before, `tick ${i}`);
      assert.notEqual(out, s);
      s = out;
    }
  });
}

test('D10 purity: a deep-frozen input state steps without throwing', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
  let s = E.eng.createRun(sc, 1);
  for (let i = 0; i < 6; i++) s = E.eng.step(s, []);
  deepFreeze(s);
  const out = E.eng.step(s, [{ id: 'add-ttl-jitter', node: 'cache' }]);
  assert.equal(out.tick, s.tick + 1);
});
