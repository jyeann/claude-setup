// Optimal-path search (design.md section 9). Authoring and test tool: never runs in the browser at play time.
import { createRun, stepRaw, canApply } from './engine.js';
import { ACTIONS } from './catalogue.js';

export function schedule(firstPage, path, gap = 2) {
  return path.map((p, k) => ({ t: firstPage + gap * k, id: p.id, node: p.node }));
}

// Run with no actions until the first severity 1-2 alert fires. Returns the state at that tick or null when it never fires.
function pageState(scenario, seed) {
  let s = createRun(scenario, seed);
  while (s.status === 'running' && s.firstPageTick === null) s = stepRaw(s, []);
  return s.firstPageTick === null ? null : s;
}

export function firstPageTick(scenario, seed) {
  const s = pageState(scenario, seed);
  return s === null ? null : s.firstPageTick;
}

export function solve(scenario, { seed = scenario.seed, maxDepth = 4 } = {}) {
  const base = pageState(scenario, seed);
  if (base === null) return { path: null, summary: null, explored: 0 };
  const candidates = [];
  for (const a of ACTIONS) {
    if (a.kind !== 'fix') continue;
    const fx = scenario.actions[a.id] && scenario.actions[a.id].effects;
    if (!fx) continue;
    for (const node of Object.keys(fx)) if (fx[node].length > 0) candidates.push({ id: a.id, node, cost: scenario.actions[a.id].cost ?? 2 });
  }
  let best = null;
  let explored = 0;
  const keyOf = (path) => path.map((p) => `${p.id}@${p.node}`).join(',');
  const better = (cand) => {
    if (best === null) return true;
    if (cand.time !== best.time) return cand.time < best.time;
    if (cand.cost !== best.cost) return cand.cost < best.cost;
    if (cand.path.length !== best.path.length) return cand.path.length < best.path.length;
    return keyOf(cand.path) < keyOf(best.path);
  };

  // State is the run at tick firstPage + 2 * path.length, before the next action of the schedule.
  const rec = (state, path, cost, depth) => {
    for (const c of candidates) {
      if (path.some((p) => p.id === c.id && p.node === c.node)) continue;
      if (cost + c.cost > scenario.budget) continue;
      if (!canApply(state, c.id, c.node).ok) continue;
      const nextPath = [...path, { id: c.id, node: c.node }];
      let s = stepRaw(state, [{ id: c.id, node: c.node }]);
      if (nextPath.length < depth) {
        if (s.status !== 'running') continue; // resolved or ended here: a shorter path already covers it
        s = stepRaw(s, []);
        if (s.status !== 'running') continue;
        rec(s, nextPath, cost + c.cost, depth);
        continue;
      }
      explored++;
      while (s.status === 'running' && (best === null || s.tick < best.time)) s = stepRaw(s, []);
      if (s.status !== 'resolved') continue;
      const cand = { path: nextPath, time: s.resolvedTick, cost: cost + c.cost };
      if (better(cand)) best = cand;
    }
  };

  for (let depth = 1; depth <= maxDepth; depth++) rec(base, [], 0, depth);
  if (best === null) return { path: null, summary: null, explored };
  return { path: best.path, summary: { timeToMitigate: best.time, cost: best.cost }, explored };
}
