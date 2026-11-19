'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fnv1a, mulberry32, forecast, weatherGreeting, normalizePlace, utcDate, CONDITIONS } = require('../src/weather');
const { render } = require('../src/greetings');

test('fnv1a matches published FNV-1a 32-bit vectors', () => {
  assert.equal(fnv1a(''), 2166136261);
  assert.equal(fnv1a('a'), 0xe40c292c);
  assert.equal(fnv1a('foobar'), 0xbf9cf968);
});

test('fnv1a hashes the UTF-8 bytes of non-ASCII input', () => {
  const ref = (bytes) => bytes.reduce((h, b) => Math.imul(h ^ b, 16777619) >>> 0, 2166136261);
  assert.equal(fnv1a('é'), ref([0xc3, 0xa9]));
  assert.equal(fnv1a('😀'), ref([0xf0, 0x9f, 0x98, 0x80]));
  assert.notEqual(fnv1a('é'), fnv1a('e'));
  assert.equal(fnv1a('日本'), fnv1a('日本'));
  assert.ok(Number.isInteger(fnv1a('😀')) && fnv1a('😀') >= 0 && fnv1a('😀') <= 0xffffffff);
});

test('mulberry32 golden values are pinned and the stream is repeatable', () => {
  const r = mulberry32(1);
  assert.deepEqual([r(), r(), r()], [0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  const a = mulberry32(123456789);
  assert.deepEqual([a(), a()], [0.2577907438389957, 0.9707721115555614]);
  const x = mulberry32(42); const y = mulberry32(42);
  for (let i = 0; i < 20; i += 1) assert.equal(x(), y());
  for (let i = 0; i < 1000; i += 1) { const v = x(); assert.ok(v >= 0 && v < 1); }
});

test('forecast is deterministic and pinned for a known input', () => {
  const a = forecast({ date: '2026-11-18', place: 'Lisbon' });
  assert.deepEqual(a, forecast({ date: '2026-11-18', place: 'Lisbon' }));
  assert.deepEqual(a, {
    date: '2026-11-18', place: 'Lisbon', seed: fnv1a('2026-11-18|lisbon'), condition: 'fog lifting to reveal smiles',
    tempC: 25, windKph: 33, chanceOfWarmRegards: 52, warmthIndex: 6,
    forecast: '52% chance of warm regards in Lisbon, with fog lifting to reveal smiles.', simulated: true,
  });
});

test('forecast: case and whitespace of the place do not change the seed, but the echoed case is kept', () => {
  const a = forecast({ date: '2026-11-18', place: 'Lisbon' });
  const b = forecast({ date: '2026-11-18', place: '  LISBON ' });
  assert.equal(b.seed, a.seed);
  assert.equal(b.place, 'LISBON');
  assert.equal(forecast({ date: '2026-11-18', place: 'New   York' }).place, 'New York');
  assert.equal(forecast({ date: '2026-11-18', place: 'New   York' }).seed, forecast({ date: '2026-11-18', place: 'new york' }).seed);
});

test('forecast: a different date or place changes the seed', () => {
  const base = forecast({ date: '2026-11-18', place: 'Lisbon' });
  assert.notEqual(forecast({ date: '2026-11-19', place: 'Lisbon' }).seed, base.seed);
  assert.notEqual(forecast({ date: '2026-11-18', place: 'Porto' }).seed, base.seed);
});

test('forecast: every output stays in range for 1000 pseudo-random (date, place) pairs', () => {
  const rnd = mulberry32(7);
  const seenConditions = new Set();
  for (let i = 0; i < 1000; i += 1) {
    const date = `20${String(20 + Math.floor(rnd() * 10))}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
    const place = `place-${Math.floor(rnd() * 1e6)}`;
    const f = forecast({ date, place });
    assert.ok(CONDITIONS.includes(f.condition));
    seenConditions.add(f.condition);
    assert.ok(Number.isInteger(f.tempC) && f.tempC >= -5 && f.tempC <= 35, `tempC ${f.tempC}`);
    assert.ok(Number.isInteger(f.windKph) && f.windKph >= 0 && f.windKph <= 60, `wind ${f.windKph}`);
    assert.ok(Number.isInteger(f.chanceOfWarmRegards) && f.chanceOfWarmRegards >= 0 && f.chanceOfWarmRegards <= 100);
    assert.ok(Number.isInteger(f.warmthIndex) && f.warmthIndex >= 1 && f.warmthIndex <= 10);
    assert.equal(f.simulated, true);
    assert.equal(f.forecast, `${f.chanceOfWarmRegards}% chance of warm regards in ${place}, with ${f.condition}.`);
  }
  assert.equal(CONDITIONS.length, 8);
  assert.equal(seenConditions.size, 8);
});

test('forecast throws on invalid place or date', () => {
  assert.throws(() => forecast({ date: '2026-11-18', place: '' }), RangeError);
  assert.throws(() => forecast({ date: '2026-11-18', place: 'a\u0000b' }), RangeError);
  assert.throws(() => forecast({ date: 'nope', place: 'x' }), RangeError);
  assert.throws(() => forecast({ place: 'x' }), RangeError);
});

test('normalizePlace: default, trimming, collapsing, and bounds', () => {
  assert.deepEqual(normalizePlace(undefined), { place: 'anywhere', key: 'anywhere' });
  assert.deepEqual(normalizePlace('  São   Paulo '), { place: 'São Paulo', key: 'são paulo' });
  assert.equal(normalizePlace('é').place, 'é');
  assert.notEqual(normalizePlace('x'.repeat(40)), null);
  assert.notEqual(normalizePlace('😀'.repeat(40)), null);
  for (const bad of ['', '   ', 'x'.repeat(41), 'a​b', null, 5, {}, []]) assert.equal(normalizePlace(bad), null, JSON.stringify(bad));
});

test('utcDate formats the UTC day, not the local day', () => {
  assert.equal(utcDate(Date.UTC(2026, 10, 18, 23, 59, 59)), '2026-11-18');
  assert.equal(utcDate(Date.UTC(2026, 10, 19, 0, 0, 0)), '2026-11-19');
  assert.equal(utcDate(Date.UTC(2024, 1, 29, 12)), '2024-02-29');
});

test('weatherGreeting appends exactly one "Today:" sentence to the v1 greeting', () => {
  const f = forecast({ date: '2026-11-18', place: 'Lisbon' });
  const base = render('en', 'formal', 'Ada');
  const g = weatherGreeting({ forecast: f, greeting: base });
  assert.equal(g, `${base} Today: ${f.forecast}`);
  assert.equal(g.split('Today:').length, 2);
});

test('normalizePlace collapses tabs, newlines and runs of spaces but still rejects other control characters', () => {
  const { normalizePlace } = require('../src/weather.js');
  assert.deepEqual(normalizePlace('\tnew\n york '), { place: 'new york', key: 'new york' });
  assert.deepEqual(normalizePlace('New    York'), { place: 'New York', key: 'new york' });
  assert.equal(normalizePlace('a\u0000b'), null);
  assert.equal(normalizePlace('a​b'), null);
  assert.equal(normalizePlace(' \t\n '), null);
});
