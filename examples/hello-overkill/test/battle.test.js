'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickPair, leaderboard } = require('../src/battle');
const { render } = require('../src/greetings');

test('pickPair uses random to choose entries from the pool', () => {
  const p = pickPair(() => 0);
  assert.equal(p.a.id, 'en.formal');
  assert.equal(p.a.greeting, render('en', 'formal', 'World'));
  assert.notEqual(p.b.id, p.a.id);
});

test('pickPair re-rolls when the second pick equals the first', () => {
  const seq = [0, 0, 0.5];
  const p = pickPair(() => (seq.length ? seq.shift() : 0.5));
  assert.equal(p.a.id, 'en.formal');
  assert.notEqual(p.b.id, 'en.formal');
});

test('pickPair is distinct in id and text even with a constant random', () => {
  for (const v of [0, 0.5, 0.999999, 1]) {
    const p = pickPair(() => v);
    assert.notEqual(p.a.id, p.b.id);
    assert.notEqual(p.a.greeting, p.b.greeting);
  }
});

test('leaderboard sorts by votes desc then id asc, ranks from 1, omits zeros', () => {
  const lb = leaderboard(new Map([['fr.pirate', 2], ['en.formal', 2], ['de.formal', 5], ['es.formal', 0]]));
  assert.deepEqual(lb.map((r) => [r.rank, r.id, r.votes]), [[1, 'de.formal', 5], [2, 'en.formal', 2], [3, 'fr.pirate', 2]]);
  assert.equal(lb[0].greeting, render('de', 'formal', 'World'));
});

test('leaderboard is empty for no votes and capped at 10', () => {
  assert.deepEqual(leaderboard(new Map()), []);
  const m = new Map();
  for (const l of ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'sv', 'ja', 'sw']) m.set(`${l}.formal`, 1);
  m.set('en.pirate', 1);
  assert.equal(leaderboard(m).length, 10);
});

test('pickPair falls back to a distinct pair when random keeps returning the same index', () => {
  const p = pickPair(() => 0);
  assert.notEqual(p.a.id, p.b.id);
  assert.notEqual(p.a.greeting, p.b.greeting);
  assert.ok(p.b.id && p.b.greeting);
});

test('pickPair loop retries until a different entry is drawn, then stops', () => {
  const draws = [0, 0, 0, 0.5];
  let i = 0;
  const p = pickPair(() => draws[Math.min(i++, draws.length - 1)]);
  assert.notEqual(p.a.id, p.b.id);
  assert.equal(i, 4);
});

test('pickPair fallback also works for the last index and never returns equal greetings', () => {
  const p = pickPair(() => 0.999999);
  assert.notEqual(p.a.id, p.b.id);
  assert.notEqual(p.a.greeting, p.b.greeting);
});

test('pickPair draws exactly twice when the first two draws are already distinct (no needless re-rolls)', () => {
  const { pickPair } = require('../src/battle.js');
  const draws = [0, 0.5];
  let calls = 0;
  const random = () => { calls += 1; return draws[calls - 1] ?? 0.99; };
  const pair = pickPair(random);
  assert.equal(calls, 2);
  const { CATALOGUE } = require('../src/greetings.js');
  const ids = [...CATALOGUE.keys()];
  // Draws 0 and 0.5 must select exactly entries 0 and 20: a distinct second draw is kept, never replaced by the fallback.
  assert.equal(pair.a.id, ids[0]);
  assert.equal(pair.b.id, ids[Math.floor(0.5 * ids.length)]);
  assert.notEqual(pair.a.greeting, pair.b.greeting);
});

test('pickPair re-rolls only while the second pick collides with the first', () => {
  const { pickPair } = require('../src/battle.js');
  const draws = [0.3, 0.3, 0.3, 0.8];
  let calls = 0;
  const random = () => { calls += 1; return draws[calls - 1] ?? 0.99; };
  const pair = pickPair(random);
  assert.equal(calls, 4);
  assert.notEqual(pair.a.id, pair.b.id);
});

test('every catalogue entry renders to a distinct battle greeting, so equal id and equal text always agree', () => {
  const { CATALOGUE } = require('../src/greetings');
  const texts = [...CATALOGUE.values()].map((e) => render(e.language, e.tone, 'World'));
  assert.equal(new Set(texts).size, texts.length);
});
