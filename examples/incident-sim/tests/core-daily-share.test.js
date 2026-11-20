// core/daily.js and core/share.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daily, FIRST_DATE, LAST_DATE } from '../public/js/core/daily.js';
import { shareText, letterOf, MAX_LETTERS } from '../public/js/core/share.js';

const IDS = ['cache-stampede', 'thundering-herd', 'retry-storm', 'hot-partition', 'queue-backlog', 'n-plus-one', 'connection-pool-exhaustion', 'expiring-certificate', 'split-brain', 'cascading-failure'];

test('daily matches the pinned vectors', () => {
  assert.deepEqual(daily('2026-11-19', IDS), { date: '2026-11-19', number: 323, scenarioId: 'split-brain', seed: 1775642406 });
  assert.deepEqual(daily('2026-01-01', IDS), { date: '2026-01-01', number: 1, scenarioId: 'split-brain', seed: 205601972 });
  assert.deepEqual(daily('2026-12-31', IDS), { date: '2026-12-31', number: 365, scenarioId: 'thundering-herd', seed: 3131713203 });
});

test('daily day numbers cross month and year boundaries, including leap years', () => {
  assert.equal(daily('2026-02-01', IDS).number, 32);
  assert.equal(daily('2026-03-01', IDS).number, 60);
  assert.equal(daily('2027-01-01', IDS).number, 366);
  assert.equal(daily('2028-02-29', IDS).number, 790);
  assert.equal(daily('2028-03-01', IDS).number, 790 + 1);
  assert.equal(daily('2029-01-01', IDS).number, 365 * 2 + 366 + 1);
  assert.equal(daily('2099-12-31', IDS).number, 26 * 0 + (Date.UTC(2099, 11, 31) - Date.UTC(2026, 0, 1)) / 86400000 + 1);
  assert.equal(FIRST_DATE, '2026-01-01');
  assert.equal(LAST_DATE, '2099-12-31');
});

test('daily century leap rules: 2100 is out of range, 2096 is a leap year', () => {
  assert.doesNotThrow(() => daily('2096-02-29', IDS));
  assert.throws(() => daily('2100-02-29', IDS), RangeError);
  assert.throws(() => daily('2027-02-29', IDS), RangeError);
});

test('daily rejects bad dates with RangeError', () => {
  for (const d of ['2025-12-31', '2100-01-01', '2026-02-30', '2026-13-01', '2026-00-10', '2026-01-00', '2026-04-31', '2026-1-1', ' 2026-01-01', '2026-01-01x', '', 'today']) {
    assert.throws(() => daily(d, IDS), RangeError, JSON.stringify(d));
  }
  for (const d of [null, undefined, 20260101, {}, ['2026-01-01']]) assert.throws(() => daily(d, IDS), RangeError);
});

test('daily ignores id order and duplicates, handles empty and single lists, accepts a Set', () => {
  const a = daily('2026-11-19', IDS);
  assert.deepEqual(daily('2026-11-19', [...IDS].reverse()), a);
  assert.deepEqual(daily('2026-11-19', [...IDS, ...IDS]), a);
  assert.deepEqual(daily('2026-11-19', new Set(IDS)), a);
  assert.equal(daily('2026-11-19', []).scenarioId, null);
  assert.equal(daily('2026-11-19', undefined).scenarioId, null);
  assert.equal(daily('2026-11-19', ['solo']).scenarioId, 'solo');
});

const base = { daily: 323, seed: 1775642406, scenarioId: 'cache-stampede', letters: ['D', 'F'], left: 4, budget: 6, timeToMitigate: 41, score: 87, optimalTime: 35, harmful: 0, fp: '9c41ab07' };

test('shareText reproduces the example and the OUT and seed forms', () => {
  assert.equal(shareText(base), 'incident-sim #323 cache-stampede  [D F]  4/6 pager  00:41\nscore 87  optimal 00:35  harmful 0  fp 9c41ab07');
  assert.equal(shareText({ ...base, daily: null, seed: 42, letters: [], left: 0, timeToMitigate: null, score: 20 }),
    'incident-sim seed:42 cache-stampede  []  0/6 pager  OUT\nscore 20  optimal 00:35  harmful 0  fp 9c41ab07');
  assert.match(shareText({ ...base, daily: 0 }), /^incident-sim #0 /);
  assert.match(shareText({ ...base, daily: undefined, seed: 7 }), /^incident-sim seed:7 /);
  assert.match(shareText({ ...base, timeToMitigate: undefined }), / OUT\n/);
});

test('shareText keeps at most 12 valid letters and drops unknown ones', () => {
  const t = shareText({ ...base, letters: ['D', 'q', 'F', 'x', '.', '<b>', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F'] });
  assert.ok(t.startsWith('incident-sim #323 cache-stampede  [D F x . F F F F F F F F]  '));
  assert.equal(MAX_LETTERS, 12);
  assert.ok(shareText({ ...base, letters: 'DF' }).includes('[]'));
});

test('shareText rejects unsafe ids and fingerprints', () => {
  assert.throws(() => shareText({ ...base, scenarioId: 'Bad Id' }), RangeError);
  assert.throws(() => shareText({ ...base, scenarioId: 5 }), RangeError);
  assert.throws(() => shareText({ ...base, scenarioId: 'a'.repeat(41) }), RangeError);
  assert.throws(() => shareText({ ...base, fp: 'ZZZZZZZZ' }), RangeError);
  assert.throws(() => shareText({ ...base, fp: '9c41ab0' }), RangeError);
  assert.throws(() => shareText({ ...base, fp: undefined }), RangeError);
});

test('shareText coerces bad numbers to 0 and stays within 160 characters at the extremes', () => {
  const t = shareText({ ...base, seed: NaN, daily: null, left: -1, budget: undefined, score: 1e9, harmful: NaN });
  assert.ok(t.includes('seed:0 '));
  assert.ok(t.includes('0/0 pager'));
  const big = shareText({ ...base, daily: null, seed: 4294967295, scenarioId: 'connection-pool-exhaustion', letters: Array(12).fill('x'), left: 12, budget: 12, timeToMitigate: 610, optimalTime: 610, harmful: 12, score: 100 });
  assert.ok(big.length <= 160, String(big.length));
  assert.equal(big.split('\n').length, 2);
});

test('letterOf maps history effects to share letters', () => {
  assert.equal(letterOf('diagnostic'), 'D');
  assert.equal(letterOf('helpful'), 'F');
  assert.equal(letterOf('harmful'), 'x');
  assert.equal(letterOf('none'), '.');
  assert.equal(letterOf(null), '.');
  assert.equal(letterOf('constructor'), '.');
});
