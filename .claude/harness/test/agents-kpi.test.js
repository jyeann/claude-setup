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

test('a [phase:x] tag in the agent description attributes the run to that phase', () => {
  const dir = project();
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: 'planner', description: '[phase:design] draft the system design' }, tool_response: { totalTokens: 100, totalDurationMs: 5 } }, 1);
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: 'planner', description: 'untagged work' }, tool_response: { totalTokens: 50, totalDurationMs: 5 } }, 2);
  const { byPhase } = buildKpi(dir, path.join(dir, 'none'));
  assert.deepEqual(byPhase.map((p) => [p.phase, p.runs, p.tokens]), [['design', 1, 100], ['untagged', 1, 50]]);
});

test('human prompts are counted by length only and every prompt after the first in a session is an intervention', () => {
  const dir = project();
  trace.logHuman(dir, { session_id: 's1', prompt: 'build me a thing' }, 1);
  trace.logHuman(dir, { session_id: 's1', prompt: 'go on' }, 2);
  trace.logHuman(dir, { session_id: 's1', prompt: 'again' }, 3);
  trace.logHuman(dir, { session_id: 's2', prompt: 'other session' }, 4);
  const { human } = buildKpi(dir, path.join(dir, 'none'));
  assert.deepEqual(human, { sessions: 2, prompts: 4, interventions: 2, recordedPrompts: 4, unclassified: 0 });
  const stored = JSON.stringify(trace.readSessions(dir));
  assert.ok(!stored.includes('build me a thing'));
  assert.ok(stored.includes('"chars":16'));
});

test('the user-prompt hook records a human event from the hook payload', () => {
  const { spawnSync } = require('node:child_process');
  const dir = project();
  const hook = path.join(__dirname, '..', 'hooks', 'user-prompt.js');
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify({ session_id: 'h1', hook_event_name: 'UserPromptSubmit', prompt: 'hello there' }), env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  assert.equal(r.status, 0);
  assert.equal(trace.readSessions(dir)[0].events[0].type, 'human');
});

test('a completion notice fills the matching unreported background run and is flagged as from a notice', () => {
  const dir = project();
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: 'architect', description: '[phase:design] design it', effort: 'high' }, tool_response: {} }, 1);
  const finals = [{ agent: 'architect', task: '[phase:design] design it', tokens: 62067, durationMs: 256673, toolUses: 11 }];
  const kpi = buildKpi(dir, path.join(dir, 'none'), { finals });
  const row = kpi.rows.find((r) => r.agent === 'architect');
  assert.equal(row.runs, 1);
  assert.equal(row.tokens, 62067);
  assert.equal(row.unreported, 0);
  assert.equal(kpi.byEffort[0].effort, 'high');
  assert.equal(kpi.byPhase[0].tokens, 62067);
});

test('a completion notice with no matching launch is added as its own run', () => {
  const dir = project();
  const finals = [{ agent: 'planner', task: '[phase:plan] plan it', phase: 'plan', effort: 'medium', model: 'opus', tokens: 40357, durationMs: 53771, toolUses: 5 }];
  const kpi = buildKpi(dir, path.join(dir, 'none'), { finals });
  assert.equal(kpi.totals.runs, 1);
  assert.equal(kpi.byPhase[0].phase, 'plan');
  assert.equal(kpi.byEffort[0].effort, 'medium');
});

test('agent hand-backs, stop-hook feedback and notifications are not counted as human prompts', () => {
  const dir = project();
  trace.logHuman(dir, { session_id: 's1', prompt: 'please build it' }, 1);
  trace.logHuman(dir, { session_id: 's1', prompt: '[Subagent hand-back] The text below is the final report' }, 2);
  trace.logHuman(dir, { session_id: 's1', prompt: 'Stop hook feedback: not done' }, 3);
  trace.logHuman(dir, { session_id: 's1', prompt: '<task-notification><status>completed</status>' }, 4);
  trace.logHuman(dir, { session_id: 's1', prompt: 'Another Claude session sent a message while you were working' }, 5);
  const { human } = buildKpi(dir, path.join(dir, 'none'));
  assert.equal(human.prompts, 1);
  assert.equal(human.interventions, 0);
  assert.equal(human.recordedPrompts, 5);
});

