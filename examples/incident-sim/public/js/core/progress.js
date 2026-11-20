// Saved progress and the export/import format (version 1). Strict: every field is checked, no value is ever echoed.
import { parseSafe, utf8Length } from './safe-json.js';
import { ACTION_IDS, NODE_IDS } from '../engine/catalogue.js';

export const VERSION = 1;
export const MAX_RUNS = 200;
export const MAX_BYTES = 262144;
export const MAX_ACTIONS = 12;
export const MAX_TICK = 610;
const SCENARIO_RE = /^[a-z0-9-]{1,40}$/;
const HASH_RE = /^[0-9a-f]{8}$/;
const TOP_KEYS = ['version', 'runs'];
const RUN_KEYS = ['scenario', 'seed', 'scenarioHash', 'result', 'timeToMitigate', 'budgetLeft', 'harmful', 'hintUsed', 'score', 'actions'];
const ACTION_KEYS = ['t', 'id', 'node'];
const KNOWN_ACTIONS = ACTION_IDS.filter((id) => id !== 'inspect');

const cut = (s) => (s.length > 40 ? `${s.slice(0, 40)}...` : s);
const fail = (reason) => ({ ok: false, reason });
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v, lo, hi) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const hasOwn = (o, k) => Object.hasOwn(o, k);

// First structural problem of an object against a key list, or null.
function keyProblem(obj, keys, path) {
  for (const k of Object.keys(obj)) if (!keys.includes(k)) return `field "${path}${cut(k)}" is not part of the progress format.`;
  for (const k of keys) if (!hasOwn(obj, k)) return `field "${path}${k}" is missing.`;
  return null;
}

function isKnown(known, id) {
  if (!known) return true;
  if (typeof known.has === 'function') return known.has(id);
  return Array.isArray(known) && known.includes(id);
}

const clean = (o) => Object.assign(Object.create(null), o);

function checkAction(a, p) {
  if (!isObject(a)) return { error: `field "${p}" must be an object.` };
  const kp = keyProblem(a, ACTION_KEYS, `${p}.`);
  if (kp) return { error: kp };
  if (!isInt(a.t, 0, MAX_TICK)) return { error: `field "${p}.t" must be a whole number from 0 to ${MAX_TICK}.` };
  if (typeof a.id !== 'string' || !KNOWN_ACTIONS.includes(a.id)) return { error: `field "${p}.id" is not a known action.` };
  if (a.node !== null && (typeof a.node !== 'string' || !NODE_IDS.includes(a.node))) return { error: `field "${p}.node" must be a node id or null.` };
  return { value: clean({ t: a.t, id: a.id, node: a.node }) };
}

function checkRun(r, i, known) {
  const p = `runs[${i}]`;
  if (!isObject(r)) return { error: `field "${p}" must be an object.` };
  const kp = keyProblem(r, RUN_KEYS, `${p}.`);
  if (kp) return { error: kp };
  if (typeof r.scenario !== 'string' || !SCENARIO_RE.test(r.scenario)) return { error: `field "${p}.scenario" must use only lowercase letters, digits and hyphens.` };
  if (!isKnown(known, r.scenario)) return { error: `"${p}.scenario" names an incident this copy does not have.` };
  if (!isInt(r.seed, 0, 4294967295)) return { error: `field "${p}.seed" must be a whole number from 0 to 4294967295.` };
  if (typeof r.scenarioHash !== 'string' || !HASH_RE.test(r.scenarioHash)) return { error: `field "${p}.scenarioHash" must be 8 lowercase hex digits.` };
  if (r.result !== 'resolved' && r.result !== 'out-of-budget') return { error: `field "${p}.result" must be "resolved" or "out-of-budget".` };
  const resolved = r.result === 'resolved';
  if (resolved ? !isInt(r.timeToMitigate, 1, MAX_TICK) : r.timeToMitigate !== null) {
    return { error: `field "${p}.timeToMitigate" must be ${resolved ? `a whole number from 1 to ${MAX_TICK}` : 'null when the result is out-of-budget'}.` };
  }
  if (!isInt(r.budgetLeft, 0, 12)) return { error: `field "${p}.budgetLeft" must be a whole number from 0 to 12.` };
  if (!isInt(r.harmful, 0, 12)) return { error: `field "${p}.harmful" must be a whole number from 0 to 12.` };
  if (typeof r.hintUsed !== 'boolean') return { error: `field "${p}.hintUsed" must be true or false.` };
  if (!isInt(r.score, 0, 100)) return { error: `field "${p}.score" must be a whole number from 0 to 100.` };
  if (!Array.isArray(r.actions) || r.actions.length > MAX_ACTIONS) return { error: `field "${p}.actions" must be a list of at most ${MAX_ACTIONS} actions.` };
  const actions = [];
  for (let j = 0; j < r.actions.length; j++) {
    const a = checkAction(r.actions[j], `${p}.actions[${j}]`);
    if (a.error) return a;
    actions.push(a.value);
  }
  return {
    value: clean({ scenario: r.scenario, seed: r.seed, scenarioHash: r.scenarioHash, result: r.result, timeToMitigate: r.timeToMitigate, budgetLeft: r.budgetLeft, harmful: r.harmful, hintUsed: r.hintUsed, score: r.score, actions }),
  };
}

