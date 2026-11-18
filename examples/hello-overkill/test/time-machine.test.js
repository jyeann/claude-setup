'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDate, eraFor, greetingFor, streakOn, ERAS } = require('../src/time-machine');
const { render } = require('../src/greetings');

const TODAY = '2026-11-18';
const err = (s, t = TODAY) => parseDate(s, t).error;

test('parseDate accepts boundary dates', () => {
  assert.deepEqual(parseDate('1900-01-01', TODAY), { date: '1900-01-01', error: null });
  assert.deepEqual(parseDate(TODAY, TODAY), { date: TODAY, error: null });
  assert.equal(err('2000-02-29'), null);
  assert.equal(err('1987-05-02'), null);
});

test('parseDate rejects with the spec messages', () => {
  assert.equal(err('1899-12-31'), 'date before 1900-01-01');
  assert.equal(err('2026-11-19'), 'date is in the future');
  assert.equal(err('1900-02-29'), 'date is not a real date');
  assert.equal(err('2026-13-01'), 'date is not a real date');
  assert.equal(err('2026-02-30'), 'date is not a real date');
  assert.equal(err('2026-00-10'), 'date is not a real date');
  assert.equal(err('2026-04-31'), 'date is not a real date');
  assert.equal(err(undefined), 'date is required');
  assert.equal(err(''), 'date is required');
  for (const bad of ['2026-1-1', '26-01-01', '2026/01/01', 'yesterday', ' 2026-01-01', '2026-01-01T00:00:00Z', 20260101, {}, []]) {
    assert.equal(err(bad), 'date must be YYYY-MM-DD', JSON.stringify(bad));
  }
  const bad = parseDate('2026-11-19', TODAY);
  assert.equal(bad.date, null);
});

test('eraFor maps every era boundary year', () => {
  const table = [[1900, 'Edwardian telegram'], [1919, 'Edwardian telegram'], [1920, 'radio age'], [1945, 'radio age'],
    [1946, 'atomic age'], [1969, 'atomic age'], [1970, 'disco and dial-up dawn'], [1989, 'disco and dial-up dawn'],
    [1990, 'web 1.0'], [1999, 'web 1.0'], [2000, 'social era'], [2019, 'social era'], [2020, 'now'], [2026, 'now'], [2100, 'now']];
  for (const [year, name] of table) assert.equal(eraFor(year).name, name, String(year));
  for (const e of ERAS) {
    const era = eraFor(e.from);
    assert.ok(era.opening.length > 0 && era.closing.length > 0 && era.medium.length > 0);
  }
});

test('eraFor returns null for years before 1900 or non-integers', () => {
  for (const bad of [1899, 0, -5, 1900.5, NaN, '1990', undefined, null]) assert.equal(eraFor(bad), null, String(bad));
});

test('eraFor returns a copy that cannot corrupt the table', () => {
  const e = eraFor(1990); e.opening = 'hacked';
  assert.notEqual(eraFor(1990).opening, 'hacked');
});

test('greetingFor composes opening, v1 greeting and closing', () => {
  const era = eraFor(1987);
  assert.equal(greetingFor({ date: '1987-05-02', name: 'Ada' }), `${era.opening}, Ada! ${render('en', 'formal', 'Ada')} ${era.closing}`);
  assert.equal(greetingFor({ date: '1987-05-02' }), `${era.opening}, friend! ${render('en', 'formal', 'World')} ${era.closing}`);
  assert.equal(greetingFor({ date: '2024-01-01', name: 'Ada', language: 'es', tone: 'pirate' }),
    `${eraFor(2024).opening}, Ada! ${render('es', 'pirate', 'Ada')} ${eraFor(2024).closing}`);
});

