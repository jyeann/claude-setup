// Daily incident pick. Takes a date string only: no clock, no timezone, no Date object.
import { fnv1a32 } from '../engine/hash.js';

export const FIRST_DATE = '2026-01-01';
export const LAST_DATE = '2099-12-31';
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const daysIn = (y, m) => (m === 2 && isLeap(y) ? 29 : DAYS[m - 1]);

// Day number of the date counted from 2026-01-01 as day 1. Returns null when the date is not a real calendar day.
function dayNumber(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const m = DATE_RE.exec(dateStr);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return null;
  if (dateStr < FIRST_DATE || dateStr > LAST_DATE) return null;
  let n = 0;
  for (let yy = 2026; yy < y; yy++) n += isLeap(yy) ? 366 : 365;
  for (let mm = 1; mm < mo; mm++) n += daysIn(y, mm);
  return n + d;
}

export function daily(dateStr, validIds) {
  const number = dayNumber(dateStr);
  if (number === null) throw new RangeError('date must be a real day from 2026-01-01 to 2099-12-31 written YYYY-MM-DD');
  const ids = [...new Set(Array.from(validIds || []))].sort();
  return {
    date: dateStr,
    number,
    scenarioId: ids.length === 0 ? null : ids[fnv1a32(`daily:${dateStr}`) % ids.length],
    seed: fnv1a32(`daily-seed:${dateStr}`),
  };
}
