// Per-tick physics (design.md 3.2) with the spec deviations: saturation is clamp(rho, 0, 1), no backlog override.
// Only + - * / and Math.sqrt|min|max|floor|ceil|round|abs are used. Integer powers are loops.
import { NODE_TYPES } from './catalogue.js';

export const METRICS = Object.freeze(['p50', 'p99', 'errorRate', 'saturation', 'queue', 'hitRate', 'rps', 'missRps', 'connections']);
const INT_METRICS = { p50: 1, p99: 1, queue: 1, rps: 1, missRps: 1, connections: 1 };

export const q4 = (x) => Math.round(x * 10000) / 10000;

// Quantised read of one metric of one node. hitRate is null off the cache.
export function metric(state, nodeId, name) {
  const m = state.m[nodeId];
  if (!m) return null;
  const v = m[name];
  if (v === null || v === undefined) return null;
  return INT_METRICS[name] === 1 ? Math.round(v) : q4(v);
}

export function retryAmplification(errorRate, retries, backoff) {
  const eps = Math.min(0.95, Math.max(0, errorRate));
  let term = 1;
  let a = 1;
  for (let i = 1; i <= retries; i++) {
    term *= eps;
    a += term;
  }
  return backoff ? 1 + (a - 1) * 0.25 : a;
}

const powInt = (x, n) => {
  let r = 1;
  for (let i = 0; i < n; i++) r *= x;
  return r;
};
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export const edgeKey = (from, to) => `${from}>${to}`;

// Static structure of a scenario: topological order and adjacency. Pure function of the scenario.
export function compileTopology(sc) {
  const ids = Object.keys(sc.topology.nodes);
  const type = {};
  for (const id of ids) type[id] = NODE_TYPES[id];
  const edges = sc.topology.edges.map((e) => ({
    key: edgeKey(e.from, e.to), from: e.from, to: e.to,
    repl: type[e.from] === 'db' && type[e.to] === 'db',
    async: type[e.from] === 'queue',
  }));
  const inE = {};
  const outE = {};
  for (const id of ids) { inE[id] = []; outE[id] = []; }
  for (const e of edges) { outE[e.from].push(e); inE[e.to].push(e); }
  // Kahn's algorithm; ties broken by document order of the nodes.
  const indeg = {};
  for (const id of ids) indeg[id] = inE[id].length;
  const topo = [];
  const ready = ids.filter((id) => indeg[id] === 0);
  while (ready.length) {
    const id = ready.shift();
    topo.push(id);
    for (const e of outE[id]) if (--indeg[e.to] === 0) ready.push(e.to);
    ready.sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
  }
  return { ids, type, edges, inE, outE, topo, clients: topo.filter((id) => type[id] === 'client') };
}

function breakerOpenFactor(ep, breakers, key) {
  if (!ep || !ep.breaker) return 1;
  const b = breakers[key];
  if (!b || b.state === 'closed') return 1;
  return b.state === 'open' ? 0 : 0.1;
}

