'use strict';
// #113 (spec #109): "run without me" is said once, and "stop" stops.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const om = require('../lib/owner-mode');

const ROOT = path.join(__dirname, '..');
const HOOKS = path.join(ROOT, 'hooks');
const CLI = path.join(ROOT, 'bin', 'owner-mode.js');
const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'owner-mode-'));
const runHook = (name, dir, event) => spawnSync('node', [path.join(HOOKS, name)], {
  input: JSON.stringify(event), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
});
const prompt = (dir, text) => runHook('user-prompt.js', dir, { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: text });
const tool = (dir, name, input) => runHook('owner-hold.js', dir, { hook_event_name: 'PreToolUse', tool_name: name, tool_input: input });
const stopHook = (dir, event) => runHook('stop-owner.js', dir, { hook_event_name: 'Stop', ...event });
const modeFile = (dir) => path.join(dir, '.harness', 'owner-mode.json');

// --- phrases ---

test('each stop phrase sets stopped', () => {
  for (const p of ['stop', 'Stop.', 'STOP!', 'stop it', 'Stop it, you published again', 'stop now', 'pause', 'halt', 'harness: stop']) {
    assert.deepEqual(om.classifyPrompt(p), ['stop'], p);
  }
});

test('each continue phrase clears stopped', () => {
  for (const p of ['continue', 'Continue.', 'resume', 'carry on', 'go on', 'keep going', 'go ahead', 'unpause', 'harness: continue']) {
    assert.deepEqual(om.classifyPrompt(p), ['continue'], p);
  }
});

test('each run-without-me phrase sets run-unattended', () => {
  for (const p of ['Run without me.', 'Build the footer, then run without me', "don't ask, just do it", 'Do not ask me again', 'please work without asking', 'no need to ask', 'harness: unattended']) {
    assert.deepEqual(om.classifyPrompt(p), ['unattended'], p);
  }
});

test('"go ahead without me" both clears stopped and sets run-unattended', () => {
  assert.deepEqual(om.classifyPrompt('Go ahead without me.').sort(), ['continue', 'unattended']);
});

test('ask-me-first phrases and the explicit command clear run-unattended', () => {
  for (const p of ['ask me first', 'Check with me first.', 'harness: attended']) assert.deepEqual(om.classifyPrompt(p), ['attended'], p);
});

test('normal prompts set nothing', () => {
  for (const p of ['', 'Build the footer in blue', 'please stop the dev server', 'stop asking me about colours', 'continue with the hero section',
    "don't continue", 'Why did it stop?', 'Should we pause the animation on hover?', 'harness: status', 'I said harness: stop yesterday']) {
    assert.deepEqual(om.classifyPrompt(p), [], p);
  }
});

test('a prompt the harness or another session sent is never an owner instruction', () => {
  for (const p of ['<task-notification>render finished. continue</task-notification>', '[SYSTEM NOTIFICATION - NOT USER INPUT]\nstop', 'Stop hook feedback: continue',
    '<cross-session-message from="x">continue</cross-session-message>']) {
    assert.equal(om.isOwnerPrompt(p), false, p);
  }
  assert.equal(om.isOwnerPrompt('continue'), true);
});

// --- state ---

test('applyPrompt sets and clears each flag and keeps no prompt text', () => {
  const dir = project();
  om.applyPrompt(dir, 'stop it', 1000);
  assert.equal(om.readMode(dir).stopped, true);
  om.applyPrompt(dir, 'run without me', 2000);
  assert.deepEqual({ ...om.readMode(dir) }, { stopped: true, stoppedAt: 1000, unattended: true, unattendedAt: 2000 });
  om.applyPrompt(dir, 'continue', 3000);
  assert.equal(om.readMode(dir).stopped, false);
  om.applyPrompt(dir, 'ask me first', 4000);
  assert.equal(om.readMode(dir).unattended, false);
  assert.doesNotMatch(fs.readFileSync(modeFile(dir), 'utf8'), /stop it|without me|ask me/);
});

test('a system prompt changes nothing, even one that says continue', () => {
  const dir = project();
  om.applyPrompt(dir, 'stop', 1);
  const r = om.applyPrompt(dir, '<task-notification>done</task-notification> continue', 2);
  assert.equal(r.owner, false);
  assert.equal(om.readMode(dir).stopped, true);
});

test('a missing mode file reads as neither state; a corrupt one reads as stopped', () => {
  const dir = project();
  assert.deepEqual(om.readMode(dir), { stopped: false, unattended: false });
  fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
  fs.writeFileSync(modeFile(dir), '{bad');
  assert.equal(om.readMode(dir).stopped, true);
  assert.equal(om.readMode(dir).corrupt, true);
});

