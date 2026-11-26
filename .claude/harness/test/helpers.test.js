'use strict';
// #86: the Stop hook holds a turn that ends while helper agents the session started in the background still run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runningHelpers, holdForHelpers, MAX_AGE_MS } = require('../lib/helpers');

const HOOKS = path.join(__dirname, '..', 'hooks');
const CLI = path.join(__dirname, '..', 'bin', 'harness.js');
const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-helpers-'));
const hook = (name, dir, event) => spawnSync('node', [path.join(HOOKS, name)], {
  input: typeof event === 'string' ? event : JSON.stringify(event), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
});
const cli = (dir, ...args) => spawnSync('node', [CLI, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
const state = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.harness', 'state.json'), 'utf8'));

// What Claude Code sends: a background Agent call returns at once with status async_launched and its agentId.
const launch = (dir, id, extra = {}) => hook('post-tool.js', dir, {
  hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Agent',
  tool_input: { subagent_type: 'code-reviewer', description: '[phase:review] review the diff', run_in_background: true },
  tool_response: { status: 'async_launched', agentId: id, description: 'review the diff', outputFile: '' },
  ...extra,
});
const finished = (dir, id) => hook('subagent-stop.js', dir, { hook_event_name: 'SubagentStop', session_id: 's1', agent_id: id, agent_type: 'code-reviewer', stop_hook_active: false });
const stop = (dir, extra = {}) => hook('stop.js', dir, { hook_event_name: 'Stop', session_id: 's1', ...extra });
const holdReason = (r) => (r.stdout ? JSON.parse(r.stdout).reason : '');

// --- which helpers are running, from the trace ---

const bg = (id, ts = 1000) => ({ type: 'agent', ts, id, background: true, agent: 'planner', task: 'plan it' });

test('a background launch with no end record is a running helper', () => {
  assert.deepEqual(runningHelpers([bg('a1')], 2000).map((h) => h.id), ['a1']);
});

test('a helper with an end record, a foreground run, or a stopped task is not running', () => {
  const events = [
    bg('a1'), { type: 'agent-end', ts: 1500, id: 'a1' },
    { type: 'agent', ts: 1000, id: 'f1', background: false },
    { type: 'agent', ts: 1000, agent: 'old record without id' },
    bg('a2'), { type: 'agent-end', ts: 1600, id: 'a2', via: 'TaskStop' },
  ];
  assert.deepEqual(runningHelpers(events, 2000), []);
});

test('a launch older than the age limit no longer counts, so a lost end record cannot hold forever', () => {
  assert.deepEqual(runningHelpers([bg('a1', 0)], MAX_AGE_MS + 1), []);
});

test('the helper check logs its own error and never holds on it', () => {
  const dir = project();
  const hold = holdForHelpers(dir, { session_id: 's1' }, { readEvents: () => { throw new Error('boom'); } });
  assert.equal(hold, null);
  assert.match(fs.readFileSync(path.join(dir, '.harness', 'hook-errors.jsonl'), 'utf8'), /helpers.*boom/);
});

test('no hold without a session id or on the stop hook\'s own second firing', () => {
  const read = () => [bg('a1', Date.now())];
  assert.equal(holdForHelpers(project(), {}, { readEvents: read }), null);
  assert.equal(holdForHelpers(project(), { session_id: 's1', stop_hook_active: true }, { readEvents: read }), null);
  assert.match(holdForHelpers(project(), { session_id: 's1' }, { readEvents: read }), /still running/);
});

// --- trace records ---

test('the trace records the agent id and whether the run went to the background', () => {
  const dir = project();
  launch(dir, 'agent-7');
  hook('post-tool.js', dir, { hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Agent', tool_input: { description: 'fg' }, tool_response: { agentId: 'agent-8', totalTokens: 10 } });
  const lines = fs.readFileSync(path.join(dir, '.harness', 'traces', 's1.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const agents = lines.filter((l) => l.type === 'agent');
  assert.deepEqual(agents.map((a) => [a.id, a.background]), [['agent-7', true], ['agent-8', false]]);
});

test('the SubagentStop hook records the end and never blocks, even on bad input', () => {
  const dir = project();
  const r = finished(dir, 'agent-7');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const line = JSON.parse(fs.readFileSync(path.join(dir, '.harness', 'traces', 's1.jsonl'), 'utf8').trim());
  assert.deepEqual([line.type, line.id], ['agent-end', 'agent-7']);
  const bad = hook('subagent-stop.js', dir, '{bad');
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout, '');
});

test('a successful TaskStop on a helper counts as its end', () => {
  const dir = project();
  launch(dir, 'agent-9');
  hook('post-tool.js', dir, { hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'TaskStop', tool_input: { task_id: 'agent-9' }, tool_response: {} });
  assert.equal(stop(dir).stdout, '');
});

// --- the Stop hook, outside a harness run ---

test('stop holds the turn once while a helper runs, and says to wait for it', () => {
  const dir = project();
  launch(dir, 'agent-1');
  const first = stop(dir);
  assert.equal(first.status, 0);
  assert.equal(JSON.parse(first.stdout).decision, 'block');
  assert.match(holdReason(first), /1 helper agent.*still running.*code-reviewer.*review the diff/s);
  assert.match(holdReason(first), /[Ww]ait/);
  assert.equal(stop(dir, { stop_hook_active: true }).stdout, '', 'the hold never repeats on its own continuation');
});

test('stop lets the turn end once every helper has finished', () => {
  const dir = project();
  launch(dir, 'agent-1');
  finished(dir, 'agent-1');
  assert.equal(stop(dir).stdout, '');
});

test('a helper started in another session does not hold this one', () => {
  const dir = project();
  launch(dir, 'agent-1', { session_id: 'other' });
  assert.equal(stop(dir).stdout, '');
});

// --- the Stop hook, inside a harness run ---

test('in a run, a stop while a helper runs holds without consuming an iteration', () => {
  const dir = project();
  assert.equal(cli(dir, 'init', '--verify', 'exit 1', '--no-checkpoint', '--no-diagnosis').status, 0);
  const before = state(dir);
  launch(dir, 'agent-1');
  const held = stop(dir);
  assert.match(holdReason(held), /still running/);
  assert.doesNotMatch(holdReason(held), /verify command failed/);
  assert.deepEqual(state(dir), before, 'the run state is untouched');
  finished(dir, 'agent-1');
  const next = stop(dir);
  assert.match(holdReason(next), /verify command failed/);
  assert.equal(state(dir).iteration, before.iteration + 1);
});

test('in a run, a passing verify does not end the run while a helper still runs', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'true', '--no-checkpoint');
  launch(dir, 'agent-1');
  assert.match(holdReason(stop(dir)), /still running/);
  assert.equal(state(dir).active, true);
});

test('the helper hold never applies at an owner gate where the pipeline reports waiting', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, 'pipeline.js'), "console.log('waiting for owner: spec issue #37 needs label spec-approved'); process.exit(3);\n");
  const st = { active: true, status: 'running', iteration: 0, maxIterations: 3, stallLimit: 3, stallCount: 0, history: [], verifyCommand: 'node pipeline.js check', checkpoint: false };
  fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.harness', 'state.json'), JSON.stringify(st));
  launch(dir, 'agent-1');
  const first = stop(dir);
  assert.match(holdReason(first), /owner gate/);
  assert.doesNotMatch(holdReason(first), /still running/);
  const second = stop(dir);
  assert.equal(second.stdout, '', 'the gate lets the turn end');
  assert.equal(state(dir).status, 'waiting-for-owner');
});

test('settings register the SubagentStop hook', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'settings.json'), 'utf8'));
  const cmds = (settings.hooks.SubagentStop ?? []).flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(cmds.some((c) => c.includes('subagent-stop.js')));
});
