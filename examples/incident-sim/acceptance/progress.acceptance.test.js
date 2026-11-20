// core/safe-json.js and core/progress.js: strict import, hostile payloads, export round trip, bests (spec.md "Progress, daily, share").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mod, engine } from './helpers.js';

const safe = () => mod('core/safe-json');
const prog = () => mod('core/progress');
const run = (o = {}) => ({
  scenario: 'cache-stampede', seed: 1, scenarioHash: '0123abcd', result: 'resolved', timeToMitigate: 41, budgetLeft: 4, harmful: 0, hintUsed: false, score: 87,
  actions: [{ t: 6, id: 'trace-request', node: null }, { t: 8, id: 'add-ttl-jitter', node: 'cache' }], ...o,
});
const doc = (runs, extra = {}) => JSON.stringify({ version: 1, runs, ...extra });
const protoClean = () => {
  assert.equal(Object.keys(Object.prototype).length, 0, 'Object.prototype has no own enumerable keys');
  assert.equal(({}).polluted, undefined);
  assert.equal(({}).isAdmin, undefined);
};
const REASON_KEY = (k) => `the file contains the key "${k}", which is not allowed.`;
const NESTED = 'the file is nested too deeply.';
const NOT_JSON = 'the file is not valid JSON. Export a fresh file from this page and try again.';

// ------------------------------------------------------------------ parseSafe
test('parseSafe returns ok and a prototype-less copy that serialises like the input', async () => {
  const { parseSafe } = await safe();
  const text = '{"a":1,"b":[1,2,{"c":"x"}],"d":{"e":null,"f":true}}';
  const r = parseSafe(text);
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(r.value), text);
  assert.equal(Object.getPrototypeOf(r.value), null);
  assert.equal(Object.getPrototypeOf(r.value.d), null);
  assert.equal(Object.getPrototypeOf(r.value.b[2]), null);
  assert.ok(Array.isArray(r.value.b));
  assert.equal(parseSafe('[1,2,3]').ok, true);
  assert.equal(parseSafe('"just a string"').value, 'just a string');
  protoClean();
});

test('parseSafe size limit: 262,144 bytes accepted, 262,145 rejected with "the file is 257 KB and the limit is 256 KB."', async () => {
  const { parseSafe } = await safe();
  const ok = `"${'a'.repeat(262142)}"`;
  assert.equal(Buffer.byteLength(ok), 262144);
  assert.equal(parseSafe(ok).ok, true);
  const big = `"${'a'.repeat(262143)}"`;
  assert.deepEqual(parseSafe(big), { ok: false, reason: 'the file is 257 KB and the limit is 256 KB.' });
});

test('parseSafe counts UTF-8 bytes, not characters, and rounds KB up', async () => {
  const { parseSafe } = await safe();
  const euro = `"${'€'.repeat(100000)}"`;
  assert.deepEqual(parseSafe(euro), { ok: false, reason: 'the file is 293 KB and the limit is 256 KB.' });
  assert.equal(Buffer.byteLength(euro), 300002);
  const fits = `"${'€'.repeat(80000)}"`;
  assert.equal(Buffer.byteLength(fits), 240002);
  assert.equal(parseSafe(fits).ok, true);
});

test('parseSafe maxBytes option moves the byte limit', async () => {
  const { parseSafe } = await safe();
  assert.equal(parseSafe('"abc"', { maxBytes: 5 }).ok, true);
  assert.equal(parseSafe('"abcd"', { maxBytes: 5 }).ok, false);
  assert.match(parseSafe('"abcd"', { maxBytes: 5 }).reason, /^the file is \d+ KB and the limit is /);
});