export function parseProgress(text, { knownScenarios } = {}) {
  const safe = parseSafe(text);
  if (!safe.ok) return safe;
  const doc = safe.value;
  if (!isObject(doc)) return fail('the file must contain a JSON object.');
  if (doc.version !== VERSION) {
    const v = typeof doc.version === 'number' ? cut(String(doc.version)) : 'unknown';
    return fail(`this file is version ${v} and this app reads version ${VERSION}.`);
  }
  for (const k of Object.keys(doc)) if (!TOP_KEYS.includes(k)) return fail(`field "${cut(k)}" is not part of the progress format.`);
  if (!Array.isArray(doc.runs)) return fail('field "runs" must be a list.');
  if (doc.runs.length > MAX_RUNS) return fail(`the file holds ${doc.runs.length} runs and the limit is ${MAX_RUNS}.`);
  const runs = [];
  for (let i = 0; i < doc.runs.length; i++) {
    const r = checkRun(doc.runs[i], i, knownScenarios);
    if (r.error) return fail(r.error);
    runs.push(r.value);
  }
  return { ok: true, progress: clean({ version: VERSION, runs }) };
}

export function serialiseProgress(progress) {
  return JSON.stringify(progress, null, 2);
}

export function exportFilename(dateStr) {
  return `incident-sim-progress-${dateStr}.json`;
}

export function emptyProgress() {
  return { version: VERSION, runs: [] };
}

// Pure: appends, then drops the oldest runs beyond 200 and until the serialised text fits in 256 KB.
export function addRun(progress, run) {
  let runs = [...progress.runs, run].slice(-MAX_RUNS);
  while (runs.length > 0 && utf8Length(serialiseProgress({ version: VERSION, runs })) > MAX_BYTES) runs = runs.slice(1);
  return { version: VERSION, runs };
}

// { [scenarioId]: { state, bestTime, bestScore, runs } } for scenarios that have at least one run.
export function bests(progress) {
  const out = {};
  for (const r of progress.runs) {
    const b = out[r.scenario] || (out[r.scenario] = { state: 'out-of-budget', bestTime: null, bestScore: null, runs: 0 });
    b.runs += 1;
    if (r.result === 'resolved') {
      b.state = 'resolved';
      if (b.bestTime === null || r.timeToMitigate < b.bestTime) b.bestTime = r.timeToMitigate;
    }
    if (b.bestScore === null || r.score > b.bestScore) b.bestScore = r.score;
  }
  return out;
}

// Entry for one scenario, with the "new" default for incidents never played.
export function bestFor(table, id) {
  return Object.hasOwn(table, id) ? table[id] : { state: 'new', bestTime: null, bestScore: null, runs: 0 };
}

export function resolvedCount(progress) {
  return new Set(progress.runs.filter((r) => r.result === 'resolved').map((r) => r.scenario)).size;
}

export function lastRun(progress, id) {
  for (let i = progress.runs.length - 1; i >= 0; i--) if (progress.runs[i].scenario === id) return progress.runs[i];
  return null;
}
