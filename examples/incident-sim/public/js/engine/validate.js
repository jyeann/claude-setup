// Scenario validator (design.md section 6, spec.md V1-V19). Pure and total: it never throws.
// Errors are collected in schema order (SCENARIO_KEYS), at most 10, each {file, field, message}.
import {
  ACTION_IDS, ACTION_BY_ID, FIX_IDS, DEFAULT_COST, NODE_IDS, NODE_TYPES, PARAMS, EDGE_PARAMS, EDGE_RULES,
} from './catalogue.js';
import { isAllowedGuide, GUIDE_PREFIX } from './guides.js';
import { checkCondition } from './conditions.js';
import { placeholders } from './template.js';
import { METRICS } from './model.js';

export const MAX_FILE_BYTES = 65536;
export const SCENARIO_KEYS = Object.freeze([
  'schema', 'id', 'title', 'difficulty', 'summary', 'budget', 'seed', 'maxTicks', 'holdTicks', 'escalateEvery', 'labels', 'topology', 'workload',
  'thresholds', 'sparks', 'faults', 'alerts', 'logs', 'deploys', 'diagnostics', 'actions', 'resolve', 'hint', 'rootCause', 'rootCauseNode', 'concept',
  'harmfulWhy', 'optimalPath', 'optimalSummary', 'guideUrl', 'guideTitle',
]);
const MAX_ERRORS = 10;
const SPARK_KEYS = ['p99', 'errors', 'saturation', 'queue', 'cache-hit'];
const THRESHOLD_KEYS = ['saturation', 'errorRate', 'p99', 'queue', 'hitRate'];
const DIAG_KEYS = ['trace-request', 'tail-logs', 'compare-dashboards', 'deploy-history'];
const ID_RE = /^[a-z0-9-]{1,40}$/;

export function formatError({ file, field, message }) {
  return `scenarios/${file}: field "${field}": ${message}`;
}

const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const echo = (s) => JSON.stringify(s.length > 60 ? `${s.slice(0, 60)}...` : s);
const list = (a) => a.join(', ');

function deepCopy(v) {
  if (Array.isArray(v)) return v.map(deepCopy);
  if (isObj(v)) {
    const o = {};
    for (const k of Object.keys(v)) Object.defineProperty(o, k, { value: deepCopy(v[k]), enumerable: true, writable: true, configurable: true });
    return o;
  }
  return v;
}

