// core/daily.js, core/share.js, core/testmode.js, core/routes.js, core/format.js and import hygiene of every core module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mod, SHIPPED_IDS } from './helpers.js';

const IDS = [...SHIPPED_IDS];

// ------------------------------------------------------------------ daily
test('daily vectors: 2026-11-19 is #323 split-brain seed 1775642406', async () => {
  const { daily } = await mod('core/daily');
  assert.deepEqual({ ...daily('2026-11-19', IDS) }, { date: '2026-11-19', number: 323, scenarioId: 'split-brain', seed: 1775642406 });
});

test('daily vectors: 2026-01-01 is #1 split-brain seed 205601972; 2026-12-31 is #365 thundering-herd seed 3131713203', async () => {
  const { daily } = await mod('core/daily');
  assert.deepEqual({ ...daily('2026-01-01', IDS) }, { date: '2026-01-01', number: 1, scenarioId: 'split-brain', seed: 205601972 });
  assert.deepEqual({ ...daily('2026-12-31', IDS) }, { date: '2026-12-31', number: 365, scenarioId: 'thundering-herd', seed: 3131713203 });
});

test('daily follows the pinned formulas for number, scenario pick and seed on many dates', async () => {
  const { daily } = await mod('core/daily');
  const { fnv1a32 } = await mod('engine/hash');
  const sorted = [...IDS].sort();
  for (const date of ['2026-02-28', '2026-03-01', '2027-01-01', '2028-02-29', '2030-07-04', '2099-12-31', '2026-06-15']) {
    const [y, m, d] = date.split('-').map(Number);
    const d0 = daily(date, IDS);
    assert.equal(d0.date, date);
    assert.equal(d0.number, (Date.UTC(y, m - 1, d) - Date.UTC(2026, 0, 1)) / 86400000 + 1, date);
    assert.equal(d0.scenarioId, sorted[fnv1a32(`daily:${date}`) % sorted.length], date);
    assert.equal(d0.seed, fnv1a32(`daily-seed:${date}`), date);
  }
  assert.equal(daily('2027-01-01', IDS).number, 366);
});

test('daily sorts ids by code unit, drops duplicates and ignores input order; empty list gives scenarioId null; one id is always picked', async () => {
  const { daily } = await mod('core/daily');
  const a = daily('2026-11-19', [...IDS].reverse());
  assert.deepEqual({ ...a }, { ...daily('2026-11-19', IDS) });
  assert.deepEqual({ ...daily('2026-11-19', [...IDS, ...IDS]) }, { ...daily('2026-11-19', IDS) });
  assert.equal(daily('2026-11-19', []).scenarioId, null);
  assert.equal(daily('2026-11-19', ['only-one']).scenarioId, 'only-one');
  const sorted = ['B', 'a', 'a-b'];
  assert.ok(sorted.includes(daily('2026-11-19', ['a', 'B', 'a-b', 'a']).scenarioId));
});

test('daily throws RangeError for malformed, impossible and out-of-range dates', async () => {
  const { daily } = await mod('core/daily');
  const bad = ['2025-12-31', '2100-01-01', '2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2027-02-29', '2026-1-1', ' 2026-01-01', '2026-01-01 ', '2026-01-01x', '20260101',
    '2026/01/01', '', 'today', '2026-01-32', '1999-01-01'];
  for (const d of bad) assert.throws(() => daily(d, IDS), RangeError, JSON.stringify(d));
  for (const d of [null, undefined, 20260101, {}, ['2026-01-01']]) assert.throws(() => daily(d, IDS));
  assert.doesNotThrow(() => daily('2028-02-29', IDS));
  assert.doesNotThrow(() => daily('2026-01-01', IDS));
  assert.doesNotThrow(() => daily('2099-12-31', IDS));
});

