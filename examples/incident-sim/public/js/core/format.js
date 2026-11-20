// Display formatting helpers. Pure, no Intl, no Date, no DOM.
import { formatInt } from '../engine/template.js';

const pad2 = (n) => (n < 10 ? `0${n}` : `${n}`);
const whole = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

// 41 -> "00:41", 3599 -> "59:59", 610 -> "10:10".
export function mmss(seconds) {
  const s = whole(seconds);
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

// 161 -> "T+02:41".
export function clock(tick) {
  return `T+${mmss(tick)}`;
}

// 1842 -> "1,842" (comma grouping, no Intl).
export function int(n) {
  return formatInt(Number.isFinite(n) ? Math.round(n) : 0);
}

// Fraction to percent number with exactly one decimal, no sign suffix: 0.062 -> "6.2".
export function percentNumber(fraction) {
  const tenths = Math.round((Number.isFinite(fraction) ? fraction : 0) * 1000);
  const abs = Math.abs(tenths);
  return `${tenths < 0 ? '-' : ''}${Math.floor(abs / 10)}.${abs % 10}`;
}

// 0.062 -> "6.2%".
export function percent(fraction) {
  return `${percentNumber(fraction)}%`;
}

// 2100 -> "2,100 ms".
export function ms(value) {
  return `${int(value)} ms`;
}

// 1842 -> "1,842 req/s".
export function rate(rps) {
  return `${int(rps)} req/s`;
}
