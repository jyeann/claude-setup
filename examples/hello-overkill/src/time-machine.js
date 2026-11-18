'use strict';
const { render } = require('./greetings');

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;
const MIN_DATE = '1900-01-01';

const ERAS = [
  { from: 1900, name: 'Edwardian telegram', medium: 'telegram', opening: 'STOP. Most esteemed greetings', closing: 'Yours faithfully, by wire.' },
  { from: 1920, name: 'radio age', medium: 'radio', opening: 'Good evening, listeners', closing: 'Stay tuned for more.' },
  { from: 1946, name: 'atomic age', medium: 'television', opening: 'Greetings from the future', closing: 'The world of tomorrow awaits.' },
  { from: 1970, name: 'disco and dial-up dawn', medium: 'modem', opening: 'Groovy greetings', closing: 'Now connecting at 56k.' },
  { from: 1990, name: 'web 1.0', medium: 'homepage', opening: 'Welcome to my homepage', closing: 'You are visitor number 1.' },
  { from: 2000, name: 'social era', medium: 'feed', opening: 'Hey there', closing: 'Like and share.' },
  { from: 2020, name: 'now', medium: 'stream', opening: 'Hello', closing: 'Have a great day.' },
];

// Returns { date, error }: error is null for a valid date between 1900-01-01 and todayStr (inclusive).
function parseDate(str, todayStr) {
  const fail = (error) => ({ date: null, error });
  if (str === undefined || str === null || str === '') return fail('date is required');
  if (typeof str !== 'string' || !DAY_RE.test(str)) return fail('date must be YYYY-MM-DD');
  const [y, m, d] = str.split('-').map(Number);
  // setUTCFullYear avoids Date.UTC mapping years 0-99 to 1900-1999.
  const t = new Date(Date.UTC(2000, m - 1, d));
  t.setUTCFullYear(y);
  if (m < 1 || m > 12 || t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return fail('date is not a real date');
  if (str < MIN_DATE) return fail('date before 1900-01-01');
  if (str > todayStr) return fail('date is in the future');
  return { date: str, error: null };
}

// Era record { name, medium, opening, closing } for a UTC year, or null before 1900.
function eraFor(year) {
  if (!Number.isInteger(year) || year < 1900) return null;
  let era = ERAS[0];
  for (const e of ERAS) if (year >= e.from) era = e;
  return { name: era.name, medium: era.medium, opening: era.opening, closing: era.closing };
}

// Era-flavoured greeting; language/tone default to en/formal. Returns null for an invalid date, language or tone.
function greetingFor({ date, name, language = 'en', tone = 'formal' }) {
  const era = typeof date === 'string' && DAY_RE.test(date) ? eraFor(Number(date.slice(0, 4))) : null;
  const base = render(language, tone, name || 'World');
  if (!era || base === null) return null;
  return `${era.opening}, ${name || 'friend'}! ${base} ${era.closing}`;
}

const dayNum = (s) => Math.round(Date.parse(`${s}T00:00:00Z`) / DAY_MS);

// Status vocabulary only: { status, dayOfStreak, streakLength }.
function streakOn({ visitor, date }) {
  if (!visitor) return { status: 'no-record', dayOfStreak: null, streakLength: null };
  const streakLength = visitor.streak;
  if (date < visitor.firstDay) return { status: 'before-first-visit', dayOfStreak: null, streakLength };
  if (date > visitor.lastDay) return { status: 'inactive-after', dayOfStreak: null, streakLength };
  const offset = dayNum(date) - (dayNum(visitor.lastDay) - streakLength + 1);
  if (offset >= 0) return { status: 'on-streak', dayOfStreak: offset + 1, streakLength };
  return { status: 'unknown', dayOfStreak: null, streakLength };
}

module.exports = { parseDate, eraFor, greetingFor, streakOn, ERAS };