test('parseSafe rejects nesting deeper than 8 before parsing; depth 8 is fine', async () => {
  const { parseSafe } = await safe();
  assert.equal(parseSafe('[[[[[[[[1]]]]]]]]').ok, true);
  assert.deepEqual(parseSafe('[[[[[[[[[1]]]]]]]]]'), { ok: false, reason: NESTED });
  assert.deepEqual(parseSafe('['.repeat(100)), { ok: false, reason: NESTED }, 'unterminated: the pre-scan rejects before JSON.parse');
  assert.deepEqual(parseSafe('{"a":'.repeat(30) + '1' + '}'.repeat(30)), { ok: false, reason: NESTED });
  assert.deepEqual(parseSafe('[[[[[[[[[['), { ok: false, reason: NESTED });
});

test('parseSafe pre-scan skips string contents, including escaped quotes', async () => {
  const { parseSafe } = await safe();
  assert.equal(parseSafe(`["${'['.repeat(50)}"]`).ok, true);
  assert.equal(parseSafe(`["\\"${'['.repeat(50)}"]`).ok, true);
  assert.equal(parseSafe(`{"k":"${'{,'.repeat(30000)}"}`).ok, true, 'structural characters inside strings are not tokens');
  assert.equal(parseSafe(`["a\\\\", [1]]`).ok, true);
});

test('parseSafe rejects more than 20,000 structural tokens (a 25,000-key object) before parsing', async () => {
  const { parseSafe } = await safe();
  const parts = [];
  for (let i = 0; i < 25000; i++) parts.push(`"${i}":1`);
  const text = `{${parts.join(',')}}`;
  assert.ok(Buffer.byteLength(text) < 262144, 'under the byte limit so the token rule is what fires');
  assert.deepEqual(parseSafe(text), { ok: false, reason: NESTED });
  const arr = `[${Array.from({ length: 21000 }, () => '1').join(',')}]`;
  assert.deepEqual(parseSafe(arr), { ok: false, reason: NESTED });
  const small = `[${Array.from({ length: 5000 }, () => '1').join(',')}]`;
  assert.equal(parseSafe(small).ok, true);
});

test('parseSafe reports invalid JSON with the pinned reason and never echoes the input', async () => {
  const { parseSafe } = await safe();
  for (const bad of ['{bad', '', 'undefined', '[1,]', 'NaN', "{'a':1}", '<html><script>alert(1)</script></html>', '{"a":1}}']) {
    assert.deepEqual(parseSafe(bad), { ok: false, reason: NOT_JSON }, JSON.stringify(bad));
  }
});

test('parseSafe rejects __proto__, constructor and prototype keys at any depth and leaves Object.prototype alone', async () => {
  const { parseSafe } = await safe();
  protoClean();
  const cases = [
    ['{"__proto__":{"polluted":true}}', '__proto__'],
    ['{"a":[{"b":{"constructor":{"prototype":{"polluted":true}}}}]}', 'constructor'],
    ['{"prototype":1}', 'prototype'],
    ['[{"x":{"y":[{"__proto__":1}]}}]', '__proto__'],
    ['{"\\u005f_proto__":{"isAdmin":true}}', '__proto__'],
  ];
  for (const [text, key] of cases) assert.deepEqual(parseSafe(text), { ok: false, reason: REASON_KEY(key) }, text);
  protoClean();
  assert.equal(parseSafe('{"proto":1,"constructors":2,"__proto":3}').ok, true, 'similar names are fine');
  protoClean();
});

test('parseSafe applies size, then nesting, then JSON syntax, then forbidden keys (first failure wins)', async () => {
  const { parseSafe } = await safe();
  const hugeBad = 'x'.repeat(300000);
  assert.match(parseSafe(hugeBad).reason, /^the file is 293 KB/);
  assert.equal(parseSafe('[[[[[[[[[[ not json').reason, NESTED);
  assert.equal(parseSafe('{"__proto__":1,').reason, NOT_JSON);
  assert.equal(parseSafe('[[[[[[[[[{"__proto__":1}]]]]]]]]]').reason, NESTED);
});

