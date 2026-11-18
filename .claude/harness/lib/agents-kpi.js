'use strict';
// Rolls trace "agent" records up into one row per agent: runs, success, tokens, time, model and effort mix.
// Joined to the agent roster so agents that never ran still show up (a company view includes idle staff).
const fs = require('node:fs');
const path = require('node:path');
const { readSessions } = require('./trace');

function readRoster(agentsDir) {
  let files = [];
  try { files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')); } catch { return []; }
  return files.map((f) => {
    const head = fs.readFileSync(path.join(agentsDir, f), 'utf8').split(/^---\s*$/m)[1] ?? '';
    const field = (k) => (head.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) ?? [])[1]?.replace(/^["']|["']$/g, '').trim() ?? null;
    return { name: field('name') ?? f.replace(/\.md$/, ''), model: field('model'), effort: field('effort'), role: (field('description') ?? '').slice(0, 140) };
  });
}

const tally = (list) => { const m = {}; for (const v of list) m[v ?? 'default'] = (m[v ?? 'default'] ?? 0) + 1; return m; };
const sum = (xs) => xs.reduce((a, b) => a + (b ?? 0), 0);

function buildKpi(projectDir, agentsDir) {
  const runs = readSessions(projectDir).flatMap((s) => s.events.filter((e) => e.type === 'agent').map((e) => ({ ...e, session: s.id })));
  const roster = readRoster(agentsDir);
  const names = [...new Set([...roster.map((r) => r.name), ...runs.map((r) => r.agent)])].sort();
  const rows = names.map((name) => {
    const mine = runs.filter((r) => r.agent === name);
    const known = (k) => mine.map((r) => r[k]).filter((v) => v !== null);
    const r = roster.find((x) => x.name === name);
    return {
      agent: name, role: r?.role ?? '', configuredModel: r?.model ?? null, configuredEffort: r?.effort ?? null,
      runs: mine.length, failed: mine.filter((x) => !x.ok).length,
      successRate: mine.length ? (mine.length - mine.filter((x) => !x.ok).length) / mine.length : null,
      tokens: known('tokens').length ? sum(known('tokens')) : null,
      durationMs: known('durationMs').length ? sum(known('durationMs')) : null,
      toolUses: known('toolUses').length ? sum(known('toolUses')) : null,
      models: tally(mine.map((x) => x.model)), efforts: tally(mine.map((x) => x.effort)),
      lastRun: mine.length ? Math.max(...mine.map((x) => x.ts)) : null,
    };
  });
  const active = rows.filter((x) => x.runs > 0);
  const groups = new Map();
  for (const r of runs) {
    const key = `${r.model ?? 'default'}|${r.effort ?? 'not recorded'}`;
    const g = groups.get(key) ?? { model: r.model ?? 'default', effort: r.effort ?? 'not recorded', runs: 0, failed: 0, tokens: 0, durationMs: 0 };
    groups.set(key, { ...g, runs: g.runs + 1, failed: g.failed + (r.ok ? 0 : 1), tokens: g.tokens + (r.tokens ?? 0), durationMs: g.durationMs + (r.durationMs ?? 0) });
  }
  return {
    generatedAt: Date.now(),
    totals: { agents: rows.length, active: active.length, idle: rows.length - active.length, runs: sum(rows.map((x) => x.runs)), failed: sum(rows.map((x) => x.failed)), tokens: sum(rows.map((x) => x.tokens)), durationMs: sum(rows.map((x) => x.durationMs)) },
    rows,
    byEffort: [...groups.values()].sort((a, b) => b.runs - a.runs),
    recent: runs.sort((a, b) => b.ts - a.ts).slice(0, 25).map(({ ts, agent, task, ok, model, effort, tokens, durationMs }) => ({ ts, agent, task, ok, model, effort, tokens, durationMs })),
  };
}

module.exports = { buildKpi, readRoster };
