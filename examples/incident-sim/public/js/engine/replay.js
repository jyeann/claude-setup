// Replay a run from scenario, seed and action log.
import { createRun, step } from './engine.js';
import { metric, METRICS } from './model.js';
import { statusOf, firingAlerts } from './engine.js';

function snapshot(state) {
  const m = {};
  const statuses = {};
  for (const id of Object.keys(state.m)) {
    const row = {};
    for (const k of METRICS) row[k] = metric(state, id, k);
    m[id] = row;
    statuses[id] = statusOf(state, id);
  }
  return {
    tick: state.tick, hash: state.hash, m, statuses, firing: firingAlerts(state).map((a) => a.id), budgetLeft: state.budgetLeft, status: state.status,
  };
}

export function replay(scenario, seed, log, { snapshots = true, until } = {}) {
  let s = createRun(scenario, seed);
  const snaps = snapshots ? [snapshot(s)] : [];
  let i = 0;
  while (s.status === 'running' && (until === undefined || s.tick < until)) {
    while (i < log.length && log[i].t < s.tick) i++;
    const acts = [];
    while (i < log.length && log[i].t === s.tick) { acts.push({ id: log[i].id, node: log[i].node }); i++; }
    s = step(s, acts);
    if (snapshots) snaps.push(snapshot(s));
  }
  return { final: s, snapshots: snaps, dropped: log.length - s.actionLog.length };
}