// ------------------------------------------------------------------ parseProgress: format and order
test('parseProgress accepts a valid document and serialiseProgress round-trips it (JSON.stringify comparison)', async () => {
  const { parseProgress, serialiseProgress } = await prog();
  const p = {
    version: 1,
    runs: [
      run(),
      run({ scenario: 'retry-storm', seed: 4294967295, result: 'out-of-budget', timeToMitigate: null, budgetLeft: 0, harmful: 2, hintUsed: true, score: 5, actions: [] }),
      run({ scenario: 'split-brain', timeToMitigate: 610, score: 100, budgetLeft: 12, harmful: 12, actions: Array.from({ length: 12 }, (_, i) => ({ t: i * 50, id: 'scale-service', node: 'service-1' })) }),
    ],
  };
  const text = serialiseProgress(p);
  assert.equal(text, JSON.stringify(p, null, 2));
  const r = parseProgress(text);
  assert.equal(r.ok, true, r.reason);
  assert.equal(JSON.stringify(r.progress), JSON.stringify(p));
  assert.equal(parseProgress(JSON.stringify(p)).ok, true, 'compact JSON is accepted too');
  assert.equal(Object.getPrototypeOf(r.progress), null);
  assert.equal(Object.getPrototypeOf(r.progress.runs[0].actions[0]), null);
});

test('parseProgress accepts an empty list, 200 runs and a document padded to exactly 262,144 bytes', async () => {
  const { parseProgress } = await prog();
  assert.equal(parseProgress(doc([])).ok, true);
  assert.equal(parseProgress(doc(Array.from({ length: 200 }, () => run()))).ok, true);
  const base = doc([run()]);
  const padded = base + ' '.repeat(262144 - Buffer.byteLength(base));
  assert.equal(Buffer.byteLength(padded), 262144);
  assert.equal(parseProgress(padded).ok, true);
  const over = padded + ' ';
  assert.deepEqual(parseProgress(over), { ok: false, reason: 'the file is 257 KB and the limit is 256 KB.' });
});

test('parseProgress passes the parseSafe reasons through (not JSON, forbidden key, nesting, size)', async () => {
  const { parseProgress } = await prog();
  assert.deepEqual(parseProgress('<html>hello</html>'), { ok: false, reason: NOT_JSON });
  assert.deepEqual(parseProgress('{"version":1,"runs":[],"__proto__":{"polluted":true}}'), { ok: false, reason: REASON_KEY('__proto__') });
  assert.deepEqual(parseProgress(doc([run({ actions: [{ t: 1, id: 'trace-request', node: null, constructor: {} }] })])), { ok: false, reason: REASON_KEY('constructor') });
  assert.deepEqual(parseProgress('{"version":1,"runs":[],"x":{"prototype":1}}'), { ok: false, reason: REASON_KEY('prototype') });
  assert.deepEqual(parseProgress('['.repeat(100)), { ok: false, reason: NESTED });
  protoClean();
});

test('parseProgress top level must be an object', async () => {
  const { parseProgress } = await prog();
  for (const t of ['[]', 'null', '5', '"text"', 'true', '[{"version":1,"runs":[]}]']) {
    assert.deepEqual(parseProgress(t), { ok: false, reason: 'the file must contain a JSON object.' }, t);
  }
});

