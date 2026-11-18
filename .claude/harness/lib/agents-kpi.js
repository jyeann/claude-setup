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
    // A run with neither tokens nor duration is a background launch: the host reported no outcome, so it
    // counts as "unreported", never as a success.
    const reported = mine.filter((x) => x.tokens !== null || x.durationMs !== null);
    const unreported = mine.length - reported.length;
    return {
      agent: name, role: r?.role ?? '', configuredModel: r?.model ?? null, configuredEffort: r?.effort ?? null,
      runs: mine.length, failed: mine.filter((x) => !x.ok).length, unreported,
      successRate: reported.length ? (reported.length - reported.filter((x) => !x.ok).length) / reported.length : null,
      tokens: known('tokens').length ? sum(known('tokens')) : null,
      durationMs: known('durationMs').length ? sum(known('durationMs')) : null,
      toolUses: known('toolUses').length ? sum(known('toolUses')) : null,
      models: tally(mine.map((x) => x.model)), efforts: tally(mine.map((x) => x.effort)),
      lastRun: mine.length ? Math.max(...mine.map((x) => x.ts)) : null,
    };
  });
  const active = rows.filter((x) => x.runs > 0);
  const phases = new Map();
  for (const r of runs) {
    const key = r.phase ?? 'untagged';
    const g = phases.get(key) ?? { phase: key, runs: 0, unreported: 0, failed: 0, tokens: 0, durationMs: 0 };
    const reported = r.tokens !== null || r.durationMs !== null;
    phases.set(key, { ...g, runs: g.runs + 1, unreported: g.unreported + (reported ? 0 : 1), failed: g.failed + (r.ok ? 0 : 1), tokens: g.tokens + (r.tokens ?? 0), durationMs: g.durationMs + (r.durationMs ?? 0) });
  }
  const sessions = readSessions(projectDir);
  const promptCounts = sessions.map((s) => s.events.filter((e) => e.type === 'human').length);
  const human = { sessions: promptCounts.filter((n) => n > 0).length, prompts: sum(promptCounts), interventions: sum(promptCounts.map((n) => Math.max(0, n - 1))) };
  const groups = new Map();
  for (const r of runs) {
    const key = `${r.model ?? 'default'}|${r.effort ?? 'not recorded'}`;
    const g = groups.get(key) ?? { model: r.model ?? 'default', effort: r.effort ?? 'not recorded', runs: 0, failed: 0, tokens: 0, durationMs: 0 };
    groups.set(key, { ...g, runs: g.runs + 1, failed: g.failed + (r.ok ? 0 : 1), tokens: g.tokens + (r.tokens ?? 0), durationMs: g.durationMs + (r.durationMs ?? 0) });
  }
  return {
    generatedAt: Date.now(),
    totals: { agents: rows.length, active: active.length, idle: rows.length - active.length, runs: sum(rows.map((x) => x.runs)), failed: sum(rows.map((x) => x.failed)), unreported: sum(rows.map((x) => x.unreported)), tokens: sum(rows.map((x) => x.tokens)), durationMs: sum(rows.map((x) => x.durationMs)) },
    rows,
    human,
    byPhase: [...phases.values()],
    byEffort: [...groups.values()].sort((a, b) => b.runs - a.runs),
    recent: runs.sort((a, b) => b.ts - a.ts).slice(0, 25).map(({ ts, agent, phase, task, ok, model, effort, tokens, durationMs }) => ({ ts, agent, phase: phase ?? null, task, ok, model, effort, tokens, durationMs, outcomeReported: tokens !== null || durationMs !== null })),
  };
}

module.exports = { buildKpi, readRoster };
