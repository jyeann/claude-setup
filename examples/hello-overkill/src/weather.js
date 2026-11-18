'use strict';

const CONDITIONS = [
  'sunny spells of goodwill', 'gentle showers of high fives', 'scattered cheerful clouds', 'a breeze of friendly waves',
  'clear skies and open doors', 'light drizzle of kind words', 'fog lifting to reveal smiles', 'bright intervals of hospitality',
];
const MIN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 32-bit FNV-1a over the UTF-8 bytes of str; returns an unsigned integer.
function fnv1a(str) {
  let h = 2166136261;
  for (const b of Buffer.from(String(str), 'utf8')) { h ^= b; h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

// Deterministic PRNG returning floats in [0, 1).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Returns { place, key } (echo form and lowercase hash form) or null when invalid. undefined means the default 'anywhere'.
function normalizePlace(v) {
  if (v === undefined) return { place: 'anywhere', key: 'anywhere' };
  if (typeof v !== 'string') return null;
  // Collapse whitespace runs (incl. tab/newline) first, then reject any remaining control/format characters.
  const place = v.normalize('NFC').replace(/\s+/g, ' ').trim();
  const len = [...place].length;
  if (len < 1 || len > 40 || /[\p{Cc}\p{Cf}]/u.test(place)) return null;
  return { place, key: place.toLowerCase() };
}

// YYYY-MM-DD in UTC for a ms epoch.
const utcDate = (now) => new Date(now).toISOString().slice(0, 10);

// Pure, deterministic forecast. Draw order is fixed: condition, tempC, windKph, warmth, chance, rainbow.
function forecast({ date, place }) {
  const p = normalizePlace(place);
  if (!p) throw new RangeError('invalid place');
  if (typeof date !== 'string' || !MIN_DATE_RE.test(date)) throw new RangeError('invalid date');
  const seed = fnv1a(`${date}|${p.key}`);
  const rnd = mulberry32(seed);
  const condition = CONDITIONS[Math.floor(rnd() * CONDITIONS.length)];
  const tempC = -5 + Math.floor(rnd() * 41);
  const windKph = Math.floor(rnd() * 61);
  const warmthIndex = 1 + Math.floor(rnd() * 10);
  const chanceOfWarmRegards = Math.floor(rnd() * 101);
  rnd(); // rainbow draw, reserved so later draws stay stable
  return {
    date, place: p.place, seed, condition, tempC, windKph, chanceOfWarmRegards, warmthIndex,
    forecast: `${chanceOfWarmRegards}% chance of warm regards in ${p.place}, with ${condition}.`,
    simulated: true,
  };
}

// The v1 greeting text plus one appended sentence.
const weatherGreeting = ({ forecast: f, greeting }) => `${greeting} Today: ${f.forecast}`;

module.exports = { fnv1a, mulberry32, forecast, weatherGreeting, normalizePlace, utcDate, CONDITIONS };
