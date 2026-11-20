// core/progress.js: strict v1 validator, helpers, size limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProgress, serialiseProgress, exportFilename, emptyProgress, addRun, bests, bestFor, resolvedCount, lastRun, MAX_RUNS, MAX_BYTES } from '../public/js/core/progress.js';

const run = (o = {}) => ({
  scenario: 'cache-stampede', seed: 1, scenarioHash: '0123abcd', result: 'resolved', timeToMitigate: 41, budgetLeft: 4, harmful: 0, hintUsed: false, score: 87,
  actions: [{ t: 6, id: 'trace-request', node: null }, { t: 8, id: 'add-ttl-jitter', node: 'cache' }], ...o,
});
const doc = (runs, extra = {}) => JSON.stringify({ version: 1, runs, ...extra });
const reason = (text, opts) => { const r = parseProgress(text, opts); assert.equal(r.ok, false, text.slice(0, 80)); return r.reason; };

test('a valid document round-trips through serialiseProgress and parseProgress', () => {
  const p = { version: 1, runs: [run(), run({ scenario: 'retry-storm', result: 'out-of-budget', timeToMitigate: null, budgetLeft: 0, harmful: 2, hintUsed: true, score: 5, actions: [] })] };
  const text = serialiseProgress(p);
  assert.equal(text, JSON.stringify(p, null, 2));
  const r = parseProgress(text);
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(r.progress), JSON.stringify(p));
  assert.equal(Object.getPrototypeOf(r.progress), null);
  assert.equal(Object.getPrototypeOf(r.progress.runs[0]), null);
  assert.equal(Object.getPrototypeOf(r.progress.runs[0].actions[0]), null);
});

test('the parsed value is rebuilt in format key order whatever the file order', () => {
  const shuffled = { runs: [{ actions: [{ node: 'cache', id: 'add-ttl-jitter', t: 3 }], score: 1, hintUsed: false, harmful: 0, budgetLeft: 1, timeToMitigate: 2, result: 'resolved', scenarioHash: 'abcdef01', seed: 5, scenario: 'x' }], version: 1 };
  const r = parseProgress(JSON.stringify(shuffled));
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.progress), ['version', 'runs']);
  assert.deepEqual(Object.keys(r.progress.runs[0]), ['scenario', 'seed', 'scenarioHash', 'result', 'timeToMitigate', 'budgetLeft', 'harmful', 'hintUsed', 'score', 'actions']);
  assert.deepEqual(Object.keys(r.progress.runs[0].actions[0]), ['t', 'id', 'node']);
});

test('safe-json reasons pass through', () => {
  assert.equal(reason('<html>'), 'the file is not valid JSON. Export a fresh file from this page and try again.');
  assert.equal(reason('{"version":1,"runs":[],"__proto__":{}}'), 'the file contains the key "__proto__", which is not allowed.');
  assert.equal(reason('['.repeat(50)), 'the file is nested too deeply.');
  assert.equal(reason(`"${'a'.repeat(262143)}"`), 'the file is 257 KB and the limit is 256 KB.');
  assert.equal(Object.keys(Object.prototype).length, 0);
});

test('size boundary: exactly 262,144 bytes is accepted', () => {
  const base = doc([run()]);
  const padded = base + ' '.repeat(MAX_BYTES - Buffer.byteLength(base));
  assert.equal(Buffer.byteLength(padded), 262144);
  assert.equal(parseProgress(padded).ok, true);
  assert.match(reason(padded + ' '), /^the file is 257 KB/);
});

test('top level must be an object, with a known version and keys', () => {
  for (const t of ['[]', 'null', '5', '"s"', 'true']) assert.equal(reason(t), 'the file must contain a JSON object.');
  assert.equal(reason('{"version":7,"runs":[]}'), 'this file is version 7 and this app reads version 1.');
  assert.equal(reason('{"runs":[]}'), 'this file is version unknown and this app reads version 1.');
  assert.equal(reason('{"version":"1","runs":[]}'), 'this file is version unknown and this app reads version 1.');
  assert.equal(reason('{"version":1.5,"runs":[]}'), 'this file is version 1.5 and this app reads version 1.');
  assert.equal(reason('{"version":0,"runs":[]}'), 'this file is version 0 and this app reads version 1.');
  assert.equal(reason('{"version":7,"extra":1,"runs":"x"}'), 'this file is version 7 and this app reads version 1.');
  assert.equal(reason('{"version":1,"runs":[],"extra":1}'), 'field "extra" is not part of the progress format.');
  assert.equal(reason(`{"version":1,"runs":[],"${'k'.repeat(41)}":1}`), `field "${'k'.repeat(40)}..." is not part of the progress format.`);
  assert.equal(reason(`{"version":1,"runs":[],"${'k'.repeat(40)}":1}`), `field "${'k'.repeat(40)}" is not part of the progress format.`);
  assert.match(reason(`{"version":${'9'.repeat(60)},"runs":[]}`), /^this file is version 1e\+60 and/);
});

