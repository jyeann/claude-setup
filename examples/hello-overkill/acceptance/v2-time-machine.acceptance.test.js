'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withServer, tmpDir, today, addDays, seedStore, hello, READ_ENV } = require('./helpers-v2');

const TM = (s, q = '') => s.call('GET', `/api/time-machine${q}`);
const enc = encodeURIComponent;
const STATUSES = ['no-record', 'before-first-visit', 'on-streak', 'unknown', 'inactive-after'];

test('time machine: date is required', () => withServer(async (s) => {
  const r = await TM(s);
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'date is required' });
}, READ_ENV()));

test('time machine: date format, real-date, lower and upper bound errors', () => withServer(async (s) => {
  const cases = [
    ['yesterday', 'date must be YYYY-MM-DD'], ['2020-1-1', 'date must be YYYY-MM-DD'], ['20200101', 'date must be YYYY-MM-DD'],
    ['1900-02-29', 'date is not a real date'], ['2023-13-01', 'date is not a real date'], ['2023-04-31', 'date is not a real date'],
    ['1899-12-31', 'date before 1900-01-01'],
    [addDays(today(), 1), 'date is in the future'], ['9999-12-31', 'date is in the future'],
  ];
  for (const [d, msg] of cases) {
    const r = await TM(s, `?date=${enc(d)}`);
    assert.equal(r.status, 400, d);
    assert.deepEqual(r.body, { error: msg }, d);
  }
}, READ_ENV()));

test('time machine: boundary dates 1900-01-01, 2000-02-29 and today are accepted', () => withServer(async (s) => {
  for (const d of ['1900-01-01', '2000-02-29', today()]) {
    const r = await TM(s, `?date=${d}`);
    assert.equal(r.status, 200, d);
    assert.equal(r.body.date, d);
  }
}, READ_ENV()));

test('time machine: 200 shape without a name has streak null and defaults en/formal', () => withServer(async (s) => {
  const r = await TM(s, '?date=1987-05-02');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^application\/json; charset=utf-8$/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(r.body).sort(), ['date', 'era', 'greeting', 'language', 'streak', 'tone']);
  assert.equal(r.body.streak, null);
  assert.equal(r.body.language, 'en');
  assert.equal(r.body.tone, 'formal');
  assert.ok(r.body.greeting.includes('friend'));
  assert.ok(r.body.greeting.length > 10);
}, READ_ENV()));

test('time machine: era strings including every boundary year', () => withServer(async (s) => {
  const table = [
    ['1900-01-01', 'Edwardian telegram'], ['1919-12-31', 'Edwardian telegram'],
    ['1920-01-01', 'radio age'], ['1945-12-31', 'radio age'],
    ['1946-01-01', 'atomic age'], ['1969-12-31', 'atomic age'],
    ['1970-01-01', 'disco and dial-up dawn'], ['1989-12-31', 'disco and dial-up dawn'],
    ['1990-01-01', 'web 1.0'], ['1999-12-31', 'web 1.0'],
    ['2000-01-01', 'social era'], ['2019-12-31', 'social era'],
    ['2020-01-01', 'now'], [today(), 'now'],
  ];
  for (const [d, era] of table) assert.equal((await TM(s, `?date=${d}`)).body.era, era, d);
}, READ_ENV()));

test('time machine: different eras give different greetings', () => withServer(async (s) => {
  const seen = new Set();
  for (const d of ['1905-06-01', '1930-06-01', '1955-06-01', '1980-06-01', '1995-06-01', '2010-06-01', '2024-06-01']) seen.add((await TM(s, `?date=${d}`)).body.greeting);
  assert.equal(seen.size, 7);
}, READ_ENV()));

test('time machine: name and language/tone appear in the greeting and are validated', () => withServer(async (s) => {
  const r = await TM(s, '?date=1955-05-05&name=Ada&language=es&tone=pirate');
  assert.equal(r.status, 200);
  assert.ok(r.body.greeting.includes('Ada'));
  assert.equal(r.body.language, 'es');
  assert.equal(r.body.tone, 'pirate');
  assert.notEqual(r.body.greeting, (await TM(s, '?date=1955-05-05&name=Ada')).body.greeting);
  assert.deepEqual((await TM(s, '?date=1955-05-05&language=xx')).body, { error: 'unknown language' });
  assert.deepEqual((await TM(s, '?date=1955-05-05&tone=nope')).body, { error: 'unknown tone' });
  for (const n of ['a'.repeat(41), 'bad\u0007name']) assert.equal((await TM(s, `?date=1955-05-05&name=${enc(n)}`)).status, 400);
}, READ_ENV()));

test('time machine: an unknown name has streak status no-record', () => withServer(async (s) => {
  const r = await TM(s, '?date=2001-01-01&name=Nobody');
  assert.equal(r.body.streak.status, 'no-record');
  assert.equal(r.body.streak.name, 'Nobody');
  assert.equal(r.body.streak.dayOfStreak ?? null, null);
}, READ_ENV()));