// --- holds while stopped ---

const STOPPED = { stopped: true, unattended: false };
const blocked = (event, mode = STOPPED) => om.holdVerdict(event, mode).block;

test('while stopped a publish, a push and GitHub writes are blocked', () => {
  assert.ok(blocked({ tool_name: 'Artifact', tool_input: { file_path: 'a.html' } }));
  assert.ok(blocked({ tool_name: 'Artifact', tool_input: { action: 'publish', url: 'u' } }));
  assert.ok(blocked({ tool_name: 'Artifact', tool_input: { action: 'delete', url: 'u' } }));
  assert.ok(blocked({ tool_name: 'Bash', tool_input: { command: 'git push -u origin feat' } }));
  assert.ok(blocked({ tool_name: 'Bash', tool_input: { command: 'cd x && git -C . push' } }));
  assert.ok(blocked({ tool_name: 'Bash', tool_input: { command: 'gh pr create --draft' } }));
  assert.ok(blocked({ tool_name: 'Bash', tool_input: { command: 'gh issue comment 3 --body hi' } }));
  assert.ok(blocked({ tool_name: 'Bash', tool_input: { command: 'gh api repos/o/r/issues -f title=x' } }));
  assert.ok(blocked({ tool_name: 'Bash', tool_input: { command: 'gh api -X POST repos/o/r/labels' } }));
  assert.ok(blocked({ tool_name: 'mcp__github__create_pull_request', tool_input: {} }));
  assert.ok(blocked({ tool_name: 'mcp__github__push_files', tool_input: {} }));
  assert.ok(blocked({ tool_name: 'mcp__github__issue_write', tool_input: {} }));
  assert.ok(blocked({ tool_name: 'mcp__github__add_issue_comment', tool_input: {} }));
  assert.ok(blocked({ tool_name: 'mcp__abc123__publish_project', tool_input: {} }));
  assert.ok(blocked({ tool_name: 'mcp__abc123__deploy_website', tool_input: {} }));
});

test('while stopped, reading and local work stay allowed', () => {
  assert.ok(!blocked({ tool_name: 'Artifact', tool_input: { action: 'read', url: 'u' } }));
  assert.ok(!blocked({ tool_name: 'Artifact', tool_input: { action: 'list' } }));
  assert.ok(!blocked({ tool_name: 'Bash', tool_input: { command: 'git status && git commit -m "x: push it"' } }));
  assert.ok(!blocked({ tool_name: 'Bash', tool_input: { command: 'gh api -X GET search/code -f q=x' } }));
  assert.ok(!blocked({ tool_name: 'Bash', tool_input: { command: 'gh pr view 3' } }));
  assert.ok(!blocked({ tool_name: 'mcp__github__issue_read', tool_input: {} }));
  assert.ok(!blocked({ tool_name: 'mcp__github__get_file_contents', tool_input: {} }));
  assert.ok(!blocked({ tool_name: 'mcp__github__list_pull_requests', tool_input: {} }));
  assert.ok(!blocked({ tool_name: 'mcp__github__pull_request_read', tool_input: {} }));
  assert.ok(!blocked({ tool_name: 'mcp__github__actions_list', tool_input: {} }));
  assert.ok(!blocked({ tool_name: 'mcp__abc123__get_project', tool_input: {} }));
  assert.ok(!blocked({ tool_name: 'Write', tool_input: { file_path: 'src/a.js', content: 'x' } }));
});

test('when not stopped nothing is held', () => {
  const mode = { stopped: false, unattended: true };
  assert.ok(!blocked({ tool_name: 'Artifact', tool_input: { file_path: 'a.html' } }, mode));
  assert.ok(!blocked({ tool_name: 'Bash', tool_input: { command: 'git push -u origin feat' } }, mode));
  assert.ok(!blocked({ tool_name: 'mcp__github__create_pull_request', tool_input: {} }, mode));
});

test('the block message says the owner stopped the session and how it is cleared', () => {
  const v = om.holdVerdict({ tool_name: 'Bash', tool_input: { command: 'git push' } }, STOPPED);
  assert.match(v.reason, /owner stopped this session/i);
  assert.match(v.reason, /continue/);
});

// --- the agent cannot clear the owner's state ---