test('parseProgress version check: numbers show the number, non-numbers show "unknown", long values are cut', async () => {
  const { parseProgress } = await prog();
  assert.deepEqual(parseProgress('{"version":7,"runs":[]}'), { ok: false, reason: 'this file is version 7 and this app reads version 1.' });
  assert.deepEqual(parseProgress('{"version":2,"runs":[]}'), { ok: false, reason: 'this file is version 2 and this app reads version 1.' });
  assert.deepEqual(parseProgress('{"version":"2","runs":[]}'), { ok: false, reason: 'this file is version unknown and this app reads version 1.' });
  assert.deepEqual(parseProgress('{"version":null,"runs":[]}'), { ok: false, reason: 'this file is version unknown and this app reads version 1.' });
  assert.deepEqual(parseProgress('{"version":true,"runs":[]}'), { ok: false, reason: 'this file is version unknown and this app reads version 1.' });
  assert.deepEqual(parseProgress('{"version":1.5,"runs":[]}'), { ok: false, reason: 'this file is version 1.5 and this app reads version 1.' });
  const long = parseProgress(`{"version":${'9'.repeat(60)},"runs":[]}`);
  assert.equal(long.ok, false);
  assert.match(long.reason, /^this file is version \S{1,44} and this app reads version 1\.$/);
  assert.ok(!long.reason.includes('9'.repeat(45)));
});

test('parseProgress version is checked before unknown keys and runs', async () => {
  const { parseProgress } = await prog();
  assert.equal(parseProgress('{"version":7,"extra":1,"runs":"x"}').reason, 'this file is version 7 and this app reads version 1.');
});

test('parseProgress rejects unknown top-level keys, naming the key (cut at 40 characters plus ...)', async () => {
  const { parseProgress } = await prog();
  assert.deepEqual(parseProgress('{"version":1,"runs":[],"extra":1}'), { ok: false, reason: 'field "extra" is not part of the progress format.' });
  const k = 'k'.repeat(100);
  const r = parseProgress(`{"version":1,"runs":[],"${k}":1}`);
  assert.deepEqual(r, { ok: false, reason: `field "${'k'.repeat(40)}..." is not part of the progress format.` });
});

test('parseProgress needs runs to be a list and caps the list at 200', async () => {
  const { parseProgress } = await prog();
  for (const t of ['{"version":1}', '{"version":1,"runs":{}}', '{"version":1,"runs":null}', '{"version":1,"runs":"x"}', '{"version":1,"runs":5}']) {
    assert.deepEqual(parseProgress(t), { ok: false, reason: 'field "runs" must be a list.' }, t);
  }
  assert.deepEqual(parseProgress(doc(Array.from({ length: 201 }, () => run()))), { ok: false, reason: 'the file holds 201 runs and the limit is 200.' });
});

test('parseProgress rejects unknown run keys (name), then missing keys, in that order, naming runs[i]', async () => {
  const { parseProgress } = await prog();
  assert.deepEqual(parseProgress(doc([run({ name: 'Ada' })])), { ok: false, reason: 'field "runs[0].name" is not part of the progress format.' });
  assert.deepEqual(parseProgress(doc([run(), run({ extra: 1 })])), { ok: false, reason: 'field "runs[1].extra" is not part of the progress format.' });
  for (const key of ['scenario', 'seed', 'scenarioHash', 'result', 'timeToMitigate', 'budgetLeft', 'harmful', 'hintUsed', 'score', 'actions']) {
    const r = run(); delete r[key];
    assert.deepEqual(parseProgress(doc([r])), { ok: false, reason: `field "runs[0].${key}" is missing.` }, key);
  }
  const both = run({ name: 'x' }); delete both.seed;
  assert.equal(parseProgress(doc([both])).reason, 'field "runs[0].name" is not part of the progress format.', 'unknown key before missing key');
  const bothB = run({ seed: 'bad' }); delete bothB.score;
  assert.equal(parseProgress(doc([bothB])).reason, 'field "runs[0].score" is missing.', 'missing key before type errors');
});

const mustBe = (field) => new RegExp(`^field "${field.replace(/[[\]]/g, '\\$&')}" must be .+\\.$`);

test('parseProgress type and range rules: seed is a uint32', async () => {
  const { parseProgress } = await prog();
  for (const v of [-1, 1.5, 4294967296, '1', null, true, [], {}]) {
    const r = parseProgress(doc([run({ seed: v })]));
    assert.equal(r.ok, false, JSON.stringify(v)); assert.match(r.reason, mustBe('runs[0].seed'));
  }
  for (const v of [0, 1, 4294967295]) assert.equal(parseProgress(doc([run({ seed: v })])).ok, true, String(v));
});