// ------------------------------------------------------------------ share
const share = { daily: 323, seed: 1775642406, scenarioId: 'cache-stampede', letters: ['D', 'F'], left: 4, budget: 6, timeToMitigate: 41, score: 87, optimalTime: 35, harmful: 0, fp: '9c41ab07' };
const L1 = /^incident-sim (#\d+|seed:\d+) [a-z0-9-]+  \[[DFx. ]*\]  \d+\/\d+ pager  (\d{2}:\d{2}|OUT)$/;
const L2 = /^score \d+  optimal \d{2}:\d{2}  harmful \d+  fp [0-9a-f]{8}$/;

test('shareText reproduces the spec example exactly', async () => {
  const { shareText } = await mod('core/share');
  assert.equal(shareText(share), 'incident-sim #323 cache-stampede  [D F]  4/6 pager  00:41\nscore 87  optimal 00:35  harmful 0  fp 9c41ab07');
});

test('shareText uses seed:<n> when daily is null, [] with no letters and OUT when not mitigated', async () => {
  const { shareText } = await mod('core/share');
  const t = shareText({ ...share, daily: null, seed: 42, letters: [], left: 0, timeToMitigate: null, score: 20 });
  assert.equal(t, 'incident-sim seed:42 cache-stampede  []  0/6 pager  OUT\nscore 20  optimal 00:35  harmful 0  fp 9c41ab07');
});

test('shareText formats mm:ss for the time and the optimal time', async () => {
  const { shareText } = await mod('core/share');
  const line = (o) => shareText({ ...share, ...o }).split('\n');
  assert.match(line({ timeToMitigate: 125 })[0], / 02:05$/);
  assert.match(line({ timeToMitigate: 610 })[0], / 10:10$/);
  assert.match(line({ timeToMitigate: 1 })[0], / 00:01$/);
  assert.match(line({ timeToMitigate: 59 })[0], / 00:59$/);
  assert.match(line({ timeToMitigate: 60 })[0], / 01:00$/);
  assert.match(line({ optimalTime: 600 })[1], /optimal 10:00 /);
  assert.match(line({ optimalTime: 9 })[1], /optimal 00:09 /);
});

test('shareText letters are D, F, x and . separated by single spaces, at most 12', async () => {
  const { shareText } = await mod('core/share');
  const letters = ['D', 'F', 'x', '.', 'F', 'D', 'x', '.', 'F', 'F', 'D', 'x'];
  const t = shareText({ ...share, letters });
  assert.ok(t.split('\n')[0].includes('[D F x . F D x . F F D x]'));
  assert.ok(t.length <= 160);
  assert.match(t.split('\n')[0], L1);
});

test('shareText always matches the two ux regexes, has no trailing newline and stays within 160 characters', async () => {
  const { shareText } = await mod('core/share');
  const cases = [share, { ...share, daily: null, seed: 4294967295, timeToMitigate: null, letters: [] }, { ...share, scenarioId: 'connection-pool-exhaustion', letters: Array(12).fill('x'), harmful: 12, left: 12, budget: 12, score: 100 },
    { ...share, daily: 1, seed: 0, score: 0 }];
  for (const c of cases) {
    const t = shareText(c);
    const lines = t.split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0], L1);
    assert.match(lines[1], L2);
    assert.ok(t.length <= 160, `${t.length} characters`);
    assert.equal(t.endsWith('\n'), false);
    assert.ok(!/http|localhost|\p{Extended_Pictographic}/u.test(t));
  }
});

// ------------------------------------------------------------------ testmode
const DEFAULTS = { active: false, speed: 1, paused: false, pauseAt: null, failAt: null };

test('testmode.parse with the flag false always returns the defaults', async () => {
  const { parse } = await mod('core/testmode');
  for (const q of ['', '?speed=16', '?speed=64&pause-at=60&fail-at=3&paused=1', '?fail-at=0']) assert.deepEqual({ ...parse(false, q) }, DEFAULTS, q);
});

test('testmode.parse accepts speeds 1,2,4,8,16,32,64 and falls back to 1 for anything else', async () => {
  const { parse } = await mod('core/testmode');
  for (const s of [1, 2, 4, 8, 16, 32, 64]) assert.equal(parse(true, `?speed=${s}`).speed, s);
  for (const s of ['3', '0', '128', '1.5', 'abc', '', '-2', '16x', '0x10', '010']) assert.equal(parse(true, `?speed=${s}`).speed, 1, s);
  assert.equal(parse(true, '').speed, 1);
  assert.equal(parse(true, '?speed=16').active, true);
  assert.equal(parse(true, '?speed=16').paused, false);
});

test('testmode.parse pause-at and fail-at are integers 0..600, otherwise null', async () => {
  const { parse } = await mod('core/testmode');
  for (const v of [0, 1, 60, 600]) {
    assert.equal(parse(true, `?pause-at=${v}`).pauseAt, v);
    assert.equal(parse(true, `?fail-at=${v}`).failAt, v);
  }
  for (const v of ['601', '-1', '1.5', 'x', '', '1e2', '99999']) {
    assert.equal(parse(true, `?pause-at=${v}`).pauseAt, null, v);
    assert.equal(parse(true, `?fail-at=${v}`).failAt, null, v);
  }
  const both = parse(true, '?speed=8&pause-at=60&fail-at=12');
  assert.deepEqual({ speed: both.speed, pauseAt: both.pauseAt, failAt: both.failAt }, { speed: 8, pauseAt: 60, failAt: 12 });
});

