// Condition grammar (design.md 5.6): evaluation and grammar checking. Pure.
import { metric, METRICS } from './model.js';
import { ACTION_IDS } from './catalogue.js';

export const MAX_COND_DEPTH = 4;
export const MAX_COND_LEAVES = 16;
export const OPS = Object.freeze(['gt', 'gte', 'lt', 'lte', 'eq']);

const has = (o, k) => Object.hasOwn(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function compare(a, op, b) {
  if (op === 'gt') return a > b;
  if (op === 'gte') return a >= b;
  if (op === 'lt') return a < b;
  if (op === 'lte') return a <= b;
  return a === b;
}

// Read the current value of a parameter path ("node:<id>.<param>" or "edge:<a>><b>.<param>"). undefined when absent.
export function readPath(state, path) {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return undefined;
  const target = path.slice(0, dot);
  const name = path.slice(dot + 1);
  let holder;
  if (target.startsWith('node:')) holder = state.params[target.slice(5)];
  else if (target.startsWith('edge:')) holder = state.edgeParams[target.slice(5)];
  return holder && Object.hasOwn(holder, name) ? holder[name] : undefined;
}

export function evaluate(cond, state) {
  if (has(cond, 'all')) return cond.all.every((c) => evaluate(c, state));
  if (has(cond, 'any')) return cond.any.some((c) => evaluate(c, state));
  if (has(cond, 'not')) return !evaluate(cond.not, state);
  if (has(cond, 'tickGte')) return state.tick >= cond.tickGte;
  if (has(cond, 'applied')) {
    for (const k of Object.keys(state.applied)) if (k.startsWith(`${cond.applied}@`)) return true;
    return false;
  }
  if (has(cond, 'fault')) return state.faultsFired.includes(cond.fault);
  if (has(cond, 'path')) {
    const v = readPath(state, cond.path);
    return v === undefined ? false : compare(v, cond.op, cond.value);
  }
  const v = metric(state, cond.node, cond.metric);
  return v === null ? false : compare(v, cond.op, cond.value);
}

const KEYSETS = {
  all: ['all'], any: ['any'], not: ['not'], tickGte: ['tickGte'], applied: ['applied'], fault: ['fault'],
  path: ['path', 'op', 'value'], node: ['node', 'metric', 'op', 'value'],
};

const show = (v) => (typeof v === 'string' ? JSON.stringify(v.length > 60 ? `${v.slice(0, 60)}...` : v) : 'that value');

// Check a condition against the grammar. report(field, message) receives the dotted field and a full message ending in "Expected: ...".
// ctx: {nodes:Set, faultIds:Set, checkPath(path)->string|null}.
export function checkCondition(cond, field, ctx, report) {
  const stats = { leaves: 0 };
  walk(cond, field, 1, ctx, report, stats);
  if (stats.leaves > MAX_COND_LEAVES) report(field, `has ${stats.leaves} leaves. Expected: at most ${MAX_COND_LEAVES} leaves.`);
}

function walk(cond, field, depth, ctx, report, stats) {
  const bad = (f, what, expected) => report(f, `${what}. Expected: ${expected}.`);
  if (!isObj(cond)) return bad(field, 'is not a condition', 'an object such as {"tickGte": 5}');
  if (depth > MAX_COND_DEPTH) return bad(field, `is nested more than ${MAX_COND_DEPTH} levels`, `at most ${MAX_COND_DEPTH} levels of all, any and not`);
  const keys = Object.keys(cond);
  const form = Object.keys(KEYSETS).find((k) => has(cond, k));
  if (!form) return bad(field, 'has no known condition form', 'one of node+metric+op+value, path+op+value, tickGte, applied, fault, all, any or not');
  const allowed = KEYSETS[form];
  for (const k of keys) if (!allowed.includes(k)) return bad(`${field}.${k}`, 'is not allowed here', `only the keys ${allowed.join(', ')}`);
  if (form === 'all' || form === 'any') {
    const list = cond[form];
    if (!Array.isArray(list) || list.length < 1) return bad(`${field}.${form}`, 'is not a list of conditions', 'a non-empty array of conditions');
    list.forEach((c, i) => walk(c, `${field}.${form}[${i}]`, depth + 1, ctx, report, stats));
    return undefined;
  }
  if (form === 'not') return walk(cond.not, `${field}.not`, depth + 1, ctx, report, stats);
  stats.leaves++;
  if (form === 'tickGte') {
    if (!Number.isInteger(cond.tickGte) || cond.tickGte < 0) bad(`${field}.tickGte`, 'is not a tick', 'an integer of at least 0');
  } else if (form === 'applied') {
    if (typeof cond.applied !== 'string' || !ACTION_IDS.includes(cond.applied)) bad(`${field}.applied`, `is ${show(cond.applied)}, not an action`, `one of ${ACTION_IDS.join(', ')}`);
  } else if (form === 'fault') {
    if (typeof cond.fault !== 'string' || !ctx.faultIds.has(cond.fault)) bad(`${field}.fault`, `names ${show(cond.fault)}, which is not a fault of this scenario`, 'the id of a fault in faults');
  } else {
    if (!OPS.includes(cond.op)) bad(`${field}.op`, 'is not a comparison', `one of ${OPS.join(', ')}`);
    if (form === 'node') {
      if (typeof cond.node !== 'string' || !ctx.nodes.has(cond.node)) bad(`${field}.node`, `names ${show(cond.node)}, which is not in the topology`, 'a node id from topology.nodes');
      if (!METRICS.includes(cond.metric)) bad(`${field}.metric`, 'is not a metric', `one of ${METRICS.join(', ')}`);
      if (typeof cond.value !== 'number' || !Number.isFinite(cond.value)) bad(`${field}.value`, 'is not a number', 'a finite number');
    } else {
      const why = typeof cond.path === 'string' ? ctx.checkPath(cond.path) : 'is not a path';
      if (why) bad(`${field}.path`, why, 'a path such as node:cache.hitRate or edge:a>b.retries');
      if (!(typeof cond.value === 'boolean' || (typeof cond.value === 'number' && Number.isFinite(cond.value)))) bad(`${field}.value`, 'is not a number or boolean', 'a finite number or a boolean');
    }
  }
  return undefined;
}
