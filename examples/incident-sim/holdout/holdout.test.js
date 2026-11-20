// Hidden grading tests for incident-sim. Rules from spec.md that are easy to miss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Resolved from the working directory so the gate grades the trial's own code, also when this folder is hidden elsewhere (HARNESS_HIDDEN_DIR).
const here = (...p) => path.join(process.cwd(), ...p);
const helpers = await import(pathToFileURL(here('acceptance', 'helpers.js')).href);
const { withServer, startServer, runToExit, rawExchange, SECURITY_HEADERS } = helpers;
const js = (rel) => import(pathToFileURL(here('public', 'js', `${rel}.js`)).href);
const scenarioRaw = (id) => JSON.parse(fs.readFileSync(here('scenarios', `${id}.json`), 'utf8'));
const loadSc = async (id) => {
  const { validate, formatError } = await js('engine/validate');
  const r = validate(scenarioRaw(id), `${id}.json`);
  assert.ok(r.ok, r.ok ? '' : r.errors.map(formatError).join('; '));
  return r.scenario;
};
const run = async (id, seed, log = [], until = Infinity) => {
  const { createRun, step } = await js('engine/engine');
  const sc = await loadSc(id);
  let s = createRun(sc, seed);
  const sorted = [...log].sort((a, b) => a.t - b.t);
  let i = 0;
  while (s.status === 'running' && s.tick < until) {
    const acts = [];
    while (i < sorted.length && sorted[i].t < s.tick) i++;
    while (i < sorted.length && sorted[i].t === s.tick) { acts.push({ id: sorted[i].id, node: sorted[i].node ?? null }); i++; }
    s = step(s, acts);
  }
  return { s, sc };
};

test('inspect is free and invisible: no cost, no action log entry, no fingerprint change', async () => {
  const { createRun, step } = await js('engine/engine');
  const { fingerprint, scenarioHash } = await js('engine/fingerprint');
  const sc = await loadSc('cache-stampede');
  const a = step(createRun(sc, 3), [{ id: 'inspect', node: 'cache' }]);
  const b = step(createRun(sc, 3), []);
  assert.equal(a.budgetLeft, sc.budget);
  assert.deepEqual(a.actionLog, []);
  assert.equal(a.hash, b.hash, 'identical hash chain with and without inspect');
  const fp = (s) => fingerprint({ scenarioId: sc.id, scenarioHash: scenarioHash(sc), seed: 3, actionLog: s.actionLog, hintUsed: false });
  assert.equal(fp(a), fp(b));
});

test('canApply order: an over run says "The incident is over." even with budget 0, and budget 0 beats a missing target', async () => {
  const { createRun, step, canApply } = await js('engine/engine');
  const sc = await loadSc('cache-stampede');
  let s = createRun(sc, 1);
  s = step(s, Array.from({ length: sc.budget }, () => ({ id: 'trace-request', node: null })));
  assert.deepEqual(canApply(s, 'scale-service', null), { ok: false, reason: 'Out of pager budget.' });
  for (let i = 0; i < 10; i++) s = step(s, []);
  assert.equal(s.status, 'out-of-budget');
  assert.deepEqual(canApply(s, 'scale-service', null), { ok: false, reason: 'The incident is over.' });
});

test('step stamps t with the engine tick and ignores a caller-supplied t', async () => {
  const { createRun, step } = await js('engine/engine');
  const sc = await loadSc('cache-stampede');
  let s = createRun(sc, 1);
  for (let i = 0; i < 4; i++) s = step(s, []);
  const out = step(s, [{ id: 'trace-request', node: null, t: -5 }, { id: 'add-ttl-jitter', node: 'cache', t: 99999 }]);
  assert.deepEqual(out.actionLog.map((a) => a.t), [4, 4]);
});

test('escalation drains one lamp every escalateEvery ticks after the first page with a warn log on node null', async () => {
  const { s, sc } = await run('cache-stampede', 1);
  const lines = s.logs.filter((l) => l.text === 'Escalation: still paging after 90 s.');
  assert.ok(lines.length >= 1);
  assert.equal(lines[0].t, s.firstPageTick + sc.escalateEvery);
  assert.deepEqual([lines[0].kind, lines[0].level, lines[0].node], ['log', 'warn', null]);
});

test('the grace window lasts exactly 10 steps after the last lamp is spent', async () => {
  const { createRun, step } = await js('engine/engine');
  const sc = await loadSc('retry-storm');
  let s = step(createRun(sc, 1), Array.from({ length: sc.budget }, () => ({ id: 'trace-request', node: null })));
  assert.equal(s.graceLeft, 10);
  let steps = 0;
  while (s.status === 'running') { s = step(s, []); steps++; }
  assert.equal(steps, 10);
  assert.equal(s.status, 'out-of-budget');
});

