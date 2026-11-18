'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'hooks');
const CLI = path.join(__dirname, '..', 'bin', 'harness.js');

const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-e2e-'));
const run = (script, projectDir, event) => spawnSync('node', [script], {
  input: JSON.stringify(event),
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
});
const cli = (projectDir, ...args) => spawnSync('node', [CLI, ...args], {
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
});
const bash = (projectDir, command) => run(path.join(HOOKS, 'pre-bash.js'), projectDir, { tool_name: 'Bash', tool_input: { command } });
const stop = (projectDir) => run(path.join(HOOKS, 'stop.js'), projectDir, { hook_event_name: 'Stop' });
const state = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.harness', 'state.json'), 'utf8'));

test('pre-bash exits 2 with a reason for a blocked command', () => {
  const r = bash(project(), 'git push --force origin x');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /BLOCKED/);
});

test('pre-bash allows an ordinary command', () => {
  assert.equal(bash(project(), 'ls -la').status, 0);
});

test('pre-bash fails open (exit 1, not 2) when its input is malformed', () => {
  const r = spawnSync('node', [path.join(HOOKS, 'pre-bash.js')], { input: '{bad', encoding: 'utf8' });
  assert.equal(r.status, 1);
});

test('stop hook is inert when no run was started', () => {
  const r = stop(project());
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('stop hook blocks while verify fails, then releases once it passes', () => {
  const dir = project();
  assert.equal(cli(dir, 'init', '--verify', 'test -f done.txt', '--max', '5').status, 0);

  const first = stop(dir);
  assert.equal(JSON.parse(first.stdout).decision, 'block');
  assert.equal(state(dir).iteration, 1);

  fs.writeFileSync(path.join(dir, 'done.txt'), 'x');
  const second = stop(dir);
  assert.equal(second.stdout, '');
  assert.equal(state(dir).status, 'passed');
  assert.equal(state(dir).active, false);
});

test('stop hook halts at the iteration cap instead of looping forever', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'echo "fail $RANDOM" >&2; false', '--max', '2', '--stall', '99');
  const decisions = [stop(dir), stop(dir), stop(dir)].map((r) => r.stdout);
  assert.equal(JSON.parse(decisions[0]).decision, 'block');
  assert.equal(JSON.parse(decisions[1]).decision, 'block');
  assert.equal(decisions[2], '');
  assert.equal(state(dir).status, 'halted-max-iterations');
});

test('commit gate refuses git commit while verify fails and allows it once green', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'test -f ok.txt');
  const refused = bash(dir, 'git commit -m wip');
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /Commit refused/);
  fs.writeFileSync(path.join(dir, 'ok.txt'), 'x');
  assert.equal(bash(dir, 'git commit -m done').status, 0);
});

test('while a run is active, pre-write protects acceptance paths and pre-bash blocks `off`', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'true', '--protect', 'acceptance/');
  const edit = run(path.join(HOOKS, 'pre-write.js'), dir, {
    tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'acceptance', 't.js'), new_string: 'x' },
  });
  assert.equal(edit.status, 2);
  assert.equal(bash(dir, `node .claude/harness/bin/harness.js off`).status, 2);
});

test('cli rejects bad input with a clear message', () => {
  const dir = project();
  const noVerify = cli(dir, 'init');
  assert.equal(noVerify.status, 2);
  assert.match(noVerify.stderr, /verify/i);
  assert.equal(cli(dir, 'init', '--verify', 'true', '--max', '0').status, 2);
});

test('cli off deactivates and status reports it', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'true');
  cli(dir, 'off');
  assert.equal(state(dir).active, false);
  assert.match(cli(dir, 'status').stdout, /stopped-by-human/);
});

test('--no-commit-gate lets checkpoint commits through while verify fails', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'false', '--no-commit-gate');
  assert.equal(bash(dir, 'git commit -m wip').status, 0);
});

test('corrupt state keeps guards on and refuses commits instead of failing open', () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, '.harness'));
  fs.writeFileSync(path.join(dir, '.harness', 'state.json'), '{broken');
  assert.equal(bash(dir, 'git push --force origin x').status, 2);
  const commit = bash(dir, 'git commit -m x');
  assert.equal(commit.status, 2);
  assert.match(commit.stderr, /corrupt/i);
});

test('a bare git push on main is refused using the real current branch', () => {
  const dir = project();
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  assert.equal(bash(dir, 'git push').status, 2);
  spawnSync('git', ['checkout', '-q', '-b', 'claude/feat'], { cwd: dir });
  assert.equal(bash(dir, 'git push').status, 0);
});

const edit = (projectDir, event = {}) => run(path.join(HOOKS, 'post-edit.js'), projectDir, { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'a.js' }, ...event });

test('stop hook fails closed once when the state file is corrupt, then lets the session end', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'true');
  fs.writeFileSync(path.join(dir, '.harness', 'state.json'), '{bad');
  const first = run(path.join(HOOKS, 'stop.js'), dir, { hook_event_name: 'Stop' });
  assert.equal(first.status, 0);
  assert.equal(JSON.parse(first.stdout).decision, 'block');
  assert.match(JSON.parse(first.stdout).reason, /corrupt/i);
  const second = run(path.join(HOOKS, 'stop.js'), dir, { hook_event_name: 'Stop', stop_hook_active: true });
  assert.equal(second.stdout, '');
});

test('init --verify-timeout bounds the verify command', () => {
  const dir = project();
  assert.equal(cli(dir, 'init', '--verify', 'sleep 20', '--verify-timeout', '1').status, 0);
  const started = Date.now();
  const r = cli(dir, 'verify');
  assert.match(r.stdout, /timed out/);
  assert.ok(Date.now() - started < 10_000);
});

test('post-edit hook is inert without a lint command', () => {
  const r = edit(project());
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
});

test('post-edit hook exits 2 with the lint output when lint fails, 0 when it passes', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'true', '--lint', 'echo "bad style" >&2; false');
  const failed = edit(dir);
  assert.equal(failed.status, 2);
  assert.match(failed.stderr, /bad style/);
  cli(dir, 'off');
  cli(dir, 'init', '--verify', 'true', '--lint', 'true');
  assert.equal(edit(dir).status, 0);
});

test('post-edit hook ignores edits when the run is not active', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'true', '--lint', 'false');
  cli(dir, 'off');
  assert.equal(edit(dir).status, 0);
});