test('runs must be a list of at most 200', () => {
  for (const t of ['{"version":1}', '{"version":1,"runs":{}}', '{"version":1,"runs":null}', '{"version":1,"runs":"x"}']) assert.equal(reason(t), 'field "runs" must be a list.');
  assert.equal(parseProgress(doc([])).ok, true);
  assert.equal(parseProgress(doc(Array.from({ length: 200 }, () => run()))).ok, true);
  assert.equal(reason(doc(Array.from({ length: 201 }, () => run()))), 'the file holds 201 runs and the limit is 200.');
  assert.equal(MAX_RUNS, 200);
});

test('run keys: unknown first, then missing, then types; each names runs[i]', () => {
  assert.equal(reason(doc([run({ name: 'Ada' })])), 'field "runs[0].name" is not part of the progress format.');
  assert.equal(reason(doc([run(), run({ extra: 1 })])), 'field "runs[1].extra" is not part of the progress format.');
  for (const key of ['scenario', 'seed', 'scenarioHash', 'result', 'timeToMitigate', 'budgetLeft', 'harmful', 'hintUsed', 'score', 'actions']) {
    const r = run(); delete r[key];
    assert.equal(reason(doc([r])), `field "runs[0].${key}" is missing.`);
  }
  const both = run({ name: 'x' }); delete both.seed;
  assert.equal(reason(doc([both])), 'field "runs[0].name" is not part of the progress format.');
  const bad = run({ seed: 'bad' }); delete bad.score;
  assert.equal(reason(doc([bad])), 'field "runs[0].score" is missing.');
  for (const v of [null, 5, 'x', []]) assert.equal(reason(doc([v])), 'field "runs[0]" must be an object.');
});

const rangeCases = {
  seed: [[-1, 4294967296, 1.5, '1', null, true], [0, 4294967295]],
  budgetLeft: [[-1, 13, 1.5, '4'], [0, 12]],
  harmful: [[-1, 13, 0.5, null], [0, 12]],
  score: [[-1, 101, 50.5, '9'], [0, 100]],
  hintUsed: [['true', 1, null, 0], [true, false]],
  scenarioHash: [['ABCDEF01', '0123abc', '0123abcde', 'zzzzzzzz', 5, null, ''], ['00000000', 'ffffffff']],
};
for (const [key, [bad, good]] of Object.entries(rangeCases)) {
  test(`run field ${key}: boundaries on both sides`, () => {
    for (const v of bad) assert.match(reason(doc([run({ [key]: v })])), new RegExp(`^field "runs\\[0\\]\\.${key}" must be .+\\.$`), JSON.stringify(v));
    for (const v of good) assert.equal(parseProgress(doc([run({ [key]: v })])).ok, true, String(v));
  });
}

test('result and timeToMitigate go together: null exactly when out-of-budget, 1..610 otherwise', () => {
  for (const v of ['won', 'RESOLVED', '', 1, null]) assert.match(reason(doc([run({ result: v })])), /^field "runs\[0\]\.result" must be /);
  for (const v of [0, 611, -3, 1.5, '41', null]) assert.match(reason(doc([run({ timeToMitigate: v })])), /^field "runs\[0\]\.timeToMitigate" must be /, String(v));
  for (const v of [1, 610]) assert.equal(parseProgress(doc([run({ timeToMitigate: v })])).ok, true);
  assert.match(reason(doc([run({ result: 'out-of-budget', timeToMitigate: 40 })])), /^field "runs\[0\]\.timeToMitigate" must be null/);
  assert.equal(parseProgress(doc([run({ result: 'out-of-budget', timeToMitigate: null })])).ok, true);
});