// Compute the metrics of the next tick. prev is the previous metrics map, wMult the workload multiplier, us one draw per client.
// Returns {m, flow}: m[node] holds full-precision values, flow[edgeKey] the requests per second on each edge.
export function computeTick(T, params, edgeParams, prev, breakers, wMult, us) {
  const m = {};
  const flow = {};
  const mu = {};
  const lamOf = {};
  const own50 = {};
  const own99 = {};
  const seen50 = {};
  const seen99 = {};
  const extra = {};
  const rhoOf = {};
  const bl = {};
  const connsOf = {};

  for (const id of T.topo) {
    const type = T.type[id];
    if (type === 'client') continue;
    const p = params[id];
    let cap = p.capacity * p.instances * p.capFactor;
    if (p.workers > 0) cap = Math.min(cap, (p.workers * p.instances * 1000) / Math.max(1, prev[id].p50));
    mu[id] = cap;
  }

  let ci = 0;
  for (const id of T.topo) {
    const type = T.type[id];
    const p = params[id];
    let lambda = 0;
    let out = 0;
    if (type === 'client') {
      const u = us[ci++];
      lambda = p.rps * wMult * (1 + 0.02 * (2 * u - 1));
      out = lambda;
      lamOf[id] = lambda;
      extra[id] = 0;
      own50[id] = 0;
      own99[id] = 0;
      bl[id] = 0;
      rhoOf[id] = 0;
    } else {
      for (const e of T.inE[id]) if (!e.repl) lambda += flow[e.key];
      lamOf[id] = lambda;
      const pm = prev[id];
      const muN = mu[id];
      let eConn = 0;
      let eSplit = 0;
      let eDrop = 0;
      let conns = 0;
      let rho;
      let backlog;
      let wait;
      let q;
      if (type === 'queue') {
        let muC = 0;
        for (const e of T.outE[id]) muC += mu[e.to] === undefined ? 0 : mu[e.to];
        const avail = pm.queue + lambda;
        const drain = Math.min(avail, muC);
        const rawDepth = avail - drain;
        const dropped = Math.max(0, rawDepth - p.maxDepth);
        backlog = Math.min(rawDepth, p.maxDepth);
        out = drain;
        eDrop = lambda > 0 ? dropped / lambda : 0;
        rho = muN > 0 ? lambda / muN : lambda > 0 ? 1 : 0;
        q = 1 / (1 - Math.min(rho, 0.95));
        wait = (1000 * backlog) / Math.max(1, drain);
        rhoOf[id] = backlog / p.maxDepth;
        seen50[id] = p.baseMs * q + p.extraMs;
        seen99[id] = 3 * p.baseMs * q + p.extraMs;
      } else {
        let lamEff = lambda;
        if (type === 'cache') lamEff = lambda + p.missCost * lambda * (1 - p.hitRate);
        let rhoConn = 0;
        if (type === 'db') {
          for (const e of T.inE[id]) {
            if (e.repl) continue;
            const sp = params[e.from];
            if (sp && sp.poolSize > 0) conns += sp.instances * sp.poolSize;
          }
          rhoConn = p.connOverhead * conns;
          if (conns > p.maxConnections) eConn = (conns - p.maxConnections) / conns;
          eSplit = (p.writers - 1) * p.conflictRate;
        }
        rho = muN > 0 ? lamEff / muN + rhoConn : lamEff > 0 ? 1 : 0;
        if (type === 'db' && p.shards > 1) {
          const hot = p.hotShare === undefined ? 1 / p.shards : p.hotShare;
          const rhoHot = muN > 0 ? (lambda * hot) / (muN / p.shards) : lamEff > 0 ? 1 : 0;
          rho = Math.max(rho, rhoHot + rhoConn);
        }
        const avail = pm.queue + lamEff;
        const processed = Math.min(avail, muN);
        const leftover = avail - processed;
        const cap = p.backlogMax === undefined ? 0 : p.backlogMax;
        backlog = Math.min(leftover, cap);
        const dropped = leftover - backlog;
        out = lamEff > 0 ? (processed * lambda) / lamEff : processed;
        eDrop = lamEff > 0 ? dropped / lamEff : 0;
        q = 1 / (1 - Math.min(rho, 0.95));
        wait = muN > 0 ? (1000 * backlog) / muN : 0;
        rhoOf[id] = rho;
      }
      bl[id] = backlog;
      own50[id] = p.baseMs * q + p.extraMs + wait;
      own99[id] = 3 * p.baseMs * q + p.extraMs + 1.5 * wait;
      extra[id] = (p.errorBase === undefined ? 0 : p.errorBase) + eDrop + eConn + eSplit;
      if (type === 'lb') out = out * (1 - p.shed);
      connsOf[id] = conns;
    }
    // Outgoing edge flows.
    let poolNeed = 0;
    for (const e of T.outE[id]) {
      const ep = edgeParams[e.key];
      const miss = ep.missOnly ? 1 - (params[id].hitRate === undefined ? 0 : params[id].hitRate) : 1;
      if (e.repl) { flow[e.key] = out * ep.calls * ep.share; continue; }
      let f;
      if (e.async) {
        f = out * ep.calls * ep.share;
      } else {
        const amp = retryAmplification(prev[e.to].errorRate, ep.retries, ep.backoff);
        f = out * ep.calls * ep.share * miss * amp * breakerOpenFactor(ep, breakers, e.key);
        if (T.type[e.to] === 'db' && prev[e.to]) poolNeed += (f * prev[e.to].p50) / 1000;
      }
      flow[e.key] = f;
    }
    if (type !== 'client' && type !== 'queue' && params[id].poolSize > 0) {
      const pool = params[id].instances * params[id].poolSize;
      if (poolNeed > pool) extra[id] += (poolNeed - pool) / poolNeed;
    }
  }

  // Pass 2: latency and errors bubble up in reverse topological order.
  for (let i = T.topo.length - 1; i >= 0; i--) {
    const id = T.topo[i];
    const type = T.type[id];
    const p = params[id];
    let p50 = own50[id];
    let p99 = own99[id];
    let err = extra[id];
    for (const e of T.outE[id]) {
      if (e.repl || e.async) continue;
      const ep = edgeParams[e.key];
      const miss = ep.missOnly ? 1 - (p.hitRate === undefined ? 0 : p.hitRate) : 1;
      const wn = ep.calls * ep.share * miss;
      const open = breakerOpenFactor(ep, breakers, e.key);
      const wo = wn * open;
      if (open === 0) {
        if (!ep.fallback) err += Math.min(1, wn);
        continue;
      }
      p50 += wo * seen50[e.to];
      p99 += wo >= 1 ? (wo - 1) * seen50[e.to] + seen99[e.to] : wo * seen99[e.to];
      err += Math.min(1, wo) * powInt(m[e.to].errorRate, ep.retries + 1);
    }
    p50 = clamp(p50, 0, 30000);
    p99 = Math.min(30000, Math.max(p99, p50));
    const tm = p.timeoutMs;
    if (tm !== undefined && p99 > tm) err += Math.min(1, (p99 - tm) / (2 * tm));
    m[id] = {
      p50, p99,
      errorRate: clamp(err, 0, 1),
      saturation: clamp(rhoOf[id], 0, 1),
      queue: bl[id],
      hitRate: type === 'cache' ? p.hitRate : null,
      rps: lamOf[id],
      missRps: type === 'cache' ? lamOf[id] * (1 - p.hitRate) : 0,
      connections: connsOf[id] || 0,
    };
    if (type !== 'queue') { seen50[id] = p50; seen99[id] = p99; }
  }
  return { m, flow };
}

// Advance each breaker one tick from this tick's metrics. Returns a new map holding only edges with a breaker.
export function nextBreakers(T, params, edgeParams, breakers, m) {
  const out = {};
  for (const e of T.edges) {
    const ep = edgeParams[e.key];
    if (!ep || !ep.breaker) continue;
    const b = breakers[e.key] || { state: 'closed', left: 0 };
    const c = m[e.to];
    const tm = params[e.to] && params[e.to].timeoutMs !== undefined ? params[e.to].timeoutMs : 3000;
    let state = b.state;
    let left = b.left;
    if (state === 'closed') {
      if (c.errorRate >= 0.5 || c.p99 >= tm) { state = 'open'; left = 5; }
    } else if (state === 'open') {
      left -= 1;
      if (left <= 0) { state = 'half'; left = 1; }
    } else if (c.errorRate < 0.2) {
      state = 'closed'; left = 0;
    } else {
      state = 'open'; left = 5;
    }
    out[e.key] = { state, left };
  }
  return out;
}