test('parseProgress type and range rules: scenarioHash is 8 lowercase hex digits', async () => {
  const { parseProgress } = await prog();
  for (const v of ['ABCDEF01', '0123abc', '0123abcde', 'zzzzzzzz', 5, null, '']) {
    const r = parseProgress(doc([run({ scenarioHash: v })]));
    assert.equal(r.ok, false, JSON.stringify(v)); assert.match(r.reason, mustBe('runs[0].scenarioHash'));
  }
  assert.equal(parseProgress(doc([run({ scenarioHash: '00000000' })])).ok, true);
});

test('parseProgress type and range rules: result is resolved or out-of-budget', async () => {
  const { parseProgress } = await prog();
  for (const v of ['won', 'RESOLVED', 'running', '', 1, null]) {
    const r = parseProgress(doc([run({ result: v })]));
    assert.equal(r.ok, false, JSON.stringify(v)); assert.match(r.reason, mustBe('runs[0].result'));
  }
});

test('parseProgress type and range rules: timeToMitigate is 1..610 or null, null exactly when out-of-budget', async () => {
  const { parseProgress } = await prog();
  for (const v of [0, 611, -3, 1.5, '41']) {
    const r = parseProgress(doc([run({ timeToMitigate: v })]));
    assert.equal(r.ok, false, JSON.stringify(v)); assert.match(r.reason, mustBe('runs[0].timeToMitigate'));
  }
  for (const v of [1, 610]) assert.equal(parseProgress(doc([run({ timeToMitigate: v })])).ok, true);
  assert.match(parseProgress(doc([run({ result: 'resolved', timeToMitigate: null })])).reason, mustBe('runs[0].timeToMitigate'));
  assert.match(parseProgress(doc([run({ result: 'out-of-budget', timeToMitigate: 40 })])).reason, mustBe('runs[0].timeToMitigate'));
  assert.equal(parseProgress(doc([run({ result: 'out-of-budget', timeToMitigate: null })])).ok, true);
});

test('parseProgress type and range rules: budgetLeft 0..12, harmful 0..12, score 0..100, hintUsed boolean', async () => {
  const { parseProgress } = await prog();
  const table = { budgetLeft: [[-1, 13, 1.5, '4'], [0, 12]], harmful: [[-1, 13, 0.5, null], [0, 12]], score: [[-1, 101, 50.5, '9'], [0, 100]], hintUsed: [['true', 1, null, 0], [true, false]] };
  for (const [key, [bad, good]] of Object.entries(table)) {
    for (const v of bad) {
      const r = parseProgress(doc([run({ [key]: v })]));
      assert.equal(r.ok, false, `${key}=${JSON.stringify(v)}`); assert.match(r.reason, mustBe(`runs[0].${key}`));
    }
    for (const v of good) assert.equal(parseProgress(doc([run({ [key]: v })])).ok, true, `${key}=${v}`);
  }
});

test('parseProgress scenario ids use only lowercase letters, digits and hyphens', async () => {
  const { parseProgress } = await prog();
  const want = 'field "runs[0].scenario" must use only lowercase letters, digits and hyphens.';
  for (const v of ['Bad_ID', '<script>alert(1)</script>', '', 'UPPER', 'has space', 'a'.repeat(41), '../etc/passwd', 'café']) {
    assert.deepEqual(parseProgress(doc([run({ scenario: v })])), { ok: false, reason: want }, JSON.stringify(v));
  }
  assert.equal(parseProgress(doc([run({ scenario: 'a'.repeat(40) })])).ok, true);
  assert.equal(parseProgress(doc([run({ scenario: '0-9-z' })])).ok, true);
  assert.equal(parseProgress(doc([run({ scenario: 5 })])).ok, false);
});