function deepFreeze(v) {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

function rangeMessage(spec) {
  if (spec.bool) return 'a boolean';
  return `${spec.int ? 'an integer' : 'a number'} from ${spec.min} to ${spec.max}`;
}

// null when v fits the parameter spec, else a full message.
function paramProblem(v, spec) {
  if (spec.bool) return typeof v === 'boolean' ? null : `is not a boolean. Expected: ${rangeMessage(spec)}.`;
  if (!isNum(v) || (spec.int && !Number.isInteger(v)) || v < spec.min || v > spec.max) return `is out of range. Expected: ${rangeMessage(spec)}.`;
  return null;
}

export function validate(obj, fileName) {
  try {
    return run(obj, fileName);
  } catch {
    return { ok: false, errors: [{ file: fileName, field: '(file)', message: 'could not be checked. Expected: a JSON object that follows the scenario schema.' }] };
  }
}

function run(obj, file) {
  if (!isObj(obj)) {
    return { ok: false, errors: [{ file, field: '(file)', message: 'is not a JSON object. Expected: an object with the scenario fields.' }] };
  }
  const buckets = new Map(SCENARIO_KEYS.map((k) => [k, []]));
  const unknown = [];
  let current = unknown;
  const add = (field, message) => { current.push({ file, field, message }); };
  const section = (key, fn) => { current = buckets.get(key); fn(); };

  for (const k of Object.keys(obj)) {
    if (!SCENARIO_KEYS.includes(k)) add(k, `is not a known field. Expected: one of ${list(SCENARIO_KEYS)}.`);
  }
  const out = {};
  const get = (k) => own(obj, k);

  // ---- small checkers bound to add()
  const missing = (field, expected) => add(field, `missing. Expected: ${expected}.`);
  const checkString = (field, v, min, max) => {
    const expected = `a string of ${min} to ${max} characters`;
    if (v === undefined) return missing(field, min === 1 ? 'a non-empty string' : expected), false;
    if (typeof v !== 'string') return add(field, `is not a string. Expected: ${expected}.`), false;
    if (v.length < min || v.length > max) return add(field, `has ${v.length} characters. Expected: ${expected}.`), false;
    return true;
  };
  const checkInt = (field, v, lo, hi) => {
    const expected = `an integer from ${lo} to ${hi}`;
    if (v === undefined) return missing(field, expected), false;
    if (!isInt(v) || v < lo || v > hi) return add(field, `is out of range. Expected: ${expected}.`), false;
    return true;
  };
  const nodeProblem = (v) => (typeof v === 'string' ? (nodes.has(v) ? null : `names ${echo(v)}, which is not in the topology`) : 'is not a node id');
  const checkNode = (field, v) => {
    const why = nodeProblem(v);
    if (why) add(field, `${why}. Expected: a node id from topology.nodes.`);
    return !why;
  };
  const unknownAction = (field, v) => add(field, `unknown action ${typeof v === 'string' ? echo(v) : 'value'}. Expected: one of ${list(ACTION_IDS)}.`);

  // ---- scalars
  section('schema', () => { const v = get('schema'); if (v === undefined) missing('schema', 'the integer 1'); else if (v !== 1) add('schema', 'is not the integer 1. Expected: the integer 1.'); });
  const stem = typeof file === 'string' ? file.replace(/\.json$/, '') : '';
  section('id', () => {
    const v = get('id');
    if (v === undefined) return missing('id', 'a string matching ^[a-z0-9-]{1,40}$ and the file name');
    if (typeof v !== 'string' || !ID_RE.test(v)) return add('id', 'is not a valid id. Expected: a string matching ^[a-z0-9-]{1,40}$.');
    if (v !== stem) return add('id', `is not the file name. Expected: ${echo(stem)}.`);
    return undefined;
  });
  section('title', () => { checkString('title', get('title'), 1, 300); });
  section('difficulty', () => { checkInt('difficulty', get('difficulty'), 1, 3); });
  section('summary', () => { checkString('summary', get('summary'), 1, 160); });
  section('budget', () => { checkInt('budget', get('budget'), 1, 12); });
  section('seed', () => { checkInt('seed', get('seed'), 0, 4294967295); });
  const optInt = (key, lo, hi) => section(key, () => { if (get(key) !== undefined) checkInt(key, get(key), lo, hi); });
  optInt('maxTicks', 60, 600);
  optInt('holdTicks', 1, 30);
  optInt('escalateEvery', 0, 600);
  const maxTicks = isInt(get('maxTicks')) && get('maxTicks') >= 60 && get('maxTicks') <= 600 ? get('maxTicks') : 600;
  const budget = isInt(get('budget')) && get('budget') >= 1 && get('budget') <= 12 ? get('budget') : null;

  // ---- topology (checked first because everything else refers to its nodes)
  const nodes = new Set();
  const nodeParams = {};
  const edgeKeys = new Set();
  const edgeOut = [];
  section('topology', () => {
    const topo = get('topology');
    if (topo === undefined) return missing('topology', 'an object with nodes and edges');
    if (!isObj(topo)) return add('topology', 'is not an object. Expected: an object with nodes and edges.');
    for (const k of Object.keys(topo)) if (k !== 'nodes' && k !== 'edges') add(`topology.${k}`, 'is not a known field. Expected: one of nodes, edges.');
    const rawNodes = own(topo, 'nodes');
    if (!isObj(rawNodes)) {
      add('topology.nodes', rawNodes === undefined ? 'missing. Expected: an object of node ids to parameters.' : 'is not an object. Expected: an object of node ids to parameters.');
    } else {
      const ids = Object.keys(rawNodes);
      if (ids.length < 3 || ids.length > 11) add('topology.nodes', `has ${ids.length} nodes. Expected: 3 to 11 nodes.`);
      if (!Object.hasOwn(rawNodes, 'clients')) add('topology.nodes', 'has no clients node. Expected: a node named clients.');
      for (const id of ids) {
        const f = `topology.nodes.${id}`;
        if (!NODE_IDS.includes(id)) { add(f, `is not a known node id. Expected: one of ${list(NODE_IDS)}.`); continue; }
        nodes.add(id);
        const raw = rawNodes[id];
        if (!isObj(raw)) { add(f, 'is not an object. Expected: an object of parameters.'); continue; }
        const type = NODE_TYPES[id];
        const specs = PARAMS[type];
        const filled = {};
        for (const k of Object.keys(raw)) {
          if (!Object.hasOwn(specs, k)) { add(`${f}.${k}`, `is not a parameter of a ${type} node. Expected: one of ${list(Object.keys(specs))}.`); continue; }
          const why = paramProblem(raw[k], specs[k]);
          if (why) add(`${f}.${k}`, why); else filled[k] = raw[k];
        }
        for (const [k, spec] of Object.entries(specs)) {
          if (Object.hasOwn(filled, k)) continue;
          if (Object.hasOwn(raw, k)) continue; // already reported
          if (spec.required) add(`${f}.${k}`, `missing. Expected: ${rangeMessage(spec)}.`);
          else if (spec.default !== undefined) filled[k] = spec.default;
        }
        if (type === 'db' && filled.hotShare === undefined && !Object.hasOwn(raw, 'hotShare')) filled.hotShare = 1 / (filled.shards || 1);
        nodeParams[id] = filled;
      }
    }
    const rawEdges = own(topo, 'edges');
    if (!Array.isArray(rawEdges)) {
      add('topology.edges', rawEdges === undefined ? 'missing. Expected: an array of 1 to 14 edges.' : 'is not an array. Expected: an array of 1 to 14 edges.');
      return undefined;
    }
    if (rawEdges.length < 1 || rawEdges.length > 14) add('topology.edges', `has ${rawEdges.length} edges. Expected: 1 to 14 edges.`);
    const adj = new Map();
    rawEdges.forEach((e, i) => {
      const f = `topology.edges[${i}]`;
      if (!isObj(e)) return add(f, 'is not an object. Expected: an object with from, to and optional edge parameters.');
      let ok = true;
      for (const end of ['from', 'to']) {
        const v = own(e, end);
        if (v === undefined) { missing(`${f}.${end}`, 'a node id from topology.nodes'); ok = false; } else if (!checkNode(`${f}.${end}`, v)) ok = false;
      }
      const filled = {};
      for (const k of Object.keys(e)) {
        if (k === 'from' || k === 'to') continue;
        if (!Object.hasOwn(EDGE_PARAMS, k)) { add(`${f}.${k}`, `is not an edge parameter. Expected: one of from, to, ${list(Object.keys(EDGE_PARAMS))}.`); continue; }
        const why = paramProblem(e[k], EDGE_PARAMS[k]);
        if (why) add(`${f}.${k}`, why); else filled[k] = e[k];
      }
      if (!ok) return undefined;
      const { from, to } = e;
      if (from === to) return add(f, 'connects a node to itself. Expected: edges between two different nodes.');
      const ft = NODE_TYPES[from];
      const tt = NODE_TYPES[to];
      const dirOk = EDGE_RULES[ft].includes(tt) && (ft !== 'db' || (from === 'db-primary' && to === 'db-replica'));
      if (!dirOk) return add(f, `runs from a ${ft} to a ${tt}. Expected: ${ft === 'db' ? 'only db-primary to db-replica between databases' : `an edge from a ${ft} to ${EDGE_RULES[ft].length ? list(EDGE_RULES[ft]) : 'nothing (it has no outgoing edges)'}`}.`);
      const key = `${from}>${to}`;
      if (edgeKeys.has(key)) return add(f, 'repeats an earlier edge. Expected: each pair of nodes joined at most once.');
      edgeKeys.add(key);
      for (const [k, spec] of Object.entries(EDGE_PARAMS)) {
        if (Object.hasOwn(filled, k) || Object.hasOwn(e, k)) continue;
        if (k === 'missOnly') filled[k] = ft === 'cache';
        else filled[k] = spec.default;
      }
      edgeOut.push({ from, to, ...filled });
      if (!adj.has(from)) adj.set(from, []);
      adj.get(from).push(to);
      return undefined;
    });
    // Shape rules over the valid edges.
    const touched = new Set();
    for (const k of edgeKeys) { const [a, b] = k.split('>'); touched.add(a); touched.add(b); }
    for (const id of nodes) if (!touched.has(id)) add(`topology.nodes.${id}`, 'has no edges. Expected: every node to appear in at least one edge.');
    // Cycle detection (DFS, white/grey/black).
    const colour = new Map();
    let cycleAt = null;
    const visit = (n) => {
      colour.set(n, 1);
      for (const m of adj.get(n) || []) {
        if (cycleAt) return;
        if (colour.get(m) === 1) { cycleAt = m; return; }
        if (!colour.get(m)) visit(m);
      }
      colour.set(n, 2);
    };
    for (const n of nodes) if (!colour.get(n) && !cycleAt) visit(n);
    if (cycleAt) add('topology.edges', `has a cycle through ${cycleAt}. Expected: edges that form a directed acyclic graph from clients.`);
    else if (nodes.has('clients')) {
      const seen = new Set(['clients']);
      const stack = ['clients'];
      while (stack.length) for (const m of adj.get(stack.pop()) || []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
      for (const id of nodes) if (touched.has(id) && !seen.has(id)) add(`topology.nodes.${id}`, 'is not reachable from clients. Expected: every node to be reachable from clients.');
    }
    return undefined;
  });

  // ---- path helper for effects, conditions and placeholders
  const checkPath = (p) => {
    if (typeof p !== 'string') return 'is not a path';
    let m = /^node:([a-z0-9-]+)\.([A-Za-z]+)$/.exec(p);
    if (m) {
      if (!nodes.has(m[1])) return `names ${echo(p)}, whose node is not in the topology`;
      if (!Object.hasOwn(PARAMS[NODE_TYPES[m[1]]], m[2])) return `names ${echo(p)}, which is not a parameter of a ${NODE_TYPES[m[1]]} node`;
      return null;
    }
    m = /^edge:([a-z0-9-]+)>([a-z0-9-]+)\.([A-Za-z]+)$/.exec(p);
    if (m) {
      if (!edgeKeys.has(`${m[1]}>${m[2]}`)) return `names ${echo(p)}, whose edge is not in the topology`;
      if (!Object.hasOwn(EDGE_PARAMS, m[3])) return `names ${echo(p)}, which is not an edge parameter`;
      return null;
    }
    return `is ${echo(p)}, not a parameter path`;
  };
  const paramSpecOfPath = (p) => {
    const m = /^node:([a-z0-9-]+)\.([A-Za-z]+)$/.exec(p);
    if (m) return PARAMS[NODE_TYPES[m[1]]][m[2]];
    const e = /^edge:[a-z0-9-]+>[a-z0-9-]+\.([A-Za-z]+)$/.exec(p);
    return e ? EDGE_PARAMS[e[1]] : undefined;
  };
  const faultIds = new Set();
  const cctx = { nodes, faultIds, checkPath };
  const checkCond = (field, cond) => checkCondition(cond, field, cctx, add);
  const checkTemplate = (field, text) => {
    for (const p of placeholders(text)) {
      if (p.kind === 'unknown') add(field, `has the placeholder ${echo(p.raw)}. Expected: only {tick}, {m:<node>.<metric>[|int|pct|ms]}, {p:<path>} or {rand:<a>-<b>}.`);
      else if (p.kind === 'm') {
        if (!nodes.has(p.node)) add(field, `uses {m:...} with node ${echo(p.node)}, which is not in the topology. Expected: a node id from topology.nodes.`);
        else if (!METRICS.includes(p.metric)) add(field, `uses {m:...} with metric ${echo(p.metric)}. Expected: one of ${list(METRICS)}.`);
      } else if (p.kind === 'p') {
        const why = checkPath(p.path);
        if (why) add(field, `uses {p:...} and ${why}. Expected: a path such as node:cache.hitRate.`);
      }
    }
  };

  // ---- effects
  const checkEffects = (field, effects) => {
    if (!Array.isArray(effects) || effects.length < 1 || effects.length > 8) return add(field, 'is not a list of 1 to 8 effects. Expected: an array of 1 to 8 effects.');
    effects.forEach((e, i) => {
      const f = `${field}[${i}]`;
      if (!isObj(e)) return add(f, 'is not an effect. Expected: an object with path, op and value.');
      for (const k of Object.keys(e)) if (!['path', 'op', 'value', 'ramp', 'if'].includes(k)) add(`${f}.${k}`, 'is not an effect field. Expected: one of path, op, value, ramp, if.');
      const why = checkPath(e.path);
      if (why) add(`${f}.path`, `${why}. Expected: a whitelisted path such as node:cache.hitRate.`);
      if (!['set', 'add', 'mul'].includes(e.op)) add(`${f}.op`, 'is not an operation. Expected: one of set, add, mul.');
      const spec = why ? undefined : paramSpecOfPath(e.path);
      if (typeof e.value === 'boolean') {
        if (e.op !== 'set') add(`${f}.value`, 'is a boolean with an operation other than set. Expected: booleans only with set.');
        if (spec && !spec.bool) add(`${f}.value`, 'is a boolean for a numeric parameter. Expected: a finite number.');
        if (e.ramp !== undefined) add(`${f}.ramp`, 'is set on a boolean. Expected: no ramp on booleans.');
      } else if (!isNum(e.value)) {
        add(`${f}.value`, 'is not a number or boolean. Expected: a finite number or a boolean.');
      } else if (spec && spec.bool) {
        add(`${f}.value`, 'is a number for a boolean parameter. Expected: true or false with set.');
      }
      if (e.ramp !== undefined && (!isInt(e.ramp) || e.ramp < 1 || e.ramp > 30)) add(`${f}.ramp`, 'is out of range. Expected: an integer from 1 to 30.');
      if (e.if !== undefined) checkCond(`${f}.if`, e.if);
      return undefined;
    });
    return undefined;
  };

  // ---- labels, workload, thresholds, sparks
  section('labels', () => {
    const v = get('labels');
    if (v === undefined) return;
    if (!isObj(v)) return add('labels', 'is not an object. Expected: an object of node ids to short names.');
    for (const k of Object.keys(v)) {
      if (!nodes.has(k)) add(`labels.${k}`, 'is not a node of this topology. Expected: a node id from topology.nodes.');
      else checkString(`labels.${k}`, v[k], 1, 24);
    }
  });
  section('workload', () => {
    const v = get('workload');
    const expected = 'an array of 1 to 32 pairs [tick, multiplier] with ticks rising from 0 and multipliers from 0 to 20';
    if (v === undefined) return missing('workload', expected);
    if (!Array.isArray(v) || v.length < 1 || v.length > 32) return add('workload', `is not a list of 1 to 32 points. Expected: ${expected}.`);
    let last = -1;
    v.forEach((p, i) => {
      const f = `workload[${i}]`;
      if (!Array.isArray(p) || p.length !== 2 || !isInt(p[0]) || !isNum(p[1])) return add(f, 'is not a pair. Expected: [tick, multiplier] with an integer tick and a number multiplier.');
      if (p[1] < 0 || p[1] > 20) add(f, 'has a multiplier out of range. Expected: a multiplier from 0 to 20.');
      if (i === 0 && p[0] !== 0) add(f, 'does not start at tick 0. Expected: the first point at tick 0.');
      else if (p[0] <= last) add(f, 'is not after the previous tick. Expected: strictly increasing ticks.');
      last = p[0];
      return undefined;
    });
  });
  section('thresholds', () => {
    const v = get('thresholds');
    if (v === undefined) return;
    if (!isObj(v)) return add('thresholds', 'is not an object. Expected: an object of metric to {warn, crit}.');
    for (const k of Object.keys(v)) {
      const f = `thresholds.${k}`;
      if (!THRESHOLD_KEYS.includes(k)) { add(f, `is not a threshold metric. Expected: one of ${list(THRESHOLD_KEYS)}.`); continue; }
      const t = v[k];
      if (!isObj(t) || !isNum(t.warn) || !isNum(t.crit) || Object.keys(t).length !== 2) { add(f, 'is not a pair of levels. Expected: {"warn": number, "crit": number}.'); continue; }
      if (k === 'hitRate' ? t.warn < t.crit : t.warn > t.crit) add(f, `has warn and crit in the wrong order. Expected: ${k === 'hitRate' ? 'warn at or above crit' : 'warn at or below crit'}.`);
    }
  });
  section('sparks', () => {
    const v = get('sparks');
    const expected = `an object with exactly the keys ${list(SPARK_KEYS)}, each a node id or null`;
    if (v === undefined) return missing('sparks', expected);
    if (!isObj(v)) return add('sparks', `is not an object. Expected: ${expected}.`);
    for (const k of SPARK_KEYS) if (!Object.hasOwn(v, k)) add('sparks', `has no ${k} key. Expected: ${expected}.`);
    for (const k of Object.keys(v)) {
      if (!SPARK_KEYS.includes(k)) { add('sparks', `has the extra key ${echo(k)}. Expected: ${expected}.`); continue; }
      const x = v[k];
      if (x === null) continue;
      if (!checkNode(`sparks.${k}`, x)) continue;
      if (k === 'cache-hit' && NODE_TYPES[x] !== 'cache') add(`sparks.${k}`, 'is not a cache. Expected: a cache node or null.');
    }
  });

  // ---- faults, alerts, logs, deploys
  const faultsRaw = get('faults');
  if (Array.isArray(faultsRaw)) for (const f of faultsRaw) if (isObj(f) && typeof f.id === 'string') faultIds.add(f.id);
  section('faults', () => {
    const v = faultsRaw;
    if (v === undefined) return missing('faults', 'an array of 1 to 8 faults');
    if (!Array.isArray(v) || v.length < 1 || v.length > 8) return add('faults', 'is not a list of 1 to 8 faults. Expected: an array of 1 to 8 faults.');
    const seen = new Set();
    v.forEach((fl, i) => {
      const f = `faults[${i}]`;
      if (!isObj(fl)) return add(f, 'is not a fault. Expected: an object with id, trigger and effects.');
      for (const k of Object.keys(fl)) if (!['id', 'trigger', 'effects'].includes(k)) add(`${f}.${k}`, 'is not a fault field. Expected: one of id, trigger, effects.');
      if (typeof fl.id !== 'string' || !ID_RE.test(fl.id)) add(`${f}.id`, 'is not a valid fault id. Expected: a string matching ^[a-z0-9-]{1,40}$.');
      else if (seen.has(fl.id)) add(`${f}.id`, 'repeats an earlier fault id. Expected: a unique id.');
      else seen.add(fl.id);
      const t = fl.trigger;
      if (!isObj(t)) add(`${f}.trigger`, 'is not a trigger. Expected: {"atTick": n} or {"when": condition}.');
      else {
        const hasAt = Object.hasOwn(t, 'atTick');
        const hasWhen = Object.hasOwn(t, 'when');
        const extraKeys = Object.keys(t).filter((k) => k !== 'atTick' && k !== 'when');
        if (hasAt === hasWhen || extraKeys.length) add(`${f}.trigger`, 'is not exactly one trigger. Expected: {"atTick": n} or {"when": condition}.');
        else if (hasAt) { if (!isInt(t.atTick) || t.atTick < 0 || t.atTick > maxTicks) add(`${f}.trigger.atTick`, `is out of range. Expected: an integer from 0 to ${maxTicks}.`); }
        else checkCond(`${f}.trigger.when`, t.when);
      }
      if (fl.effects === undefined) missing(`${f}.effects`, 'an array of 1 to 8 effects'); else checkEffects(`${f}.effects`, fl.effects);
      return undefined;
    });
  });
  section('alerts', () => {
    const v = get('alerts');
    if (v === undefined) return missing('alerts', 'an array of 1 to 8 alert rules');
    if (!Array.isArray(v) || v.length < 1 || v.length > 8) return add('alerts', 'is not a list of 1 to 8 rules. Expected: an array of 1 to 8 alert rules.');
    const seen = new Set();
    let page = false;
    v.forEach((a, i) => {
      const f = `alerts[${i}]`;
      if (!isObj(a)) return add(f, 'is not an alert rule. Expected: an object with id, severity, text and when.');
      for (const k of Object.keys(a)) if (!['id', 'severity', 'text', 'when', 'forTicks'].includes(k)) add(`${f}.${k}`, 'is not an alert field. Expected: one of id, severity, text, when, forTicks.');
      if (typeof a.id !== 'string' || !ID_RE.test(a.id)) add(`${f}.id`, 'is not a valid alert id. Expected: a string matching ^[a-z0-9-]{1,40}$.');
      else if (seen.has(a.id)) add(`${f}.id`, 'repeats an earlier alert id. Expected: a unique id.');
      else seen.add(a.id);
      if (!isInt(a.severity) || a.severity < 1 || a.severity > 3) add(`${f}.severity`, 'is out of range. Expected: an integer from 1 to 3.');
      else if (a.severity <= 2) page = true;
      checkString(`${f}.text`, a.text, 1, 200);
      if (a.when === undefined) missing(`${f}.when`, 'a condition'); else checkCond(`${f}.when`, a.when);
      if (a.forTicks !== undefined) checkInt(`${f}.forTicks`, a.forTicks, 1, 30);
      return undefined;
    });
    if (!page) add('alerts', 'has no severity 1 or 2 rule. Expected: at least one rule that pages (severity 1 or 2).');
  });
  section('logs', () => {
    const v = get('logs');
    if (v === undefined) return missing('logs', 'an array of 0 to 40 log templates');
    if (!Array.isArray(v) || v.length > 40) return add('logs', 'is not a list of at most 40 templates. Expected: an array of 0 to 40 log templates.');
    v.forEach((l, i) => {
      const f = `logs[${i}]`;
      if (!isObj(l)) return add(f, 'is not a log template. Expected: an object with node, level and text.');
      for (const k of Object.keys(l)) if (!['node', 'level', 'when', 'every', 'from', 'text'].includes(k)) add(`${f}.${k}`, 'is not a log field. Expected: one of node, level, when, every, from, text.');
      if (l.node === undefined) missing(`${f}.node`, 'a node id from topology.nodes'); else checkNode(`${f}.node`, l.node);
      if (!['info', 'warn', 'error'].includes(l.level)) add(`${f}.level`, 'is not a log level. Expected: one of info, warn, error.');
      if (l.when !== undefined) checkCond(`${f}.when`, l.when);
      if (l.every !== undefined) checkInt(`${f}.every`, l.every, 1, 60);
      if (l.from !== undefined) checkInt(`${f}.from`, l.from, 0, maxTicks);
      if (checkString(`${f}.text`, l.text, 1, 6000)) checkTemplate(`${f}.text`, l.text);
      return undefined;
    });
  });
  section('deploys', () => {
    const v = get('deploys');
    if (v === undefined) return;
    if (!Array.isArray(v) || v.length > 10) return add('deploys', 'is not a list of at most 10 entries. Expected: an array of 0 to 10 deploys.');
    v.forEach((d, i) => {
      const f = `deploys[${i}]`;
      if (!isObj(d)) return add(f, 'is not a deploy. Expected: an object with tick, node and text.');
      for (const k of Object.keys(d)) if (!['tick', 'node', 'text'].includes(k)) add(`${f}.${k}`, 'is not a deploy field. Expected: one of tick, node, text.');
      if (d.tick === undefined) missing(`${f}.tick`, 'an integer tick, negative for before T+0'); else if (!isInt(d.tick) || d.tick < -86400 || d.tick > maxTicks) add(`${f}.tick`, `is out of range. Expected: an integer from -86400 to ${maxTicks}.`);
      if (d.node === undefined) missing(`${f}.node`, 'a node id from topology.nodes'); else checkNode(`${f}.node`, d.node);
      checkString(`${f}.text`, d.text, 1, 200);
      return undefined;
    });
  });

  // ---- diagnostics and actions
  const checkCost = (field, v) => { if (v !== undefined) checkInt(field, v, 1, 4); };
  section('diagnostics', () => {
    const v = get('diagnostics');
    if (v === undefined) return;
    if (!isObj(v)) return add('diagnostics', 'is not an object. Expected: an object of diagnostic ids to {cost, lines}.');
    for (const k of Object.keys(v)) {
      const f = `diagnostics.${k}`;
      if (!ACTION_IDS.includes(k)) { unknownAction(f, k); continue; }
      if (!DIAG_KEYS.includes(k)) { add(f, 'is not a diagnostic with output. Expected: one of ' + `${list(DIAG_KEYS)}.`); continue; }
      const d = v[k];
      if (!isObj(d)) { add(f, 'is not an object. Expected: {"cost": 1 to 4, "lines": [templates]}.'); continue; }
      for (const dk of Object.keys(d)) if (dk !== 'cost' && dk !== 'lines') add(`${f}.${dk}`, 'is not a diagnostic field. Expected: one of cost, lines.');
      checkCost(`${f}.cost`, d.cost);
      if (d.lines !== undefined) {
        if (!Array.isArray(d.lines) || d.lines.length > 10) add(`${f}.lines`, 'is not a list of at most 10 lines. Expected: an array of 0 to 10 template strings.');
        else d.lines.forEach((t, i) => { if (checkString(`${f}.lines[${i}]`, t, 1, 300)) checkTemplate(`${f}.lines[${i}]`, t); });
      }
    }
  });
  section('actions', () => {
    const v = get('actions');
    if (v === undefined) return missing('actions', 'an object of action ids to {cost, effects}');
    if (!isObj(v)) return add('actions', 'is not an object. Expected: an object of action ids to {cost, effects}.');
    for (const k of Object.keys(v)) {
      const f = `actions.${k}`;
      if (!ACTION_IDS.includes(k)) { unknownAction(f, k); continue; }
      const a = v[k];
      if (!isObj(a)) { add(f, 'is not an object. Expected: {"cost": 1 to 4, "effects": {node: [effects]}}.'); continue; }
      for (const ak of Object.keys(a)) if (ak !== 'cost' && ak !== 'effects') add(`${f}.${ak}`, 'is not an action field. Expected: one of cost, effects.');
      checkCost(`${f}.cost`, a.cost);
      if (a.effects === undefined) continue;
      if (!isObj(a.effects)) { add(`${f}.effects`, 'is not an object. Expected: an object of node ids to effect lists.'); continue; }
      for (const n of Object.keys(a.effects)) {
        const nf = `${f}.effects.${n}`;
        if (!nodes.has(n)) { add(nf, `is not a node of this topology. Expected: a node id from topology.nodes.`); continue; }
        if (!ACTION_BY_ID[k].appliesTo.includes(NODE_TYPES[n])) {
          add(nf, `is a ${NODE_TYPES[n]}, which ${k} cannot target. Expected: a node of type ${ACTION_BY_ID[k].appliesTo.length ? ACTION_BY_ID[k].appliesTo.join(' or ') : 'none (this action has no target)'}.`);
          continue;
        }
        checkEffects(nf, a.effects[n]);
      }
    }
  });
  section('resolve', () => {
    const v = get('resolve');
    if (v === undefined) return;
    if (!isObj(v)) return add('resolve', 'is not an object. Expected: {"require": [conditions]}.');
    for (const k of Object.keys(v)) if (k !== 'require') add(`resolve.${k}`, 'is not a resolve field. Expected: require.');
    if (v.require !== undefined) {
      if (!Array.isArray(v.require) || v.require.length > 4) add('resolve.require', 'is not a list of at most 4 conditions. Expected: an array of 0 to 4 conditions.');
      else v.require.forEach((c, i) => checkCond(`resolve.require[${i}]`, c));
    }
  });

  // ---- prose, root cause, harm, optimal path, guide
  section('hint', () => { checkString('hint', get('hint'), 1, 300); });
  section('rootCause', () => { checkString('rootCause', get('rootCause'), 1, 600); });
  section('rootCauseNode', () => {
    const v = get('rootCauseNode');
    if (v === undefined) missing('rootCauseNode', 'a node id from topology.nodes'); else checkNode('rootCauseNode', v);
  });
  section('concept', () => { checkString('concept', get('concept'), 1, 600); });
  section('harmfulWhy', () => {
    const v = get('harmfulWhy');
    if (v === undefined) return missing('harmfulWhy', 'an object of fix ids to reasons (may be empty)');
    if (!isObj(v)) return add('harmfulWhy', 'is not an object. Expected: an object of fix ids to reasons (may be empty).');
    for (const k of Object.keys(v)) {
      const f = `harmfulWhy.${k}`;
      if (!ACTION_IDS.includes(k)) unknownAction(f, k);
      else if (!FIX_IDS.includes(k)) add(f, `is not a fix. Expected: one of ${list(FIX_IDS)}.`);
      else checkString(f, v[k], 1, 600);
    }
  });
  const costOf = (id) => {
    const a = own(get('actions') && isObj(get('actions')) ? get('actions') : {}, id);
    if (isObj(a) && isInt(a.cost) && a.cost >= 1 && a.cost <= 4) return a.cost;
    return DEFAULT_COST.fix;
  };
  section('optimalPath', () => {
    const v = get('optimalPath');
    if (v === undefined) return missing('optimalPath', 'an array of 1 to 4 {id, node} fixes');
    if (!Array.isArray(v) || v.length < 1 || v.length > 4) return add('optimalPath', 'is not a list of 1 to 4 steps. Expected: an array of 1 to 4 {id, node} fixes.');
    let total = 0;
    v.forEach((p, i) => {
      const f = `optimalPath[${i}]`;
      if (!isObj(p)) return add(f, 'is not a step. Expected: {"id": fix id, "node": node id}.');
      for (const k of Object.keys(p)) if (k !== 'id' && k !== 'node') add(`${f}.${k}`, 'is not a step field. Expected: one of id, node.');
      let fix = false;
      if (p.id === undefined) missing(`${f}.id`, `one of ${list(FIX_IDS)}`);
      else if (typeof p.id !== 'string' || !ACTION_IDS.includes(p.id)) unknownAction(`${f}.id`, p.id);
      else if (!FIX_IDS.includes(p.id)) add(`${f}.id`, `is a diagnostic, not a fix. Expected: one of ${list(FIX_IDS)}.`);
      else { fix = true; total += costOf(p.id); }
      if (p.node === undefined) missing(`${f}.node`, 'a node id from topology.nodes');
      else if (checkNode(`${f}.node`, p.node) && fix && !ACTION_BY_ID[p.id].appliesTo.includes(NODE_TYPES[p.node])) {
        add(`${f}.node`, `is a ${NODE_TYPES[p.node]}, which ${p.id} cannot target. Expected: a node of type ${ACTION_BY_ID[p.id].appliesTo.join(' or ')}.`);
      }
      return undefined;
    });
    if (budget !== null && total > budget) add('optimalPath', `costs ${total} pager and the budget is ${budget}. Expected: a total cost of at most the budget.`);
  });
  section('optimalSummary', () => {
    const v = get('optimalSummary');
    const expected = '{"timeToMitigate": integer, "cost": integer}';
    if (v === undefined) return missing('optimalSummary', expected);
    if (!isObj(v)) return add('optimalSummary', `is not an object. Expected: ${expected}.`);
    for (const k of Object.keys(v)) if (k !== 'timeToMitigate' && k !== 'cost') add(`optimalSummary.${k}`, `is not a summary field. Expected: ${expected}.`);
    for (const [k, lo, hi] of [['timeToMitigate', 1, 610], ['cost', 0, 48]]) {
      if (v[k] === undefined) missing(`optimalSummary.${k}`, `an integer from ${lo} to ${hi}`); else checkInt(`optimalSummary.${k}`, v[k], lo, hi);
    }
  });
  section('guideUrl', () => {
    const v = get('guideUrl');
    if (v === undefined) return missing('guideUrl', 'a URL starting with https://bytebytego.com/guides/');
    if (typeof v !== 'string') return add('guideUrl', 'is not a string. Expected: a URL starting with https://bytebytego.com/guides/.');
    if (!v.startsWith(GUIDE_PREFIX)) return add('guideUrl', `${echo(v)} is not allowed. Expected: a URL starting with ${GUIDE_PREFIX}.`);
    if (!isAllowedGuide(v)) return add('guideUrl', `${echo(v)} is not in the guide allow-list. Expected: one of the URLs in public/js/engine/guides.js.`);
    return undefined;
  });
  section('guideTitle', () => { checkString('guideTitle', get('guideTitle'), 1, 80); });

  const errors = [...unknown, ...SCENARIO_KEYS.flatMap((k) => buckets.get(k))];
  if (errors.length) return { ok: false, errors: errors.slice(0, MAX_ERRORS) };

  // ---- build the scenario with defaults filled
  for (const k of SCENARIO_KEYS) if (get(k) !== undefined) out[k] = deepCopy(get(k));
  out.maxTicks ??= 600;
  out.holdTicks ??= 5;
  out.escalateEvery ??= 90;
  out.labels ??= {};
  out.thresholds ??= {};
  out.deploys ??= [];
  out.diagnostics ??= {};
  out.resolve ??= {};
  out.resolve.require ??= [];
  out.topology = { nodes: nodeParams, edges: edgeOut };
  out.alerts = out.alerts.map((a) => ({ ...a, forTicks: a.forTicks ?? 2 }));
  out.logs = out.logs.map((l) => ({ ...l, every: l.every ?? 1 }));
  return { ok: true, scenario: deepFreeze(out) };
}
