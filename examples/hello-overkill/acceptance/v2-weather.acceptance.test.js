'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { withServer, tmpFile, today, addDays, fnv1a, READ_ENV, hello } = require('./helpers-v2');

const W = (s, q = '') => s.call('GET', `/api/weather${q}`);
const enc = encodeURIComponent;

test('weather: 200 with the documented shape and simulated=true', () => withServer(async (s) => {
  const r = await W(s, `?place=Lisbon&date=${today()}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^application\/json; charset=utf-8$/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(r.body).sort(), ['chanceOfWarmRegards', 'condition', 'date', 'forecast', 'greeting', 'place', 'seed', 'simulated', 'tempC', 'warmthIndex', 'windKph']);
  assert.equal(r.body.simulated, true);
  assert.equal(r.body.place, 'Lisbon');
  assert.equal(r.body.date, today());
  assert.equal(typeof r.body.condition, 'string');
  assert.ok(r.body.forecast.includes('Lisbon'));
}, READ_ENV()));

test('weather: defaults to place "anywhere" and today (UTC)', () => withServer(async (s) => {
  const r = await W(s);
  assert.equal(r.status, 200);
  assert.equal(r.body.place, 'anywhere');
  assert.equal(r.body.date, today());
}, READ_ENV()));

test('weather: seed is fnv1a(date|lowercased place)', () => withServer(async (s) => {
  const r = await W(s, `?place=Lisbon&date=${today()}`);
  assert.equal(r.body.seed, fnv1a(`${today()}|lisbon`));
}, READ_ENV()));

test('weather: same (date, place) is deterministic within a server and across restarts', async () => {
  const q = `?place=Oslo&date=${today()}&name=Ada`;
  let first;
  await withServer(async (s) => { first = (await W(s, q)).body; const again = (await W(s, q)).body; assert.deepEqual(again, first); }, READ_ENV());
  await withServer(async (s) => { assert.deepEqual((await W(s, q)).body, first); }, READ_ENV());
});

test('weather: a different place or date changes the seed', () => withServer(async (s) => {
  const a = (await W(s, `?place=Oslo&date=${today()}`)).body;
  const b = (await W(s, `?place=Rome&date=${today()}`)).body;
  const c = (await W(s, `?place=Oslo&date=${addDays(today(), 1)}`)).body;
  assert.notEqual(a.seed, b.seed);
  assert.notEqual(a.seed, c.seed);
}, READ_ENV()));

test('weather: outputs stay inside the documented bounds for many places and dates', () => withServer(async (s) => {
  const conditions = new Set();
  for (let i = 0; i < 60; i += 1) {
    const date = addDays(today(), (i % 3) - 1);
    const r = await W(s, `?place=${enc(`place-${i}`)}&date=${date}`);
    assert.equal(r.status, 200);
    const b = r.body;
    assert.ok(Number.isInteger(b.tempC) && b.tempC >= -5 && b.tempC <= 35, `tempC ${b.tempC}`);
    assert.ok(Number.isInteger(b.windKph) && b.windKph >= 0 && b.windKph <= 60, `windKph ${b.windKph}`);
    assert.ok(Number.isInteger(b.chanceOfWarmRegards) && b.chanceOfWarmRegards >= 0 && b.chanceOfWarmRegards <= 100);
    assert.ok(Number.isInteger(b.warmthIndex) && b.warmthIndex >= 1 && b.warmthIndex <= 10);
    assert.ok(Number.isInteger(b.seed) && b.seed >= 0 && b.seed <= 0xffffffff);
    conditions.add(b.condition);
  }
  assert.ok(conditions.size >= 2 && conditions.size <= 8, `condition variety ${conditions.size}`);
}, READ_ENV()));

test('weather: place normalisation trims, collapses whitespace and hashes case-insensitively but echoes original case', () => withServer(async (s) => {
  const plain = (await W(s, `?place=${enc('new york')}&date=${today()}`)).body;
  const messy = await W(s, `?place=${enc('  New   YORK ')}&date=${today()}`);
  assert.equal(messy.status, 200);
  assert.equal(messy.body.place, 'New YORK');
  assert.equal(messy.body.seed, plain.seed);
  assert.equal(messy.body.tempC, plain.tempC);
  assert.equal(messy.body.condition, plain.condition);
}, READ_ENV()));

test('weather: unicode places work and NFC and NFD spellings give the same seed', () => withServer(async (s) => {
  const nfc = (await W(s, `?place=${enc('São Paulo')}&date=${today()}`)).body;
  const nfd = (await W(s, `?place=${enc('São Paulo')}&date=${today()}`)).body;
  assert.equal(nfc.seed, fnv1a(`${today()}|são paulo`));
  assert.equal(nfd.seed, nfc.seed);
}, READ_ENV()));

test('weather: a 40-character place is accepted, 41 and control characters are 400', () => withServer(async (s) => {
  assert.equal((await W(s, `?place=${'a'.repeat(40)}`)).status, 200);
  for (const p of ['a'.repeat(41), 'bad\u0007place', 'zero​width']) {
    const r = await W(s, `?place=${enc(p)}`);
    assert.equal(r.status, 400, JSON.stringify(p));
    assert.deepEqual(r.body, { error: 'place must be 1-40 characters' });
  }
}, READ_ENV()));

test('weather: dates within today-1..today+1 are accepted', () => withServer(async (s) => {
  for (const d of [addDays(today(), -1), today(), addDays(today(), 1)]) {
    const r = await W(s, `?date=${d}`);
    assert.equal(r.status, 200, d);
    assert.equal(r.body.date, d);
  }
}, READ_ENV()));

test('weather: dates outside the window or not real are 400', () => withServer(async (s) => {
  for (const d of [addDays(today(), -2), addDays(today(), 2), '1999-01-01']) {
    const r = await W(s, `?date=${d}`);
    assert.equal(r.status, 400, d);
    assert.deepEqual(r.body, { error: 'date out of range' });
  }
  for (const d of ['garbage', '2026-02-30', '2026-13-01', '20260101']) {
    const r = await W(s, `?date=${d}`);
    assert.equal(r.status, 400, d);
    assert.equal(typeof r.body.error, 'string');
  }
}, READ_ENV()));

test('weather: with a name the greeting is the v1 greeting plus "Today: <forecast>"', () => withServer(async (s) => {
  const v1 = (await hello(s, { name: 'Ada' })).body.greeting;
  const r = await W(s, '?name=Ada');
  assert.equal(r.status, 200);
  assert.ok(r.body.greeting.startsWith(v1), r.body.greeting);
  assert.ok(r.body.greeting.endsWith(`Today: ${r.body.forecast}`), r.body.greeting);
}, READ_ENV()));

test('weather: without a name the greeting is rendered for World', () => withServer(async (s) => {
  const r = await W(s);
  assert.ok(r.body.greeting.includes('World'));
  assert.ok(r.body.greeting.endsWith(`Today: ${r.body.forecast}`));
}, READ_ENV()));

test('weather: language and tone are honoured and validated', () => withServer(async (s) => {
  const en = (await W(s, '?name=Ada')).body.greeting;
  const es = await W(s, '?name=Ada&language=es&tone=pirate');
  assert.equal(es.status, 200);
  assert.notEqual(es.body.greeting, en);
  assert.deepEqual((await W(s, '?language=xx')).body, { error: 'unknown language' });
  assert.deepEqual((await W(s, '?tone=nope')).body, { error: 'unknown tone' });
  assert.equal((await W(s, '?language=xx')).status, 400);
}, READ_ENV()));

test('weather: an invalid name is 400', () => withServer(async (s) => {
  for (const n of ['a'.repeat(41), 'bad\u0007name']) {
    const r = await W(s, `?name=${enc(n)}`);
    assert.equal(r.status, 400, JSON.stringify(n));
    assert.equal(typeof r.body.error, 'string');
  }
}, READ_ENV()));

test('weather: a repeated query key uses the first value; unknown keys are ignored', () => withServer(async (s) => {
  const a = (await W(s, `?place=Rome&place=Oslo&date=${today()}&zzz=1`)).body;
  const b = (await W(s, `?place=Rome&date=${today()}`)).body;
  assert.deepEqual(a, b);
}, READ_ENV()));

test('weather: POST is 405 with allow GET', () => withServer(async (s) => {
  const r = await s.call('POST', '/api/weather', {});
  assert.equal(r.status, 405);
  assert.match(r.headers.get('allow'), /GET/);
}, READ_ENV()));

test('weather: the read limiter answers 429 with Retry-After and the v1 body shape', () => withServer(async (s) => {
  const statuses = [];
  let last;
  for (let i = 0; i < 5; i += 1) { last = await W(s); statuses.push(last.status); }
  assert.deepEqual(statuses.slice(0, 2), [200, 200]);
  assert.ok(statuses.includes(429), statuses.join());
  const limited = [last, ...[]].find((x) => x.status === 429);
  assert.ok(limited.headers.get('retry-after'));
  assert.equal(limited.body.error, "You've been greeted enough.");
  assert.equal(typeof limited.body.retryAfter, 'number');
}, { env: { HELLO_READ_LIMIT: '2' } }));

test('weather: reading a forecast with a name stores nothing and never counts as a visit', () => {
  const file = tmpFile();
  return withServer(async (s) => {
    assert.equal((await W(s, '?name=Ada')).status, 200);
    assert.equal(fs.existsSync(file), false);
    assert.equal((await hello(s, { name: 'Ada' })).body.visit, 1);
  }, { file, ...READ_ENV() });
});

test('weather: POST /hello is unchanged and carries no forecast fields', () => withServer(async (s) => {
  const r = await hello(s, { name: 'Ada' });
  assert.equal(r.status, 200);
  for (const k of ['condition', 'tempC', 'forecast', 'seed', 'simulated']) assert.equal(k in r.body, false, k);
}));
