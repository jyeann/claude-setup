'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { install, mergeSettings } = require('../lib/install');

const CLAUDE_DIR = path.join(__dirname, '..', '..');
const BIN = path.join(__dirname, '..', 'bin', 'install.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-install-'));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const settingsOf = (dir) => readJson(path.join(dir, '.claude', 'settings.json'));

test('installs harness, rules, settings and gitignore into an empty project', () => {
  const dir = tmp();
  const res = install({ sourceClaudeDir: CLAUDE_DIR, targetDir: dir });
  assert.equal(res.ok, true);
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'harness', 'hooks', 'stop.js')));
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'harness', 'lib', 'guards.js')));
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'rules', 'ecc-common', 'security.md')));
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'harness', 'test')), false);
  const s = settingsOf(dir);
  const source = readJson(path.join(CLAUDE_DIR, 'settings.json'));
  assert.deepEqual(s.permissions.deny, source.permissions.deny);
  assert.deepEqual(s.hooks, source.hooks);
  assert.deepEqual(s.sandbox, source.sandbox);
  assert.deepEqual(s.statusLine, source.statusLine);
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), '.harness/\n');
});

test('the installed hooks run from the target project', () => {
  const dir = tmp();
  install({ sourceClaudeDir: CLAUDE_DIR, targetDir: dir });
  const event = { tool_name: 'Bash', tool_input: { command: 'git push --force origin main' }, cwd: dir };
  const run = spawnSync('node', [path.join(dir, '.claude', 'harness', 'hooks', 'pre-bash.js')], {
    input: JSON.stringify(event), encoding: 'utf8', cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  assert.equal(run.status, 2, run.stderr);
});

test('a second install changes nothing in settings and does not duplicate hooks', () => {
  const dir = tmp();
  install({ sourceClaudeDir: CLAUDE_DIR, targetDir: dir });
  const before = fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8');
  const res = install({ sourceClaudeDir: CLAUDE_DIR, targetDir: dir });
  assert.equal(res.ok, true);
  assert.ok(res.actions.includes('.claude/settings.json: already up to date'));
  assert.equal(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'), before);
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), '.harness/\n');
});

test('keeps existing settings, hooks, sandbox, status line and unrelated keys', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.claude'));
  const mine = {
    model: 'x',
    permissions: { allow: ['Bash(make:*)'], deny: ['Bash(sudo:*)'] },
    sandbox: { enabled: false },
    statusLine: { type: 'command', command: 'mine' },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] },
  };
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(mine));
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules');
  const res = install({ sourceClaudeDir: CLAUDE_DIR, targetDir: dir });
  const s = settingsOf(dir);
  assert.equal(s.model, 'x');
  assert.deepEqual(s.sandbox, { enabled: false });
  assert.equal(s.statusLine.command, 'mine');
  assert.equal(s.permissions.allow[0], 'Bash(make:*)');
  assert.equal(s.permissions.deny.filter((r) => r === 'Bash(sudo:*)').length, 1);
  assert.ok(s.permissions.deny.includes('Bash(rm -rf:*)'));
  assert.equal(s.hooks.Stop.length, 2);
  assert.equal(s.hooks.Stop[0].hooks[0].command, 'echo mine');
  assert.ok(res.actions.some((a) => a.includes('sandbox: kept your existing value')));
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), 'node_modules\n.harness/\n');
});

test('existing rule files are kept unless --force, harness files are always refreshed', () => {
  const dir = tmp();
  const rule = path.join(dir, '.claude', 'rules', 'ecc-common', 'security.md');
  const hook = path.join(dir, '.claude', 'harness', 'hooks', 'stop.js');
  fs.mkdirSync(path.dirname(rule), { recursive: true });
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(rule, 'my rule');
  fs.writeFileSync(hook, 'stale');
  const res = install({ sourceClaudeDir: CLAUDE_DIR, targetDir: dir });
  assert.equal(fs.readFileSync(rule, 'utf8'), 'my rule');
  assert.notEqual(fs.readFileSync(hook, 'utf8'), 'stale');
  assert.ok(res.actions.some((a) => a.includes('1 existing kept')));
  install({ sourceClaudeDir: CLAUDE_DIR, targetDir: dir, force: true });
  assert.notEqual(fs.readFileSync(rule, 'utf8'), 'my rule');
});