test('a host restart notice and other host-generated notices are not human prompts or interventions', () => {
  const dir = project();
  const restart = "This session's worker process was restarted. If your previous turn was already complete, take no action and wait for the next event. Otherwise, continue from where you left off.";
  trace.logHuman(dir, { session_id: 's1', prompt: 'build me a packing list' }, 1);
  for (const [i, prompt] of [restart, '<wake reason="external-event"><event source="github"/></wake>', '<child-session-event>failed</child-session-event>', '<webhook-payload>{}</webhook-payload>', '<system-reminder>x</system-reminder>'].entries()) {
    assert.equal(trace.promptKind(prompt), 'system', prompt);
    trace.logHuman(dir, { session_id: 's1', prompt }, 2 + i);
  }
  assert.equal(trace.promptKind('why was the worker restarted?'), 'human');
  const { human } = buildKpi(dir, path.join(dir, 'none'));
  assert.deepEqual([human.prompts, human.interventions, human.recordedPrompts], [1, 0, 6]);
});

test('events recorded before prompts were classified are reported as unclassified, not as human', () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, '.harness', 'traces'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.harness', 'traces', 's1.jsonl'), '{"type":"human","ts":1,"chars":162}\n{"type":"human","ts":2,"chars":4000}\n');
  const { human } = buildKpi(dir, path.join(dir, 'none'));
  assert.deepEqual([human.prompts, human.interventions, human.unclassified, human.recordedPrompts], [0, 0, 2, 2]);
});

