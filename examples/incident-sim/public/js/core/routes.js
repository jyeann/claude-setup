// Hash routes. Validates ids and seeds so the UI never sees an unchecked value.
export const ID_RE = /^[a-z0-9-]{1,40}$/;
export const MAX_SEED = 4294967295;
const SEED_RE = /^\d{1,10}$/;
export const SEED_ERROR = 'Seed must be a whole number from 0 to 4294967295.';

export function parseSeed(str) {
  if (typeof str !== 'string' || !SEED_RE.test(str)) return { ok: false, error: SEED_ERROR };
  const n = Number(str);
  return n <= MAX_SEED ? { ok: true, seed: n } : { ok: false, error: SEED_ERROR };
}

function seedParam(query) {
  for (const part of query.split('&')) {
    const i = part.indexOf('=');
    if ((i < 0 ? part : part.slice(0, i)) === 'seed') return i < 0 ? '' : part.slice(i + 1);
  }
  return undefined;
}

const NOT_FOUND = () => ({ name: 'notfound' });

export function parseRoute(hash) {
  let h = typeof hash === 'string' ? hash : '';
  if (h.startsWith('#')) h = h.slice(1);
  if (h === '' || h === '/') return { name: 'first' };
  const q = h.indexOf('?');
  const path = q < 0 ? h : h.slice(0, q);
  const query = q < 0 ? '' : h.slice(q + 1);
  if (path === '/incidents') return query === '' ? { name: 'board' } : NOT_FOUND();
  if (path === '/data') return query === '' ? { name: 'data' } : NOT_FOUND();
  if (path === '/about') return query === '' ? { name: 'about' } : NOT_FOUND();
  const m = /^\/(play|debrief)\/([^/]*)$/.exec(path);
  if (!m || !ID_RE.test(m[2])) return NOT_FOUND();
  if (m[1] === 'debrief') return query === '' ? { name: 'debrief', id: m[2] } : NOT_FOUND();
  const route = { name: 'play', id: m[2] };
  const raw = seedParam(query);
  if (raw !== undefined) {
    const s = parseSeed(raw);
    if (s.ok) route.seed = s.seed;
    else route.seedError = s.error;
  }
  return route;
}