// ------------------------------------------------------------------ routes
test('parseRoute names the pinned routes', async () => {
  const { parseRoute } = await mod('core/routes');
  assert.equal(parseRoute('#/').name, 'first');
  assert.equal(parseRoute('#/incidents').name, 'board');
  assert.equal(parseRoute('#/data').name, 'data');
  assert.equal(parseRoute('#/about').name, 'about');
  const play = parseRoute('#/play/cache-stampede');
  assert.equal(play.name, 'play');
  assert.equal(play.id, 'cache-stampede');
  const deb = parseRoute('#/debrief/retry-storm');
  assert.equal(deb.name, 'debrief');
  assert.equal(deb.id, 'retry-storm');
  for (const h of ['#/nope', '#/incidents/x/y', '#/play/../etc', '#/play/UPPER']) assert.equal(parseRoute(h).name, 'notfound', h);
});

test('parseRoute reads ?seed= on play routes and flags invalid seeds', async () => {
  const { parseRoute, parseSeed } = await mod('core/routes');
  const ok = parseRoute('#/play/cache-stampede?seed=77');
  assert.equal(ok.name, 'play');
  assert.equal(Number(ok.seed), 77);
  assert.ok(!ok.seedError);
  assert.equal(Number(parseRoute('#/play/cache-stampede?seed=4294967295').seed), 4294967295);
  assert.ok(!parseRoute('#/play/cache-stampede?seed=0').seedError);
  for (const bad of ['4294967296', '-1', 'abc', '1.5', '12345678901', '']) {
    const r = parseRoute(`#/play/cache-stampede?seed=${bad}`);
    assert.ok(r.seedError, `seed=${bad} is flagged`);
    assert.equal(r.id, 'cache-stampede');
  }
  assert.ok(JSON.stringify(parseSeed('77')).includes('77'));
  assert.notEqual(JSON.stringify(parseSeed('77')), JSON.stringify(parseSeed('abc')));
  assert.notEqual(JSON.stringify(parseSeed('4294967295')), JSON.stringify(parseSeed('4294967296')));
});

// ------------------------------------------------------------------ format
test('format.clock, mmss, int and percent follow the pinned shapes', async () => {
  const F = await mod('core/format');
  assert.equal(F.clock(161), 'T+02:41');
  assert.equal(F.clock(0), 'T+00:00');
  assert.equal(F.clock(610), 'T+10:10');
  assert.equal(F.mmss(41), '00:41');
  assert.equal(F.mmss(0), '00:00');
  assert.equal(F.mmss(3599), '59:59');
  assert.equal(F.int(1842), '1,842');
  assert.equal(F.int(999), '999');
  assert.equal(F.percent(0.062), '6.2%');
  assert.equal(typeof F.rate, 'function');
  assert.equal(typeof F.ms, 'function');
});

// ------------------------------------------------------------------ module hygiene
test('every pinned core module imports in Node without a DOM and exports something', async () => {
  const names = ['safe-json', 'progress', 'settings', 'daily', 'share', 'routes', 'testmode', 'keys', 'announcer', 'viewmodel', 'debrief-model', 'layout', 'particles', 'scheduler-math', 'format'];
  assert.equal(names.length, 15);
  for (const n of names) {
    const m = await mod(`core/${n}`);
    assert.ok(Object.keys(m).length >= 1, `core/${n}.js has exports`);
  }
});

test('every pinned engine module imports in Node without a DOM and exports the pinned names', async () => {
  const want = {
    prng: ['next', 'initial'], hash: ['fnv1a32', 'hex8', 'canonicalJson'], catalogue: ['NODE_IDS', 'NODE_TYPES', 'ACTIONS', 'ACTION_IDS', 'FIX_IDS', 'DIAGNOSTIC_IDS', 'DEFAULT_COST', 'PARAMS', 'EDGE_PARAMS', 'EDGE_RULES'],
    guides: ['GUIDES', 'GUIDE_PATTERN', 'isAllowedGuide'], validate: ['validate', 'formatError', 'MAX_FILE_BYTES', 'SCENARIO_KEYS'],
    engine: ['createRun', 'step', 'canApply', 'statusOf', 'metric', 'edgeRps', 'firingAlerts', 'firstNonOk', 'result', 'EngineError', 'THRESHOLDS'],
    model: ['retryAmplification'], classify: ['badness', 'classify', 'historyEffects'], replay: ['replay'], score: ['score'], solver: ['firstPageTick', 'schedule', 'solve'],
    fingerprint: ['scenarioHash', 'fingerprint', 'stateHash'], template: ['formatInt', 'render', 'placeholders'], conditions: ['evaluate', 'MAX_COND_DEPTH', 'MAX_COND_LEAVES'],
  };
  for (const [name, exports] of Object.entries(want)) {
    const m = await mod(`engine/${name}`);
    for (const e of exports) assert.ok(e in m, `engine/${name}.js exports ${e}`);
  }
  const sm = await mod('core/scheduler-math');
  assert.equal(typeof sm.dueTicks, 'function');
});