test('dry run reports the work and writes nothing', () => {
  const dir = tmp();
  const res = install({ sourceClaudeDir: CLAUDE_DIR, targetDir: dir, dryRun: true });
  assert.equal(res.ok, true);
  assert.ok(res.actions.some((a) => /harness: [1-9]\d* file/.test(a)));
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('refuses and writes nothing when settings.json is not valid JSON', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ broken');
  const res = install({ sourceClaudeDir: CLAUDE_DIR, targetDir: dir });
  assert.equal(res.ok, false);
  assert.match(res.message, /not valid JSON/);
  assert.deepEqual(fs.readdirSync(path.join(dir, '.claude')), ['settings.json']);
});

test('refuses the source repository itself, a missing target, a bad source and an active run', () => {
  assert.match(install({ sourceClaudeDir: CLAUDE_DIR, targetDir: path.join(CLAUDE_DIR, '..') }).message, /same directory/);
  assert.match(install({ sourceClaudeDir: CLAUDE_DIR, targetDir: path.join(tmp(), 'nope') }).message, /not a directory/);
  assert.match(install({ sourceClaudeDir: tmp(), targetDir: tmp() }).message, /does not contain harness/);
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.harness'));
  fs.writeFileSync(path.join(dir, '.harness', 'state.json'), '{}');
  assert.match(install({ sourceClaudeDir: CLAUDE_DIR, targetDir: dir }).message, /harness run is recorded/);
  assert.equal(fs.existsSync(path.join(dir, '.claude')), false);
});

test('mergeSettings adds a hook group only when one of its commands is new', () => {
  const group = (cmd) => ({ hooks: [{ type: 'command', command: cmd }] });
  const { settings, notes } = mergeSettings({ hooks: { Stop: [group('a')] } }, { hooks: { Stop: [group('a'), group('b')], PreToolUse: [group('c')] } });
  assert.deepEqual(settings.hooks.Stop.map((g) => g.hooks[0].command), ['a', 'b']);
  assert.equal(settings.hooks.PreToolUse.length, 1);
  assert.deepEqual(notes, ['hooks.Stop: added 1 hook group(s)', 'hooks.PreToolUse: added 1 hook group(s)']);
});

test('CLI installs into the given directory, exits 2 on refusal, and honours --dry-run', () => {
  const dir = tmp();
  const dry = spawnSync('node', [BIN, dir, '--dry-run'], { encoding: 'utf8' });
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /Would install harness/);
  assert.deepEqual(fs.readdirSync(dir), []);
  const ok = spawnSync('node', [BIN, dir], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Installed harness/);
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'settings.json')));
  const bad = spawnSync('node', [BIN, path.join(dir, 'missing')], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /not a directory/);
});

test('every marketplace entry matches its plugin manifest and the core plugin is .claude', () => {
  const market = readJson(path.join(CLAUDE_DIR, '..', '.claude-plugin', 'marketplace.json'));
  const plugin = readJson(path.join(CLAUDE_DIR, '.claude-plugin', 'plugin.json'));
  assert.equal(market.plugins[0].name, plugin.name);
  assert.equal(market.plugins[0].source, './.claude');
  for (const entry of market.plugins) {
    const manifest = readJson(path.join(CLAUDE_DIR, '..', entry.source, '.claude-plugin', 'plugin.json'));
    assert.equal(manifest.name, entry.name);
    assert.doesNotMatch(entry.name, /^(claude|anthropic)/);
  }
});