test('score: out of budget with nothing harmful is 20 (not 0), 15 with a hint, and always Escalated', async () => {
  const { score } = await js('engine/score');
  const base = { result: 'out-of-budget', timeToMitigate: null, optimalTime: 40, budgetLeft: 0, budget: 6, optimalCost: 2, harmful: 0, hintUsed: false };
  assert.deepEqual([score(base).score, score(base).tier], [20, 'Escalated']);
  assert.equal(score({ ...base, hintUsed: true }).score, 15);
  assert.equal(score({ ...base, harmful: 5, hintUsed: true }).score, 0);
});

test('retryAmplification caps the error rate at 0.95 and softens backoff to a quarter of the extra load', async () => {
  const { retryAmplification } = await js('engine/model');
  assert.equal(retryAmplification(0.99, 1, false), 1.95);
  assert.equal(retryAmplification(0.5, 2, true), 1.1875);
  assert.equal(retryAmplification(0.5, 2, false), 1.75);
});

test('daily: sorted de-duplicated ids, 2026-12-31 is #365 thundering-herd, 2100-01-01 and 2026-02-30 are RangeErrors', async () => {
  const { daily } = await js('core/daily');
  const ids = ['cache-stampede', 'thundering-herd', 'retry-storm', 'hot-partition', 'queue-backlog', 'n-plus-one', 'connection-pool-exhaustion', 'expiring-certificate', 'split-brain', 'cascading-failure'];
  const d = daily('2026-12-31', [...ids.slice().reverse(), ...ids]);
  assert.deepEqual({ ...d }, { date: '2026-12-31', number: 365, scenarioId: 'thundering-herd', seed: 3131713203 });
  assert.throws(() => daily('2100-01-01', ids), RangeError);
  assert.throws(() => daily('2026-02-30', ids), RangeError);
  assert.equal(daily('2026-11-19', []).scenarioId, null);
});

test('parseSafe nesting: depth 8 passes, depth 9 fails, brackets inside strings do not count', async () => {
  const { parseSafe } = await js('core/safe-json');
  assert.equal(parseSafe('['.repeat(8) + ']'.repeat(8)).ok, true);
  assert.equal(parseSafe('['.repeat(9) + ']'.repeat(9)).reason, 'the file is nested too deeply.');
  assert.equal(parseSafe(JSON.stringify(['[[[[[[[[[[[[[[[[[[[[', '\\"[[[['])).ok, true);
});

test('parseProgress: an unknown run key is reported before a missing key, and timeToMitigate is null exactly when out of budget', async () => {
  const { parseProgress } = await js('core/progress');
  const run1 = { scenario: 'cache-stampede', seed: 1, scenarioHash: '0123abcd', result: 'resolved', timeToMitigate: 41, budgetLeft: 4, harmful: 0, hintUsed: false, score: 87, actions: [] };
  const withName = { ...run1, name: 'Ada' }; delete withName.seed;
  assert.equal(parseProgress(JSON.stringify({ version: 1, runs: [withName] })).reason, 'field "runs[0].name" is not part of the progress format.');
  assert.equal(parseProgress(JSON.stringify({ version: 1, runs: [{ ...run1, timeToMitigate: null }] })).ok, false);
  assert.equal(parseProgress(JSON.stringify({ version: 1, runs: [{ ...run1, result: 'out-of-budget', timeToMitigate: null }] })).ok, true);
  const base = JSON.stringify({ version: 1, runs: [run1] });
  assert.equal(parseProgress(base + ' '.repeat(262144 - Buffer.byteLength(base))).ok, true);
  assert.equal(parseProgress(base + ' '.repeat(262145 - Buffer.byteLength(base))).reason, 'the file is 257 KB and the limit is 256 KB.');
});

test('share text: OUT when not mitigated, seed:<n> without a daily number, no trailing newline, two lines', async () => {
  const { shareText } = await js('core/share');
  const t = shareText({ daily: null, seed: 77, scenarioId: 'retry-storm', letters: [], left: 0, budget: 6, timeToMitigate: null, score: 20, optimalTime: 125, harmful: 0, fp: 'deadbeef' });
  assert.equal(t, 'incident-sim seed:77 retry-storm  []  0/6 pager  OUT\nscore 20  optimal 02:05  harmful 0  fp deadbeef');
});