test('greetingFor inserts names literally and returns null for bad inputs', () => {
  const g = greetingFor({ date: '2001-01-01', name: '$& {name}' });
  assert.ok(g.includes('$& {name}'));
  assert.equal(g.split('$& {name}').length - 1, 2);
  assert.equal(greetingFor({ date: '2001-01-01', name: 'Ada', language: 'xx' }), null);
  assert.equal(greetingFor({ date: '2001-01-01', name: 'Ada', tone: 'nope' }), null);
  assert.equal(greetingFor({ date: '1850-01-01', name: 'Ada' }), null);
  assert.equal(greetingFor({ date: 'garbage', name: 'Ada' }), null);
});

// Visitor: first visit 2026-01-01, last visit 2026-11-18, current streak 4 (Nov 15..18).
const V = { displayName: 'Ada', visits: 20, streak: 4, firstDay: '2026-01-01', lastDay: '2026-11-18' };

test('streakOn: no-record', () => {
  assert.deepEqual(streakOn({ visitor: null, date: '2026-05-05' }), { status: 'no-record', dayOfStreak: null, streakLength: null });
});

test('streakOn: before-first-visit', () => {
  assert.deepEqual(streakOn({ visitor: V, date: '2025-12-31' }), { status: 'before-first-visit', dayOfStreak: null, streakLength: 4 });
});

test('streakOn: on-streak numbers days 1-based inside the streak window', () => {
  assert.deepEqual(streakOn({ visitor: V, date: '2026-11-15' }), { status: 'on-streak', dayOfStreak: 1, streakLength: 4 });
  assert.deepEqual(streakOn({ visitor: V, date: '2026-11-16' }), { status: 'on-streak', dayOfStreak: 2, streakLength: 4 });
  assert.deepEqual(streakOn({ visitor: V, date: '2026-11-18' }), { status: 'on-streak', dayOfStreak: 4, streakLength: 4 });
});

test('streakOn: unknown between first day and the streak window', () => {
  assert.deepEqual(streakOn({ visitor: V, date: '2026-11-14' }), { status: 'unknown', dayOfStreak: null, streakLength: 4 });
  assert.deepEqual(streakOn({ visitor: V, date: '2026-01-01' }), { status: 'unknown', dayOfStreak: null, streakLength: 4 });
});

test('streakOn: inactive-after the last visit', () => {
  assert.deepEqual(streakOn({ visitor: V, date: '2026-11-19' }), { status: 'inactive-after', dayOfStreak: null, streakLength: 4 });
});

test('streakOn: streak window crosses month and year boundaries and a single-day streak', () => {
  const w = { displayName: 'B', visits: 3, streak: 3, firstDay: '2025-12-30', lastDay: '2026-01-01' };
  assert.equal(streakOn({ visitor: w, date: '2025-12-30' }).dayOfStreak, 1);
  assert.equal(streakOn({ visitor: w, date: '2025-12-31' }).dayOfStreak, 2);
  assert.equal(streakOn({ visitor: w, date: '2026-01-01' }).dayOfStreak, 3);
  const one = { displayName: 'C', visits: 1, streak: 1, firstDay: '2026-03-01', lastDay: '2026-03-01' };
  assert.deepEqual(streakOn({ visitor: one, date: '2026-03-01' }), { status: 'on-streak', dayOfStreak: 1, streakLength: 1 });
});

test('streakOn output carries only the status vocabulary, never dates or counts', () => {
  assert.deepEqual(Object.keys(streakOn({ visitor: V, date: '2026-11-18' })).sort(), ['dayOfStreak', 'status', 'streakLength']);
});

test('years 0001-0099 are real dates that are before 1900, not "not a real date"', () => {
  assert.deepEqual(parseDate('0001-01-01', '2026-11-18'), { date: null, error: 'date before 1900-01-01' });
  assert.deepEqual(parseDate('0099-12-31', '2026-11-18'), { date: null, error: 'date before 1900-01-01' });
  assert.equal(parseDate('0000-01-01', '2026-11-18').error, 'date before 1900-01-01');
  assert.equal(parseDate('1900-02-29', '2026-11-18').error, 'date is not a real date');
});