test('parseProgress knownScenarios rejects incidents this copy does not have, only when the list is given', async () => {
  const { parseProgress } = await prog();
  const ids = ['cache-stampede', 'retry-storm'];
  const known = Object.assign([...ids], { has: (x) => ids.includes(x) });
  const text = doc([run(), run({ scenario: 'unknown-incident' })]);
  assert.deepEqual(parseProgress(text, { knownScenarios: known }), { ok: false, reason: '"runs[1].scenario" names an incident this copy does not have.' });
  assert.equal(parseProgress(text).ok, true);
  assert.equal(parseProgress(doc([run(), run({ scenario: 'retry-storm' })]), { knownScenarios: known }).ok, true);
});

test('parseProgress action rules: t 0..610, catalogue id but never inspect, node an id or null, at most 12', async () => {
  const { parseProgress } = await prog();
  const act = (o) => doc([run({ actions: [{ t: 3, id: 'trace-request', node: null, ...o }] })]);
  for (const id of ['inspect', 'reboot-everything', '', 5, null, '__proto__x']) {
    assert.deepEqual(parseProgress(act({ id })), { ok: false, reason: 'field "runs[0].actions[0].id" is not a known action.' }, JSON.stringify(id));
  }
  for (const id of ['trace-request', 'tail-logs', 'compare-dashboards', 'deploy-history', 'scale-service', 'add-ttl-jitter', 'circuit-breaker', 'backoff-jitter', 'shed-load', 'failover', 'shard-rekey', 'add-index', 'rollback', 'raise-pool-size', 'renew-cert']) {
    assert.equal(parseProgress(act({ id })).ok, true, id);
  }
  for (const t of [-1, 611, 1.5, '3', null]) assert.match(parseProgress(act({ t })).reason, mustBe('runs[0].actions[0].t'), String(t));
  for (const t of [0, 610]) assert.equal(parseProgress(act({ t })).ok, true);
  for (const node of ['nope', 5, '<b>', true]) assert.match(parseProgress(act({ node })).reason, mustBe('runs[0].actions[0].node'), JSON.stringify(node));
  assert.equal(parseProgress(act({ node: 'service-2' })).ok, true);
  const many = Array.from({ length: 13 }, () => ({ t: 1, id: 'trace-request', node: null }));
  assert.match(parseProgress(doc([run({ actions: many })])).reason, mustBe('runs[0].actions'));
  assert.equal(parseProgress(doc([run({ actions: many.slice(0, 12) })])).ok, true);
  assert.match(parseProgress(doc([run({ actions: 'x' })])).reason, mustBe('runs[0].actions'));
});

test('parseProgress never echoes a value: hostile strings stay out of every reason', async () => {
  const { parseProgress } = await prog();
  const payloads = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', "'; DROP TABLE runs;--", '${globalThis.__pwn=1}', '‮bidi'];
  for (const p of payloads) {
    for (const make of [
      () => doc([run({ scenario: p })]), () => doc([run({ result: p })]), () => doc([run({ scenarioHash: p })]),
      () => doc([run({ actions: [{ t: 1, id: p, node: null }] })]), () => doc([run({ actions: [{ t: 1, id: 'trace-request', node: p }] })]),
      () => `{"version":${JSON.stringify(p)},"runs":[]}`,
    ]) {
      const r = parseProgress(make());
      assert.equal(r.ok, false);
      assert.ok(!r.reason.includes(p.slice(0, 8)) || p.length < 8, `reason echoes ${JSON.stringify(p)}: ${r.reason}`);
    }
  }
  assert.equal(globalThis.__pwn, undefined);
  protoClean();
});

