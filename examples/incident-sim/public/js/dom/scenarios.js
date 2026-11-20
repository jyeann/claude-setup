// Fetch and re-validate scenarios. The server already validated them; the client checks again with the same shared validator.
import { parseSafe } from '../core/safe-json.js';
import { validate, formatError } from '../engine/validate.js';

export const LOAD_TIMEOUT_MS = 8000;

async function fetchText(url, signal) {
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function loadIndex(signal) {
  const text = await fetchText('/scenarios/index.json', signal);
  const parsed = parseSafe(text, { maxBytes: 262144, maxDepth: 12 });
  if (!parsed.ok) throw new Error(parsed.reason);
  const v = parsed.value;
  const valid = Array.isArray(v.valid) ? v.valid.filter((x) => typeof x === 'string') : [];
  const errors = Array.isArray(v.errors)
    ? v.errors.filter((e) => e && typeof e === 'object').map((e) => ({ file: String(e.file), field: String(e.field), message: String(e.message) }))
    : [];
  return { valid, errors };
}

export async function loadScenario(id, signal) {
  const file = `${id}.json`;
  try {
    const text = await fetchText(`/scenarios/${id}.json`, signal);
    const parsed = parseSafe(text, { maxBytes: 65536, maxDepth: 12 });
    if (!parsed.ok) return { ok: false, errors: [{ file, field: '(file)', message: `${parsed.reason} Expected: a valid scenario file.` }] };
    const res = validate(parsed.value, file);
    return res.ok ? { ok: true, scenario: res.scenario } : { ok: false, errors: res.errors };
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    return { ok: false, errors: [{ file, field: '(file)', message: 'could not be loaded. Expected: a readable scenario file.' }] };
  }
}

// -> { scenarios: Map(id -> scenario), errors: [{file, field, message}] }. Throws when the index cannot be read.
export async function loadAll() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), LOAD_TIMEOUT_MS);
  try {
    const index = await loadIndex(ctl.signal);
    const results = await Promise.all(index.valid.map((id) => loadScenario(id, ctl.signal)));
    const scenarios = new Map();
    const errors = [...index.errors];
    results.forEach((r, i) => {
      if (r.ok) scenarios.set(index.valid[i], r.scenario);
      else errors.push(...r.errors);
    });
    return { scenarios, errors };
  } finally {
    clearTimeout(timer);
  }
}

export const errorLine = (e) => `${formatError(e)} Fix the file and restart the server.`;

// Board order: by difficulty, then the shipped order, then id.
const SHIPPED = ['cache-stampede', 'thundering-herd', 'retry-storm', 'hot-partition', 'queue-backlog', 'n-plus-one', 'connection-pool-exhaustion', 'expiring-certificate', 'split-brain', 'cascading-failure'];
export function sortScenarios(map) {
  const rank = (id) => { const i = SHIPPED.indexOf(id); return i < 0 ? SHIPPED.length : i; };
  return [...map.values()].sort((a, b) => a.difficulty - b.difficulty || rank(a.id) - rank(b.id) || (a.id < b.id ? -1 : 1));
}