test('time machine: streak statuses for a seeded visitor (before, on-streak, unknown, inactive-after)', async () => {
  const file = path.join(tmpDir(), 'hello.json');
  const t = today();
  seedStore(file, [
    { displayName: 'Ada', visits: 9, streak: 4, firstDay: addDays(t, -30), lastDay: t },
    { displayName: 'Lapsed', visits: 3, streak: 2, firstDay: addDays(t, -30), lastDay: addDays(t, -5) },
  ]);
  await withServer(async (s) => {
    const q = (n, d) => TM(s, `?date=${d}&name=${n}`).then((r) => r.body.streak);
    assert.equal((await q('Ada', addDays(t, -40))).status, 'before-first-visit');
    const first = await q('Ada', addDays(t, -3));
    assert.deepEqual({ ...first }, { name: 'Ada', status: 'on-streak', dayOfStreak: 1, streakLength: 4 });
    assert.equal((await q('Ada', addDays(t, -2))).dayOfStreak, 2);
    assert.equal((await q('Ada', t)).dayOfStreak, 4);
    assert.equal((await q('Ada', t)).status, 'on-streak');
    const unknown = await q('Ada', addDays(t, -10));
    assert.equal(unknown.status, 'unknown');
    assert.equal(unknown.dayOfStreak, null);
    assert.equal((await q('Ada', addDays(t, -30))).status, 'unknown');
    assert.equal((await q('Lapsed', t)).status, 'inactive-after');
    assert.equal((await q('Lapsed', addDays(t, -4))).status, 'inactive-after');
    assert.equal((await q('Lapsed', addDays(t, -5))).status, 'on-streak');
    assert.equal((await q('Lapsed', addDays(t, -6))).status, 'on-streak');
    assert.equal((await q('Lapsed', addDays(t, -7))).status, 'unknown');
  }, { file, ...READ_ENV() });
});

test('time machine: the streak object uses only the status vocabulary (no dates, counts or display casing)', async () => {
  const file = path.join(tmpDir(), 'hello.json');
  const t = today();
  seedStore(file, [{ displayName: 'ADA LOVELACE', visits: 777, streak: 4, firstDay: addDays(t, -30), lastDay: t }]);
  await withServer(async (s) => {
    const r = await TM(s, '?date=2001-01-01&name=ada%20lovelace');
    assert.ok(STATUSES.includes(r.body.streak.status));
    assert.deepEqual(Object.keys(r.body.streak).sort(), ['dayOfStreak', 'name', 'status', 'streakLength']);
    assert.equal(r.body.streak.name, 'ada lovelace');
    for (const bad of ['ADA LOVELACE', '777', addDays(t, -30), 'firstDay', 'lastDay', 'visits', 'displayName']) assert.ok(!r.text.includes(bad), bad);
  }, { file, ...READ_ENV() });
});

test('time machine: is read-only (no visit increment, no data file written, store bytes unchanged)', async () => {
  const file = path.join(tmpDir(), 'hello.json');
  const t = today();
  seedStore(file, [{ displayName: 'Ada', visits: 9, streak: 4, firstDay: addDays(t, -30), lastDay: t }]);
  const before = fs.readFileSync(file);
  await withServer(async (s) => {
    for (let i = 0; i < 5; i += 1) await TM(s, `?date=${addDays(t, -i)}&name=Ada`);
    await TM(s, `?date=${t}&name=NeverSeen`);
    assert.deepEqual(fs.readFileSync(file), before);
    assert.equal((await hello(s, { name: 'Ada' })).body.visit, 10, 'time machine must not add visits');
    assert.equal((await hello(s, { name: 'NeverSeen' })).body.visit, 1, 'time machine must not create visitors');
  }, { file, ...READ_ENV() });
});

test('time machine: without any data file nothing is created', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'hello.json');
  return withServer(async (s) => {
    await TM(s, '?date=2001-01-01&name=Ada');
    assert.equal(fs.existsSync(file), false);
  }, { file, ...READ_ENV() });
});

test('time machine: HELLO_TIME_MACHINE_STREAKS=0 hides streak data', async () => {
  const file = path.join(tmpDir(), 'hello.json');
  seedStore(file, [{ displayName: 'Ada', visits: 9, streak: 4, firstDay: addDays(today(), -30), lastDay: today() }]);
  await withServer(async (s) => {
    const r = await TM(s, `?date=${today()}&name=Ada`);
    assert.equal(r.status, 200);
    assert.equal(r.body.streak, null);
  }, { file, env: { HELLO_TIME_MACHINE_STREAKS: '0', HELLO_READ_LIMIT: '10000' } });
});

test('time machine: POST is 405 with allow GET', () => withServer(async (s) => {
  const r = await s.call('POST', '/api/time-machine', {});
  assert.equal(r.status, 405);
  assert.match(r.headers.get('allow'), /GET/);
}, READ_ENV()));

test('time machine: the read limiter answers 429 with Retry-After', () => withServer(async (s) => {
  await TM(s, '?date=2001-01-01');
  await TM(s, '?date=2001-01-01');
  const r = await TM(s, '?date=2001-01-01');
  assert.equal(r.status, 429);
  assert.ok(r.headers.get('retry-after'));
}, { env: { HELLO_READ_LIMIT: '2' } }));