test('hex8 and fnv1a32 work on UTF-8 bytes and canonicalJson ignores key order', async () => {
  const { fnv1a32, hex8, canonicalJson } = await js('engine/hash');
  assert.equal(hex8(fnv1a32('\u{1F600}')), hex8(fnv1a32(Buffer.from('\u{1F600}', 'utf8').toString('utf8'))));
  let h = 0x811c9dc5;
  for (const b of Buffer.from('€', 'utf8')) h = Math.imul(h ^ b, 16777619) >>> 0;
  assert.equal(fnv1a32('€'), h);
  assert.equal(hex8(0xab), '000000ab');
  assert.equal(canonicalJson({ b: [1, { d: 1, c: 2 }], a: 0 }), canonicalJson({ a: 0, b: [1, { c: 2, d: 1 }] }));
});

test('guide allow-list: a trailing slash or an extra query is not an allowed guide, and V9 and V10 messages differ', async () => {
  const { isAllowedGuide } = await js('engine/guides');
  const { validate } = await js('engine/validate');
  assert.equal(isAllowedGuide('https://bytebytego.com/guides/resiliency-patterns'), true);
  assert.equal(isAllowedGuide('https://bytebytego.com/guides/resiliency-patterns/'), false);
  assert.equal(isAllowedGuide('https://bytebytego.com/guides/resiliency-patterns?a=1'), false);
  const bad = (url) => { const o = scenarioRaw('cache-stampede'); o.guideUrl = url; return validate(o, 'cache-stampede.json').errors.find((e) => e.field === 'guideUrl').message; };
  assert.equal(bad('https://bytebytego.com/guides/resiliency-patterns/'), '"https://bytebytego.com/guides/resiliency-patterns/" is not in the guide allow-list. Expected: one of the URLs in public/js/engine/guides.js.');
  assert.equal(bad('http://bytebytego.com/guides/resiliency-patterns'), '"http://bytebytego.com/guides/resiliency-patterns" is not allowed. Expected: a URL starting with https://bytebytego.com/guides/.');
});

test('validator text limits: title 300 ok and 301 not, a 5,000-char unbroken log text and a literal <script> are fine, numbers are never echoed', async () => {
  const { validate } = await js('engine/validate');
  const check = (mutate) => { const o = scenarioRaw('cache-stampede'); mutate(o); return validate(o, 'cache-stampede.json'); };
  assert.equal(check((o) => { o.title = 'a'.repeat(300); }).ok, true);
  assert.equal(check((o) => { o.title = 'a'.repeat(301); }).ok, false);
  assert.equal(check((o) => { o.logs.push({ node: 'cache', level: 'info', text: 'x'.repeat(5000) }); }).ok, true);
  assert.equal(check((o) => { o.logs.push({ node: 'cache', level: 'info', text: '<script>alert(1)</script>' }); }).ok, true);
  const r = check((o) => { o.budget = 4242424; });
  assert.ok(r.errors.every((e) => !e.message.includes('4242424')));
});

test('ramp timing: a ramped effect reaches its final value exactly r ticks after the action tick', async () => {
  const { createRun, step } = await js('engine/engine');
  const { validate } = await js('engine/validate');
  const raw = scenarioRaw('cache-stampede');
  raw.actions['add-ttl-jitter'] = { cost: 1, effects: { cache: [{ path: 'node:cache.capFactor', op: 'set', value: 3, ramp: 5 }] } };
  const v = validate(raw, 'cache-stampede.json');
  assert.ok(v.ok);
  let s = createRun(v.scenario, 1);
  const start = s.params.cache.capFactor;
  s = step(s, [{ id: 'add-ttl-jitter', node: 'cache' }]);
  const seen = [s.params.cache.capFactor];
  for (let i = 0; i < 6; i++) { s = step(s, []); seen.push(s.params.cache.capFactor); }
  assert.ok(Math.abs(seen[0] - (start + (3 - start) / 5)) < 1e-9, 'one fifth of the way after one tick');
  assert.ok(seen[3] < 3 && Math.abs(seen[4] - 3) < 1e-9 && Math.abs(seen[5] - 3) < 1e-9, 'final value at tick T+5, not before');
});

test('series and snapshots have one entry per tick including tick 0', async () => {
  const { s } = await run('expiring-certificate', 1, [], 20);
  for (const k of ['p99', 'errors', 'saturation', 'queue', 'cache-hit']) assert.equal(s.series[k].length, 21, k);
  const { replay } = await js('engine/replay');
  const sc = await loadSc('expiring-certificate');
  const r = replay(sc, 1, [{ t: 5, id: 'trace-request', node: null }, { t: 99999, id: 'trace-request', node: null }]);
  assert.equal(r.snapshots[0].tick, 0);
  assert.equal(r.snapshots.length, r.final.tick + 1);
  assert.equal(r.dropped, 1);
});

test('cascading-failure: a no-action run is out-of-budget by maxTicks + 10 and the series never exceeds 611 entries', async () => {
  const { s, sc } = await run('cascading-failure', 1);
  assert.equal(s.status, 'out-of-budget');
  assert.ok(s.tick <= sc.maxTicks + 10);
  assert.ok(s.series.p99.length <= 611);
});