// --- cost of backgrounded agents, from the SubagentStop hook ---
const { spawnSync: spawnHook } = require('node:child_process');
const { summarizeTranscript } = require('../lib/subagent-usage');
const iso = (ms) => new Date(Date.UTC(2026, 10, 20, 6, 0, 0) + ms).toISOString();
// A transcript as the host writes it: one assistant record per content block, the same usage on each.
function transcript(dir, name = 'agent-a1.jsonl') {
  const usage = (i, o, w, r) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: w, cache_read_input_tokens: r });
  const lines = [
    { type: 'user', timestamp: iso(0), message: { role: 'user', content: 'go' } },
    { type: 'assistant', timestamp: iso(1000), message: { id: 'm1', model: 'claude-sonnet-5-5', usage: usage(10, 20, 100, 0), content: [{ type: 'thinking' }] } },
    { type: 'assistant', timestamp: iso(1100), message: { id: 'm1', model: 'claude-sonnet-5-5', usage: usage(10, 20, 100, 0), content: [{ type: 'tool_use', id: 't1', name: 'Read' }] } },
    { type: 'user', timestamp: iso(2000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1' }] } },
    { type: 'assistant', timestamp: iso(61000), message: { id: 'm2', model: 'claude-sonnet-5-5', usage: usage(5, 40, 0, 130), content: [{ type: 'text', text: 'done' }] } },
  ];
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\nnot json\n`);
  return file;
}

test('a subagent transcript is summed once per message, with duration and tool calls', () => {
  const dir = project();
  const s = summarizeTranscript(transcript(dir));
  assert.deepEqual(s, { tokens: 10 + 20 + 100 + 5 + 40 + 130, inputTokens: 115, outputTokens: 60, cacheReadTokens: 130, durationMs: 61000, toolUses: 1, models: ['claude-sonnet-5-5'] });
  assert.equal(summarizeTranscript(path.join(dir, 'missing.jsonl')), null);
  assert.equal(summarizeTranscript(undefined), null);
  fs.writeFileSync(path.join(dir, 'empty.jsonl'), '');
  assert.equal(summarizeTranscript(path.join(dir, 'empty.jsonl')), null);
  assert.equal(summarizeTranscript(path.join(dir, 'agent-a1.txt')), null);
});

test('a background run gets its tokens and time from the SubagentStop record, with no hand-typed figures', () => {
  const dir = project();
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: 'architect', description: '[phase:design] design it', effort: 'low' }, tool_response: { status: 'async_launched', agentId: 'a1' } }, 1);
  const hook = path.join(__dirname, '..', 'hooks', 'subagent-stop.js');
  const event = { session_id: 's1', hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'architect', agent_transcript_path: transcript(dir) };
  assert.equal(spawnHook(process.execPath, [hook], { input: JSON.stringify(event), env: { ...process.env, CLAUDE_PROJECT_DIR: dir } }).status, 0);
  const kpi = buildKpi(dir, path.join(dir, 'none'));
  const row = kpi.rows.find((r) => r.agent === 'architect');
  assert.deepEqual([row.runs, row.unreported, row.tokens, row.durationMs, row.toolUses], [1, 0, 305, 61000, 1]);
  assert.equal(kpi.byPhase.find((p) => p.phase === 'design').tokens, 305);
  assert.deepEqual(kpi.unreportedRuns, []);
});

test('SubagentStop: internal agents and runs the hook cannot read are not added; a foreground run keeps its own figures; the latest stop wins', () => {
  const dir = project();
  const hook = path.join(__dirname, '..', 'hooks', 'subagent-stop.js');
  const send = (event) => spawnHook(process.execPath, [hook], { input: JSON.stringify({ session_id: 's1', ...event }), env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  trace.logToolEvent(dir, agentCall('tdd-guide', { tool_response: { totalTokens: 1200, totalDurationMs: 3000, totalToolUseCount: 4, agentId: 'fg1' } }), 1);
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: 'planner', description: 'plan' }, tool_response: { status: 'async_launched', agentId: 'bg1' } }, 2);
  const file = transcript(dir);
  send({ agent_id: 'x', agent_type: '', agent_transcript_path: file });
  send({ agent_id: 'fg1', agent_type: 'tdd-guide', agent_transcript_path: file });
  send({ agent_id: 'bg1', agent_type: 'planner', agent_transcript_path: path.join(dir, 'gone.jsonl') });
  let kpi = buildKpi(dir, path.join(dir, 'none'));
  assert.equal(kpi.rows.find((r) => r.agent === 'tdd-guide').tokens, 1200);
  assert.equal(kpi.rows.find((r) => r.agent === 'planner').unreported, 1);
  assert.equal(kpi.totals.runs, 2);
  assert.deepEqual(kpi.unreportedRuns.map((r) => r.agent), ['planner']);
  // The agent is resumed and stops again: the newer record wins, and an unreadable one earlier did not block it.
  send({ agent_id: 'bg1', agent_type: 'planner', agent_transcript_path: file });
  kpi = buildKpi(dir, path.join(dir, 'none'));
  assert.equal(kpi.rows.find((r) => r.agent === 'planner').tokens, 305);
  assert.equal(kpi.unreportedRuns.length, 0);
});

test('a SubagentStop record without a launch record is matched by agent type, or added as its own run', () => {
  const dir = project();
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: 'architect', description: 'old run' }, tool_response: {} }, 1);
  trace.logSubagentFinal(dir, { session_id: 's1', agent_id: 'n1', agent_type: 'architect' }, { tokens: 50, durationMs: 9, toolUses: 1 }, 5);
  trace.logSubagentFinal(dir, { session_id: 's1', agent_id: 'n2', agent_type: 'reviewer' }, { tokens: 70, durationMs: 8, toolUses: 2 }, 6);
  const kpi = buildKpi(dir, path.join(dir, 'none'));
  assert.equal(kpi.rows.find((r) => r.agent === 'architect').tokens, 50);
  assert.equal(kpi.rows.find((r) => r.agent === 'architect').runs, 1);
  assert.equal(kpi.rows.find((r) => r.agent === 'reviewer').tokens, 70);
});

test('agents-kpi.js warns on stderr and names each run that still has no cost figures', () => {
  const dir = project();
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: 'architect', description: '[phase:design] design it' }, tool_response: { status: 'async_launched' } }, 1);
  const r = spawnHook(process.execPath, [path.join(__dirname, '..', 'bin', 'agents-kpi.js')], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /WARNING: 1 agent run\(s\) have no cost figures/);
  assert.match(r.stderr, /architect \[design\] \[phase:design\] design it/);
  assert.deepEqual(JSON.parse(r.stdout).unreportedRuns.map((x) => x.agent), ['architect']);
});