test('hostile import files from ux check 23 are rejected, nothing is polluted, nothing is evaluated', async () => {
  const { parseProgress } = await prog();
  const hostile = [
    '{"__proto__":{"polluted":true},"version":1,"runs":[]}',
    `{"version":1,"runs":[{"constructor":{"prototype":{"isAdmin":true}}}]}`,
    `{"version":1,"runs":[],"prototype":{"x":1}}`,
    '<!doctype html><script>globalThis.__pwn=1</script>',
    JSON.stringify({ version: 1, runs: [run({ scenario: '<img src=x onerror=globalThis.__pwn=1>' })] }),
    JSON.stringify({ version: 7, runs: [] }),
    '['.repeat(100),
    `{${Array.from({ length: 25000 }, (_, i) => `"${i}":0`).join(',')}}`,
    `"${'a'.repeat(262143)}"`,
  ];
  for (const text of hostile) {
    const r = parseProgress(text);
    assert.equal(r.ok, false, text.slice(0, 40));
    assert.equal(typeof r.reason, 'string');
    assert.equal('progress' in r, false);
    protoClean();
  }
  assert.equal(globalThis.__pwn, undefined);
});

test('a rejected import leaves the stored progress untouched (importer flow on a fake store)', async () => {
  const { parseProgress, serialiseProgress, emptyProgress, addRun } = await prog();
  let store = serialiseProgress(addRun(emptyProgress(), run()));
  const before = store;
  const attempts = ['{"version":7,"runs":[]}', '{bad', '{"__proto__":1}', doc([run({ name: 'x' })]), doc(Array.from({ length: 201 }, () => run()))];
  for (const text of attempts) {
    const r = parseProgress(text);
    if (r.ok) store = serialiseProgress(r.progress);
    assert.equal(store, before);
  }
  assert.equal(parseProgress(store).ok, true);
});

// ------------------------------------------------------------------ serialise, filename, store helpers
test('exportFilename builds incident-sim-progress-<date>.json', async () => {
  const { exportFilename } = await prog();
  assert.equal(exportFilename('2026-11-19'), 'incident-sim-progress-2026-11-19.json');
  assert.equal(exportFilename('2099-12-31'), 'incident-sim-progress-2099-12-31.json');
});

test('emptyProgress returns a fresh {version:1, runs:[]} each call', async () => {
  const { emptyProgress } = await prog();
  const a = emptyProgress(); const b = emptyProgress();
  assert.equal(JSON.stringify(a), '{"version":1,"runs":[]}');
  assert.notEqual(a, b);
  a.runs.push(1);
  assert.equal(b.runs.length, 0);
});

test('addRun appends purely and drops the oldest beyond 200 runs', async () => {
  const { addRun, emptyProgress } = await prog();
  let p = emptyProgress();
  const frozen = JSON.stringify(p);
  const q = addRun(p, run({ seed: 1 }));
  assert.equal(JSON.stringify(p), frozen, 'input untouched');
  assert.equal(q.runs.length, 1);
  p = q;
  for (let i = 2; i <= 200; i++) p = addRun(p, run({ seed: i }));
  assert.equal(p.runs.length, 200);
  assert.equal(p.runs[0].seed, 1);
  const over = addRun(p, run({ seed: 201 }));
  assert.equal(over.runs.length, 200);
  assert.equal(over.runs[0].seed, 2, 'the oldest run is dropped');
  assert.equal(over.runs.at(-1).seed, 201);
  assert.equal(p.runs.length, 200);
  assert.equal(p.runs[0].seed, 1, 'input untouched when dropping');
});

test('addRun keeps the serialised progress at most 262,144 bytes by dropping the oldest runs', async () => {
  const { addRun, emptyProgress, serialiseProgress } = await prog();
  let p = emptyProgress();
  for (let i = 0; i < 150; i++) p = addRun(p, run({ seed: i, scenario: 'x'.repeat(2000) }));
  assert.ok(Buffer.byteLength(serialiseProgress(p)) <= 262144);
  assert.equal(p.runs.at(-1).seed, 149, 'the newest run is kept');
  assert.ok(p.runs.length < 150 && p.runs.length >= 100, `kept ${p.runs.length}`);
  assert.equal(p.runs[0].seed, 150 - p.runs.length, 'dropped from the front only');
});

