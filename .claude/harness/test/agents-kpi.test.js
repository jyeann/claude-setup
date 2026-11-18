'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const trace = require('../lib/trace');
const { buildKpi, readRoster } = require('../lib/agents-kpi');

const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-kpi-'));
const agentCall = (type, extra = {}) => ({ session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: type, description: 'do it', model: 'sonnet', effort: 'high' }, tool_response: { totalTokens: 1200, totalDurationMs: 3000, totalToolUseCount: 4 }, ...extra });

test('an Agent tool call also writes an agent record with model, effort, tokens and duration', () => {
  const dir = project();
  trace.logToolEvent(dir, agentCall('tdd-guide'), 10);
  const events = trace.readSessions(dir)[0].events;
  const run = events.find((e) => e.type === 'agent');
  assert.deepEqual({ agent: run.agent, model: run.model, effort: run.effort, tokens: run.tokens, durationMs: run.durationMs, toolUses: run.toolUses, ok: run.ok },
    { agent: 'tdd-guide', model: 'sonnet', effort: 'high', tokens: 1200, durationMs: 3000, toolUses: 4, ok: true });
});

test('fields the host does not send stay null instead of being guessed', () => {
  const dir = project();
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Task', tool_input: {}, tool_response: {} }, 10);
  const run = trace.readSessions(dir)[0].events.find((e) => e.type === 'agent');
  assert.equal(run.agent, 'general-purpose');
  assert.equal(run.tokens, null);
  assert.equal(run.durationMs, null);
});

test('non-agent tools write no agent record', () => {
  const dir = project();
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } }, 10);
  assert.equal(trace.readSessions(dir)[0].events.filter((e) => e.type === 'agent').length, 0);
});

test('KPI roll-up counts runs and failures per agent and lists idle roster agents with zero runs', () => {
  const dir = project();
  const agents = path.join(dir, 'agents');
  fs.mkdirSync(agents);
  fs.writeFileSync(path.join(agents, 'tdd-guide.md'), '---\nname: tdd-guide\ndescription: writes tests\nmodel: sonnet\n---\nbody');
  fs.writeFileSync(path.join(agents, 'planner.md'), '---\nname: planner\ndescription: plans\nmodel: opus\neffort: high\n---\nbody');
  trace.logToolEvent(dir, agentCall('tdd-guide'), 10);
  trace.logToolEvent(dir, agentCall('tdd-guide', { hook_event_name: 'PostToolUseFailure' }), 20);
  const kpi = buildKpi(dir, agents);
  const tdd = kpi.rows.find((r) => r.agent === 'tdd-guide');
  const planner = kpi.rows.find((r) => r.agent === 'planner');
  assert.equal(tdd.runs, 2);
  assert.equal(tdd.failed, 1);
  assert.equal(tdd.successRate, 0.5);
  assert.equal(tdd.tokens, 2400);
  assert.equal(planner.runs, 0);
  assert.equal(planner.configuredEffort, 'high');
  assert.equal(kpi.totals.idle, 1);
  assert.equal(kpi.totals.active, 1);
});

test('runs are grouped by model and effort, with unrecorded effort kept as its own group', () => {
  const dir = project();
  trace.logToolEvent(dir, agentCall('a'), 1);
  trace.logToolEvent(dir, agentCall('b'), 2);
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: 'c', model: 'opus' }, tool_response: { totalTokens: 10 } }, 3);
  const { byEffort } = buildKpi(dir, path.join(dir, 'none'));
  assert.deepEqual(byEffort.map((g) => [g.model, g.effort, g.runs, g.tokens]), [['sonnet', 'high', 2, 2400], ['opus', 'not recorded', 1, 10]]);
});

test('a background launch with no tokens or duration counts as unreported, not as a success', () => {
  const dir = project();
  trace.logToolEvent(dir, agentCall('tdd-guide'), 1);
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: 'tdd-guide' }, tool_response: {} }, 2);
  const { rows, totals, recent } = buildKpi(dir, path.join(dir, 'none'));
  const row = rows.find((r) => r.agent === 'tdd-guide');
  assert.equal(row.runs, 2);
  assert.equal(row.unreported, 1);
  assert.equal(row.successRate, 1);
  assert.equal(totals.unreported, 1);
  assert.deepEqual(recent.map((r) => r.outcomeReported), [false, true]);
});

test('an agent whose runs are all unreported has no success rate', () => {
  const dir = project();
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: 'x' }, tool_response: {} }, 1);
  assert.equal(buildKpi(dir, path.join(dir, 'none')).rows[0].successRate, null);
});

test('roster reader returns an empty list when the agents directory is missing', () => {
  assert.deepEqual(readRoster(path.join(os.tmpdir(), 'no-such-agents-dir-xyz')), []);
});