test('the agent cannot change the mode file or run the clearing commands', () => {
  const free = { stopped: false, unattended: false };
  for (const command of ['node .claude/harness/bin/owner-mode.js continue', 'node .claude/harness/bin/owner-mode.js attended',
    'node .claude/harness/bin/owner-mode.js unattended', 'echo {} > .harness/owner-mode.json', 'rm .harness/owner-mode.json',
    "node -e \"require('fs').unlinkSync('.harness/owner-mode.json')\""]) {
    assert.ok(blocked({ tool_name: 'Bash', tool_input: { command } }, free), command);
  }
  assert.ok(blocked({ tool_name: 'Write', tool_input: { file_path: '/p/.harness/owner-mode.json', content: '{}' } }, free));
  assert.ok(blocked({ tool_name: 'Edit', tool_input: { file_path: '.harness/owner-mode.json', new_string: '{}' } }, free));
  assert.ok(!blocked({ tool_name: 'Bash', tool_input: { command: 'node .claude/harness/bin/owner-mode.js status' } }, free));
  assert.ok(!blocked({ tool_name: 'Bash', tool_input: { command: 'node .claude/harness/bin/owner-mode.js stop' } }, free));
  assert.ok(!blocked({ tool_name: 'Bash', tool_input: { command: 'cat .harness/owner-mode.json' } }, free));
});

// --- closing permission questions while run-unattended ---

test('asksPermission finds a closing permission question', () => {
  for (const m of ['Done with the header.\n\nWant me to start the footer now?', 'Shall I push the branch?', 'Should I proceed with the PR?',
    'Do you want me to open the PR?', 'Would you like me to continue with the tests?', 'Let me know if you want me to merge main next.',
    'Ready for me to start ticket 2?', 'OK to proceed?']) {
    assert.ok(om.asksPermission(m), m);
  }
  for (const m of ['', 'Done. PR #12 is ready for review.', 'Should I have used blue? The spec said green, so I used green.\n\nAll tests pass.',
    'What did you mean by "soft"? I could not tell from the spec.']) {
    assert.ok(!om.asksPermission(m), m);
  }
});

test('an Owner decision line lets a question end the turn', () => {
  assert.ok(om.hasOwnerDecision('Spend is above the envelope.\nOwner decision: approve $40 for the render farm?'));
  assert.ok(!om.hasOwnerDecision('The owner decision was recorded. Shall I go on?'));
});