test('testmode.parse: speed 3 falls back to 1, fail-at 601 is null, and the flag false ignores every parameter', async () => {
  const { parse } = await js('core/testmode');
  assert.equal(parse(true, '?speed=3').speed, 1);
  assert.equal(parse(true, '?fail-at=601').failAt, null);
  assert.equal(parse(true, '?fail-at=600').failAt, 600);
  assert.deepEqual({ ...parse(false, '?speed=64&pause-at=5&fail-at=5') }, { active: false, speed: 1, paused: false, pauseAt: null, failAt: null });
  const { dueTicks } = await js('core/scheduler-math');
  assert.equal(dueTicks({ elapsedMs: 600000, speed: 128, ticksRun: 0 }), 64);
  assert.equal(dueTicks({ elapsedMs: 999, speed: 2, ticksRun: 0 }), 1);
  assert.equal(dueTicks({ elapsedMs: 1999, speed: 2, ticksRun: 0 }), 2, 'capped at the speed per call');
});

test('server: bad Host beats a bad method, cross-site is checked after the method, HEAD 404 has headers and no body', () => withServer(async (s) => {
  const hostFirst = await s.call('POST', '/nope', { host: 'evil.test', headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(hostFirst.status, 403);
  assert.equal(hostFirst.text, 'This host name is not allowed.');
  const post = await s.call('POST', '/', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
  const cross = await s.call('GET', '/', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(cross.status, 403);
  assert.equal(cross.text, 'This request is not allowed.');
  const head = await s.call('HEAD', '/nope');
  assert.equal(head.status, 404);
  assert.equal(head.text, '');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.equal(head.headers[k], v, k);
}));

test('server: nothing is decoded or joined, so encoded and dotted paths are 404, and a query never changes the shell', () => withServer(async (s) => {
  for (const p of ['/js/engine/%70rng.js', '/%2e%2e/', '/js/../src/server.js', '/scenarios/../package.json', '/APP.CSS', '/js/engine/', '/src/server.js', '/test-mode.json']) {
    const r = await s.call('GET', p);
    assert.equal(r.status, 404, p);
    assert.equal(r.text, 'Not found.', p);
  }
  const shell = await s.call('GET', '/');
  assert.equal((await s.call('GET', '/?speed=16')).text, shell.text);
  assert.equal((await s.call('GET', '/scenarios/index.json')).headers['cache-control'], 'no-store');
  assert.equal((await s.call('GET', '/app.css')).headers['cache-control'], 'no-cache');
  const raw = await rawExchange(s, 'GARBAGE\r\n\r\n', 500);
  assert.equal(typeof raw, 'string');
  assert.equal((await s.call('GET', '/')).status, 200);
}));

test('server: test mode exists only with INCIDENT_SIM_TEST=1 exactly', async () => {
  for (const v of [undefined, '0', 'true', '01']) {
    await withServer(async (s) => { assert.equal((await s.call('GET', '/test-mode.json')).status, 404, String(v)); }, { env: { INCIDENT_SIM_TEST: v } });
  }
  await withServer(async (s) => { assert.deepEqual((await s.call('GET', '/test-mode.json')).body, { testMode: true }); }, { test: true });
});

test('server: HOST=0.0.0.0 and a bad PORT exit 1 with the exact messages on stderr', async () => {
  const h = await runToExit({ env: { HOST: '0.0.0.0' } });
  assert.equal(h.code, 1);
  assert.ok(h.stderr.includes('HOST must be a loopback address; exposing incident-sim needs a security review'));
  const p = await runToExit({ env: { PORT: '70000' } });
  assert.equal(p.code, 1);
  assert.ok(p.stderr.includes('PORT must be an integer from 0 to 65535'));
});

test('loader: symlinked and upper-case scenario files are errors on field (file), and one valid file prints "Loaded 1 scenario."', async () => {
  const d = helpers.scenarioDir({
    'one.json': helpers.variantJson('cache-stampede', 'one'), 'Upper.json': helpers.variantJson('cache-stampede', 'Upper'),
    'link.json': { symlink: here('scenarios', 'cache-stampede.json') },
  });
  try {
    const s = await startServer({ scenariosDir: d.dir });
    try {
      assert.match(s.logs().stdout, /^Loaded 1 scenario\.$/m);
      const idx = (await s.call('GET', '/scenarios/index.json')).body;
      assert.deepEqual(idx.valid, ['one']);
      assert.deepEqual(idx.errors.map((e) => [e.file, e.field]).sort(), [['Upper.json', '(file)'], ['link.json', '(file)']]);
    } finally { await s.stop(); }
  } finally { d.cleanup(); }
});