test('scenario ids: pattern, 1..40 characters, and the known list when given', () => {
  const want = 'field "runs[0].scenario" must use only lowercase letters, digits and hyphens.';
  for (const v of ['Bad_ID', '<script>', '', 'UPPER', 'has space', 'a'.repeat(41), '../etc', 'café', 5, null]) assert.equal(reason(doc([run({ scenario: v })])), want, JSON.stringify(v));
  for (const v of ['a', 'a'.repeat(40), '0-9-z']) assert.equal(parseProgress(doc([run({ scenario: v })])).ok, true, v);
  const text = doc([run(), run({ scenario: 'gone' })]);
  const msg = '"runs[1].scenario" names an incident this copy does not have.';
  assert.equal(reason(text, { knownScenarios: new Set(['cache-stampede']) }), msg);
  assert.equal(reason(text, { knownScenarios: ['cache-stampede'] }), msg);
  assert.equal(parseProgress(text).ok, true);
  assert.equal(parseProgress(text, { knownScenarios: new Set(['cache-stampede', 'gone']) }).ok, true);
  assert.equal(parseProgress(text, { knownScenarios: ['cache-stampede', 'gone'] }).ok, true);
  assert.equal(reason(text, { knownScenarios: 'cache-stampede' }), '"runs[0].scenario" names an incident this copy does not have.', 'a string is not a list');
});

test('actions: t, id (never inspect), node, shape and count', () => {
  const act = (o) => doc([run({ actions: [{ t: 3, id: 'trace-request', node: null, ...o }] })]);
  for (const id of ['inspect', 'reboot-everything', '', 5, null]) assert.equal(reason(act({ id })), 'field "runs[0].actions[0].id" is not a known action.');
  for (const id of ['trace-request', 'tail-logs', 'compare-dashboards', 'deploy-history', 'scale-service', 'add-ttl-jitter', 'circuit-breaker', 'backoff-jitter', 'shed-load', 'failover', 'shard-rekey', 'add-index', 'rollback', 'raise-pool-size', 'renew-cert']) {
    assert.equal(parseProgress(act({ id })).ok, true, id);
  }
  for (const t of [-1, 611, 1.5, '3', null]) assert.match(reason(act({ t })), /^field "runs\[0\]\.actions\[0\]\.t" must be /);
  for (const t of [0, 610]) assert.equal(parseProgress(act({ t })).ok, true);
  for (const node of ['nope', 5, '<b>', true]) assert.match(reason(act({ node })), /^field "runs\[0\]\.actions\[0\]\.node" must be /);
  for (const node of ['service-2', 'clients', 'third-party', null]) assert.equal(parseProgress(act({ node })).ok, true, String(node));
  assert.equal(reason(act({ extra: 1 })), 'field "runs[0].actions[0].extra" is not part of the progress format.');
  assert.equal(reason(doc([run({ actions: [{ t: 1, id: 'tail-logs' }] })])), 'field "runs[0].actions[0].node" is missing.');
  assert.equal(reason(doc([run({ actions: [null] })])), 'field "runs[0].actions[0]" must be an object.');
  assert.equal(reason(doc([run({ actions: [[]] })])), 'field "runs[0].actions[0]" must be an object.');
  const many = Array.from({ length: 13 }, () => ({ t: 1, id: 'trace-request', node: null }));
  assert.match(reason(doc([run({ actions: many })])), /^field "runs\[0\]\.actions" must be /);
  assert.equal(parseProgress(doc([run({ actions: many.slice(0, 12) })])).ok, true);
  assert.match(reason(doc([run({ actions: 'x' })])), /^field "runs\[0\]\.actions" must be /);
  assert.match(reason(doc([run(), run({ actions: [{ t: 1, id: 'nope', node: null }] })])), /^field "runs\[1\]\.actions\[0\]\.id"/);
});

test('reasons never echo hostile values', () => {
  const payloads = ['<script>alert(1)</script>', "'; DROP TABLE runs;--", '${globalThis.__pwn=1}'];
  for (const p of payloads) {
    for (const t of [doc([run({ scenario: p })]), doc([run({ result: p })]), doc([run({ scenarioHash: p })]), doc([run({ actions: [{ t: 1, id: p, node: null }] })]), doc([run({ actions: [{ t: 1, id: 'tail-logs', node: p }] })]), `{"version":${JSON.stringify(p)},"runs":[]}`]) {
      assert.ok(!reason(t).includes(p.slice(0, 8)));
    }
  }
  assert.equal(globalThis.__pwn, undefined);
});