test('bests derives state, best time, best score and run count per scenario; resolvedCount counts distinct resolved scenarios', async () => {
  const { bests, resolvedCount, lastRun, emptyProgress, addRun } = await prog();
  let p = emptyProgress();
  assert.equal(Object.keys(bests(p)).length, 0);
  assert.equal(resolvedCount(p), 0);
  p = addRun(p, run({ scenario: 'a', timeToMitigate: 50, score: 70, seed: 1 }));
  p = addRun(p, run({ scenario: 'a', timeToMitigate: 40, score: 85, seed: 2 }));
  p = addRun(p, run({ scenario: 'b', result: 'out-of-budget', timeToMitigate: null, score: 20, seed: 3 }));
  p = addRun(p, run({ scenario: 'c', result: 'out-of-budget', timeToMitigate: null, score: 5, seed: 4 }));
  p = addRun(p, run({ scenario: 'c', timeToMitigate: 90, score: 60, seed: 5 }));
  p = addRun(p, run({ scenario: 'a', result: 'out-of-budget', timeToMitigate: null, score: 20, seed: 6 }));
  const b = bests(p);
  assert.deepEqual(Object.keys(b).sort(), ['a', 'b', 'c']);
  assert.equal(b.a.state, 'resolved');
  assert.equal(b.a.bestTime, 40);
  assert.equal(b.a.bestScore, 85);
  assert.equal(b.a.runs, 3);
  assert.equal(b.b.state, 'out-of-budget');
  assert.equal(b.b.bestTime, null);
  assert.equal(b.b.runs, 1);
  assert.equal(b.c.state, 'resolved', 'any resolved run makes the scenario resolved');
  assert.equal(b.c.bestTime, 90);
  assert.equal(resolvedCount(p), 2);
  assert.equal(lastRun(p, 'a').seed, 6);
  assert.equal(lastRun(p, 'c').seed, 5);
  assert.equal(lastRun(p, 'zzz'), null);
});

// ------------------------------------------------------------------ scenarioHash
test('scenarioHash is stable across key order and changes with content (progress replay guard)', async () => {
  const E = await engine();
  const a = { id: 'x', n: 1, nested: { b: 2, a: 1 } };
  const b = { nested: { a: 1, b: 2 }, n: 1, id: 'x' };
  assert.equal(E.fingerprint.scenarioHash(a), E.fingerprint.scenarioHash(b));
  assert.notEqual(E.fingerprint.scenarioHash(a), E.fingerprint.scenarioHash({ ...a, n: 2 }));
  assert.equal(E.fingerprint.scenarioHash(a), E.hash.hex8(E.hash.fnv1a32('{"id":"x","n":1,"nested":{"a":1,"b":2}}')));
});

// ------------------------------------------------------------------ settings
test('parseSettings defaults to {shortcuts:true} for anything invalid and round-trips valid values', async () => {
  const { parseSettings, serialiseSettings } = await mod('core/settings');
  for (const bad of ['', 'nope', '[]', 'null', '5', '{"shortcuts":"no"}', '{"shortcuts":1}', '{"__proto__":{"shortcuts":false}}', '{', undefined, null]) {
    assert.deepEqual({ ...parseSettings(bad) }, { shortcuts: true }, JSON.stringify(bad));
  }
  assert.deepEqual({ ...parseSettings('{"shortcuts":false}') }, { shortcuts: false });
  assert.deepEqual({ ...parseSettings('{"shortcuts":true}') }, { shortcuts: true });
  for (const v of [true, false]) assert.deepEqual({ ...parseSettings(serialiseSettings({ shortcuts: v })) }, { shortcuts: v });
  assert.equal(typeof serialiseSettings({ shortcuts: false }), 'string');
});