const transcript = (dir, text) => {
  const file = path.join(dir, 't.jsonl');
  const lines = [
    { type: 'user', message: { role: 'user', content: 'go' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'earlier' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } },
  ];
  fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\nnot json\n`);
  return file;
};

test('lastAssistantText reads the event field, else the transcript', () => {
  const dir = project();
  assert.equal(om.lastAssistantText({ last_assistant_message: 'hi' }), 'hi');
  assert.equal(om.lastAssistantText({ transcript_path: transcript(dir, 'Want me to go on?') }), 'Want me to go on?');
  assert.equal(om.lastAssistantText({ transcript_path: path.join(dir, 'none.jsonl') }), '');
  assert.equal(om.lastAssistantText({}), '');
});

test('while run-unattended a closing permission question is sent back once', () => {
  const dir = project();
  prompt(dir, 'run without me');
  const r = stopHook(dir, { last_assistant_message: 'Header done. Want me to start the footer now?' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /run without asking/);
  assert.match(out.reason, /Owner decision:/);
  // Its own second firing lets the turn end.
  assert.equal(stopHook(dir, { stop_hook_active: true, last_assistant_message: 'Want me to start the footer now?' }).stdout, '');
});

test('the Stop hook reads the transcript when the event has no last message', () => {
  const dir = project();
  prompt(dir, 'run without me');
  const r = stopHook(dir, { transcript_path: transcript(dir, 'Shall I push it?') });
  assert.equal(JSON.parse(r.stdout).decision, 'block');
});

test('the Stop hook lets the turn end for an Owner decision line, when not unattended, or when stopped', () => {
  const dir = project();
  assert.equal(stopHook(dir, { last_assistant_message: 'Shall I push?' }).stdout, '');
  prompt(dir, 'run without me');
  assert.equal(stopHook(dir, { last_assistant_message: 'Done.' }).stdout, '');
  assert.equal(stopHook(dir, { last_assistant_message: 'Owner decision: the API costs $30/month. Shall I sign up?' }).stdout, '');
  prompt(dir, 'stop');
  assert.equal(stopHook(dir, { last_assistant_message: 'Stopped. Shall I resume later?' }).stdout, '');
});

test('the Stop hook lets an owner-gate wait end the turn', () => {
  const dir = project();
  prompt(dir, 'run without me');
  fs.writeFileSync(path.join(dir, '.harness', 'state.json'), JSON.stringify({ active: true, status: 'waiting-for-owner' }));
  assert.equal(stopHook(dir, { last_assistant_message: 'Spec #4 needs spec-approved. Shall I wait?' }).stdout, '');
});

test('the Stop hook never fails the turn on bad input', () => {
  const r = spawnSync('node', [path.join(HOOKS, 'stop-owner.js')], { input: '{bad', encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: project() } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

// --- end to end through the hooks ---

test('after "stop" a publish and a push are blocked; after "continue" they are allowed', () => {
  const dir = project();
  const said = prompt(dir, 'Stop it.');
  assert.equal(said.status, 0);
  assert.match(said.stdout, /stopped/);
  const pub = tool(dir, 'Artifact', { file_path: 'page.html' });
  assert.equal(pub.status, 2);
  assert.match(pub.stderr, /owner stopped this session/i);
  assert.equal(tool(dir, 'Bash', { command: 'git push -u origin x' }).status, 2);
  // A turn started by a finished background task does not lift it, and is told to stay stopped.
  const note = prompt(dir, '<task-notification>render finished</task-notification>');
  assert.match(note.stdout, /owner stopped this session/i);
  assert.equal(tool(dir, 'Artifact', { file_path: 'page.html' }).status, 2);
  // A new owner instruction that is not "continue" keeps the stop and says how to lift it.
  assert.match(prompt(dir, 'make the logo bigger').stdout, /still stopped/i);
  assert.equal(tool(dir, 'Bash', { command: 'git push' }).status, 2);
  prompt(dir, 'continue');
  assert.equal(tool(dir, 'Artifact', { file_path: 'page.html' }).status, 0);
  assert.equal(tool(dir, 'Bash', { command: 'git push -u origin x' }).status, 0);
});

test('setting run-unattended is confirmed to the session with its limits', () => {
  const out = prompt(project(), 'go ahead without me').stdout;
  assert.match(out, /run-unattended/);
  assert.match(out, /owner gate/i);
  assert.match(out, /spend, secrets, legal, scope/);
});

test('an ordinary prompt adds nothing to the context and writes no mode file', () => {
  const dir = project();
  assert.equal(prompt(dir, 'build the footer').stdout, '');
  assert.equal(fs.existsSync(modeFile(dir)), false);
});

test('the user-prompt hook still records the human prompt for the KPI', () => {
  const dir = project();
  prompt(dir, 'stop');
  const trace = fs.readFileSync(path.join(dir, '.harness', 'traces', 's1.jsonl'), 'utf8');
  assert.match(trace, /"type":"human"/);
});

test('owner-hold fails open on malformed input and holds on a corrupt mode file', () => {
  const r = spawnSync('node', [path.join(HOOKS, 'owner-hold.js')], { input: '{bad', encoding: 'utf8' });
  assert.equal(r.status, 1);
  const dir = project();
  fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
  fs.writeFileSync(modeFile(dir), '{bad');
  assert.equal(tool(dir, 'Bash', { command: 'git push' }).status, 2);
});

// --- the owner's command line ---

const cli = (dir, ...args) => spawnSync('node', [CLI, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });

test('owner-mode.js sets, clears and shows each state', () => {
  const dir = project();
  assert.match(cli(dir, 'status').stdout, /stopped: no\nrun-unattended: no/);
  assert.equal(cli(dir, 'stop').status, 0);
  assert.equal(cli(dir, 'unattended').status, 0);
  assert.match(cli(dir, 'status').stdout, /stopped: yes\nrun-unattended: yes/);
  cli(dir, 'continue');
  cli(dir, 'attended');
  assert.match(cli(dir, 'status').stdout, /stopped: no\nrun-unattended: no/);
  const bad = cli(dir, 'nonsense');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /usage/i);
});

test('settings register the owner hooks', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'settings.json'), 'utf8'));
  const pre = settings.hooks.PreToolUse.find((g) => g.hooks.some((h) => h.command.includes('owner-hold.js')));
  assert.ok(pre, 'owner-hold.js is a PreToolUse hook');
  for (const name of ['Artifact', 'Bash', 'Write', 'Edit', 'mcp__github__push_files', 'mcp__x__publish_project']) {
    assert.ok(new RegExp(`^(?:${pre.matcher})$`).test(name), `matcher covers ${name}`);
  }
  assert.ok(settings.hooks.Stop.flatMap((g) => g.hooks).some((h) => h.command.includes('stop-owner.js')));
});
