import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../src/search.js';

const entry = (title, content, mtimeMs = 1000) => ({
  title, key: title.toLowerCase(), mtimeMs, content, lower: content.toLowerCase().length === content.length ? content.toLowerCase() : null,
});
const run = (entries, q) => search(entries, q);

test('empty query returns nothing and echoes an empty query', () => {
  assert.deepEqual(run([entry('A', 'x')], '   '), { query: '', total: 0, results: [] });
});

test('matches titles and bodies case-insensitively and echoes the trimmed query', () => {
  const r = run([entry('Alpha', 'nothing'), entry('Beta', 'has NEEDLE inside')], ' NeEdLe ');
  assert.equal(r.query, 'NeEdLe');
  assert.deepEqual(r.results.map((x) => x.title), ['Beta']);
  assert.equal(r.total, 1);
  assert.equal(r.results[0].titleMatch, false);
  assert.equal(r.results[0].modified, '1970-01-01T00:00:01.000Z');
  assert.deepEqual(r.results[0].ranges, [[4, 10]]);
  assert.equal(r.results[0].snippet, 'has NEEDLE inside');
});

test('title matches sort first, then modified descending, then key', () => {
  const r = run([
    entry('b', 'q', 5), entry('a', 'q', 5), entry('c', 'q', 9), entry('q title', 'x', 1),
  ], 'q');
  assert.deepEqual(r.results.map((x) => x.title), ['q title', 'c', 'a', 'b']);
  assert.deepEqual(r.results.map((x) => x.titleMatch), [true, false, false, false]);
});

test('long bodies get a 120-unit window with ellipses and prefix-aware ranges', () => {
  const body = `${'x'.repeat(200)}needle${'y'.repeat(200)}`;
  const [r] = run([entry('G', body)], 'needle').results;
  assert.equal(r.snippet, `...${body.slice(200 - 57, 200 - 57 + 120)}...`);
  assert.deepEqual(r.ranges, [[60, 66]]);
  const near = run([entry('N', `needle${'y'.repeat(300)}`)], 'needle').results[0];
  assert.equal(near.snippet.startsWith('needle'), true);
  assert.equal(near.snippet.endsWith('...'), true);
  assert.deepEqual(near.ranges, [[0, 6]]);
});

test('a match near the end has a prefix but no suffix', () => {
  const body = `${'y'.repeat(300)}needle`;
  const [r] = run([entry('E', body)], 'needle').results;
  assert.equal(r.snippet.startsWith('...'), true);
  assert.equal(r.snippet.endsWith('needle'), true);
  assert.equal(r.snippet.length, 123);
});

test('ranges list every non-overlapping match inside the window', () => {
  const [r] = run([entry('R', 'aaaa')], 'aa').results;
  assert.deepEqual(r.ranges, [[0, 2], [2, 4]]);
});

test('title-only matches show the start of the body and no ranges', () => {
  const [r] = run([entry('Needle', 'z'.repeat(300))], 'needle').results;
  assert.equal(r.snippet, `${'z'.repeat(120)}...`);
  assert.deepEqual(r.ranges, []);
  assert.equal(run([entry('Needle', 'short')], 'needle').results[0].snippet, 'short');
});

test('a title and body match uses the body window', () => {
  const [r] = run([entry('Needle', 'a needle b')], 'needle').results;
  assert.equal(r.titleMatch, true);
  assert.deepEqual(r.ranges, [[2, 8]]);
});

test('matching is literal, not a regular expression', () => {
  const entries = [entry('A', 'abc a.c (x) [y]')];
  assert.equal(run(entries, 'a.c').results[0].ranges.length, 1);
  assert.deepEqual(run(entries, 'a.c').results[0].ranges, [[4, 7]]);
  assert.equal(run(entries, '(').total, 1);
  assert.equal(run(entries, '.*').total, 0);
});

test('bodies whose lower-casing changes the length still match', () => {
  const body = 'before İ stanbul i̇x after';
  const e = entry('T', body);
  assert.equal(e.lower, null);
  const r = run([e], 'stanbul');
  assert.equal(r.total, 1);
  const [s, en] = r.results[0].ranges[0];
  assert.equal(r.results[0].snippet.slice(s, en), 'stanbul');
});

test('windows never split a surrogate pair', () => {
  const body = `${'\u{1F600}'.repeat(100)}needle${'\u{1F600}'.repeat(100)}`;
  const [r] = run([entry('S', body)], 'needle').results;
  const text = r.snippet.replace(/^\.\.\./, '').replace(/\.\.\.$/, '');
  assert.doesNotMatch(text, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
  assert.equal(text.length <= 120, true);
  assert.equal(r.snippet.slice(r.ranges[0][0], r.ranges[0][1]), 'needle');
});

test('big notes have empty content, so only the title can match', () => {
  const big = { ...entry('Huge', ''), big: true };
  assert.deepEqual(run([big], 'huge').results[0].snippet, '');
  assert.equal(run([big], 'anything').total, 0);
});