test('exportFilename and emptyProgress', () => {
  assert.equal(exportFilename('2026-11-19'), 'incident-sim-progress-2026-11-19.json');
  const a = emptyProgress();
  assert.equal(JSON.stringify(a), '{"version":1,"runs":[]}');
  a.runs.push(1);
  assert.equal(emptyProgress().runs.length, 0);
});

test('addRun is pure, appends, and drops the oldest beyond 200', () => {
  const p0 = emptyProgress();
  const p1 = addRun(p0, run({ seed: 1 }));
  assert.equal(p0.runs.length, 0);
  assert.equal(p1.runs.length, 1);
  let p = p1;
  for (let i = 2; i <= 200; i++) p = addRun(p, run({ seed: i }));
  assert.equal(p.runs.length, 200);
  assert.equal(p.runs[0].seed, 1);
  const over = addRun(p, run({ seed: 201 }));
  assert.equal(over.runs.length, 200);
  assert.equal(over.runs[0].seed, 2);
  assert.equal(over.runs.at(-1).seed, 201);
  assert.equal(p.runs[0].seed, 1);
  assert.equal(over.version, 1);
});

test('addRun drops the oldest runs until the serialised text fits 262,144 bytes', () => {
  let p = emptyProgress();
  for (let i = 0; i < 150; i++) p = addRun(p, run({ seed: i, scenario: 'x'.repeat(2000) }));
  assert.ok(Buffer.byteLength(serialiseProgress(p)) <= 262144);
  assert.equal(p.runs.at(-1).seed, 149);
  assert.ok(p.runs.length >= 100 && p.runs.length < 150);
  assert.equal(p.runs[0].seed, 150 - p.runs.length);
  const huge = addRun(emptyProgress(), run({ scenario: 'x'.repeat(300000) }));
  assert.equal(huge.runs.length, 0, 'a single run that can never fit is dropped');
});

test('bests, bestFor, resolvedCount and lastRun derive from the runs', () => {
  let p = emptyProgress();
  assert.deepEqual(bests(p), {});
  assert.equal(resolvedCount(p), 0);
  assert.equal(lastRun(p, 'a'), null);
  p = addRun(p, run({ scenario: 'a', timeToMitigate: 50, score: 70, seed: 1 }));
  p = addRun(p, run({ scenario: 'a', timeToMitigate: 40, score: 85, seed: 2 }));
  p = addRun(p, run({ scenario: 'b', result: 'out-of-budget', timeToMitigate: null, score: 20, seed: 3 }));
  p = addRun(p, run({ scenario: 'c', result: 'out-of-budget', timeToMitigate: null, score: 5, seed: 4 }));
  p = addRun(p, run({ scenario: 'c', timeToMitigate: 90, score: 60, seed: 5 }));
  p = addRun(p, run({ scenario: 'a', timeToMitigate: 45, score: 30, seed: 6 }));
  p = addRun(p, run({ scenario: 'a', result: 'out-of-budget', timeToMitigate: null, score: 20, seed: 7 }));
  const b = bests(p);
  assert.deepEqual(b.a, { state: 'resolved', bestTime: 40, bestScore: 85, runs: 4 });
  assert.deepEqual(b.b, { state: 'out-of-budget', bestTime: null, bestScore: 20, runs: 1 });
  assert.deepEqual(b.c, { state: 'resolved', bestTime: 90, bestScore: 60, runs: 2 });
  assert.equal(resolvedCount(p), 2);
  assert.equal(lastRun(p, 'a').seed, 7);
  assert.equal(lastRun(p, 'c').seed, 5);
  assert.equal(lastRun(p, 'zzz'), null);
  assert.deepEqual(bestFor(b, 'a'), b.a);
  assert.deepEqual(bestFor(b, 'never'), { state: 'new', bestTime: null, bestScore: null, runs: 0 });
  assert.deepEqual(bestFor(b, 'constructor'), { state: 'new', bestTime: null, bestScore: null, runs: 0 });
});

test('lastRun finds a scenario whose only run is the first one', () => {
  const p = addRun(addRun(emptyProgress(), run({ scenario: 'first-only', seed: 9 })), run({ scenario: 'other', seed: 10 }));
  assert.equal(lastRun(p, 'first-only').seed, 9);
});
