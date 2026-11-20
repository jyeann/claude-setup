// Counterfactual classification of actions (design.md 7.3): fork A (with the action) and B (without), run 5 ticks each.
import { ACTION_BY_ID } from './catalogue.js';
import { metric } from './model.js';
import { stepRaw, canApply, firingAlerts, REVEAL_AFTER } from './engine.js';

export const HARM_DELTA = 0.25;
const EPS = 1e-9;

export function badness(state) {
  let sum = 0;
  for (const id of Object.keys(state.m)) sum += metric(state, id, 'saturation') + 5 * metric(state, id, 'errorRate');
  return sum + 2 * firingAlerts(state).length;
}

// Pure decision from the two forks. Exported so the 0.25 boundary can be tested exactly.
export function judge(badA, badB, resolvedA, resolvedB) {
  if (badA - badB >= HARM_DELTA - EPS) return 'harmful';
  if (badB - badA >= HARM_DELTA - EPS) return 'helpful';
  if (resolvedA !== null && (resolvedB === null || resolvedA < resolvedB)) return 'helpful';
  return 'none';
}

function runFork(state, actions) {
  let s = stepRaw(state, actions);
  for (let i = 1; i < REVEAL_AFTER && s.status === 'running'; i++) s = stepRaw(s, []);
  return s;
}

// Used by step: classify the last of `withActs` against `withoutActs` (the same list minus that action). cachedB may hold the fork for withoutActs.
export function classifyRun(state, withActs, withoutActs, cachedB) {
  const a = runFork(state, withActs);
  const b = cachedB || runFork(state, withoutActs);
  const effect = judge(badness(a), badness(b), a.status === 'resolved' ? a.resolvedTick : null, b.status === 'resolved' ? b.resolvedTick : null);
  return { effect, a, b };
}

export function classify(state, action) {
  const act = ACTION_BY_ID[action.id];
  if (!act) return 'none';
  if (act.kind === 'diagnostic') return 'diagnostic';
  if (!canApply(state, action.id, action.node).ok) return 'none';
  return classifyRun(state, [{ id: action.id, node: action.node }], [], null).effect;
}

// One entry per applied action, in order. effect is null until tick t+5 (or the end of the run).
export function historyEffects(state) {
  const over = state.status !== 'running';
  return state.actionLog.map((a, i) => {
    const p = state.pendingClass[i];
    const revealed = p && (over || state.tick >= p.revealAt);
    return { t: a.t, id: a.id, node: a.node, effect: revealed ? p.effect : null };
  });
}
