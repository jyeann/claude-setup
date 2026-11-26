'use strict';
// #112: helper agents keep unfinished work in the gitignored work folder, so the cloud platform's
// commit-check Stop hook does not fire on it, and the run guards still let them write there.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { install } = require('../lib/install');
const { checkBash, checkWrite, WORK_DIR } = require('../lib/guards');

const CLAUDE_DIR = path.join(__dirname, '..', '..');
const REPO = path.join(CLAUDE_DIR, '..');
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-work-')));
const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
const put = (dir, rel, text = 'x\n') => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

test('the work folder is .harness/work/', () => {
  assert.equal(WORK_DIR, '.harness/work/');
});

test('a file under .harness/work/ is not listed as untracked in an installed project', () => {
  const dir = tmp();
  assert.equal(git(dir, 'init', '-q').status, 0);
  install({ sourceClaudeDir: CLAUDE_DIR, targetDir: dir });
  put(dir, '.harness/work/run-1/draft.md');
  put(dir, 'src/finished.js');
  const untracked = git(dir, 'ls-files', '--others', '--exclude-standard').stdout.split('\n');
  assert.ok(untracked.includes('src/finished.js'), 'sanity: a file outside the work folder is listed');
  assert.ok(!untracked.some((f) => f.startsWith('.harness/')), `listed: ${untracked.join(', ')}`);
});

// --- guards during an active run ---

const live = (projectDir) => ({ active: true, protectedPaths: ['acceptance/'], projectDir });
const write = (file, dir) => checkWrite({ tool_input: { file_path: file, content: 'draft' } }, live(dir), dir);

test('helpers may write, move and delete inside the work folder during a run', () => {
  const dir = tmp();
  assert.equal(write('.harness/work/run-1/draft.md', dir).block, false);
  assert.equal(write(path.join(dir, '.harness/work/run-1/draft.md'), dir).block, false);
  for (const cmd of [
    'echo hi > .harness/work/run-1/a.txt',
    'mkdir -p .harness/work/run-1 && cp notes.md .harness/work/run-1/',
    'mv .harness/work/run-1/page.html docs/design/gachi/page.html',
    'rm -r .harness/work/run-1',
  ]) assert.equal(checkBash(cmd, live(dir)).block, false, `should allow: ${cmd}`);
});

test('the rest of .harness/ stays read-only during a run', () => {
  const dir = tmp();
  assert.equal(write('.harness/state.json', dir).block, true);
  assert.equal(write('.harness/work-notes.md', dir).block, true);
  assert.equal(write('.harness/work/../state.json', dir).block, true);
  for (const cmd of [
    'echo x > .harness/state.json',
    'echo x > .harness/work/../state.json',
    'echo x > ./.harness/work/../../.harness/state.json',
    'cd .harness/work && echo x > ../state.json',
    'mv .harness/work/run-1/s.json .harness/state.json',
    'cp draft.md acceptance/',
  ]) assert.equal(checkBash(cmd, live(dir)).block, true, `should block: ${cmd}`);
});

test('a symlink inside the work folder cannot reach the rest of .harness/', () => {
  const dir = tmp();
  put(dir, '.harness/state.json', '{}');
  fs.mkdirSync(path.join(dir, '.harness/work'), { recursive: true });
  fs.symlinkSync('..', path.join(dir, '.harness/work/up'));
  fs.symlinkSync('../state.json', path.join(dir, '.harness/work/state-link'));
  assert.equal(write('.harness/work/up/state.json', dir).block, true);
  assert.equal(write('.harness/work/up/new.json', dir).block, true);
  assert.equal(write('.harness/work/state-link', dir).block, true);
  assert.equal(checkBash('echo x > .harness/work/up/state.json', live(dir)).block, true);
  assert.equal(checkBash('echo x > .harness/work/up/new.json', live(dir)).block, true);
  assert.equal(checkBash('echo x > .harness/work/state-link', live(dir)).block, true);
});

test('a work folder that is itself a symlink out of .harness/ is not a work folder', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'acceptance'), { recursive: true });
  fs.symlinkSync('../acceptance', path.join(dir, '.harness/work'));
  assert.equal(write('.harness/work/spec.test.js', dir).block, true);
  assert.equal(checkBash('echo x > .harness/work/spec.test.js', live(dir)).block, true);
});

test('a path that climbs out of the project and back in stays guarded (review #120)', () => {
  const dir = tmp();
  const name = path.basename(dir);
  for (const cmd of [
    `echo x > .claude/../../${name}/.claude/settings.json`,
    `echo x > .harness/work/../../../${name}/.harness/state.json`,
    `cp a .harness/../../${name}/acceptance/`,
    `echo x > ../${name}/.harness/state.json`,
  ]) assert.equal(checkBash(cmd, live(dir)).block, true, `should block: ${cmd}`);
  assert.equal(checkBash('echo x > ../elsewhere/file.txt', live(dir)).block, false);
});

test('a dangling symlink in the work folder cannot create a guarded file (review #120)', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.harness/work'), { recursive: true });
  fs.symlinkSync('../../.claude/settings.local.json', path.join(dir, '.harness/work/s'));
  fs.symlinkSync('../../acceptance/new.test.js', path.join(dir, '.harness/work/t'));
  for (const rel of ['.harness/work/s', '.harness/work/t']) {
    assert.equal(write(rel, dir).block, true, `Write ${rel}`);
    assert.equal(checkBash(`echo x > ${rel}`, live(dir)).block, true, `echo > ${rel}`);
  }
});

test('links cannot be made into the work folder during a run (review #120)', () => {
  const dir = tmp();
  for (const cmd of [
    'ln -s ../state.json .harness/work/l',
    'ln .harness/state.json .harness/work/h',
    'ln -s ../acceptance .harness/work',
  ]) assert.equal(checkBash(cmd, live(dir)).block, true, `should block: ${cmd}`);
});

test('without a project dir the work folder is not writable', () => {
  assert.equal(checkBash('echo x > .harness/work/a', { active: true, protectedPaths: [] }).block, true);
});

// --- the guidance names the platform hook, its three triggers and the work folder ---

const GUIDANCE = [
  '.claude/rules/ecc-common/agents.md',
  '.claude/skills/design-sessions/SKILL.md',
  '.claude/harness/README.md',
];

for (const rel of GUIDANCE) {
  test(`${rel} names the platform hook, its three triggers and the work folder`, () => {
    const text = fs.readFileSync(path.join(REPO, rel), 'utf8');
    assert.match(text, /stop-hook-git-check\.sh/);
    assert.match(text, /tracked changes/i);
    assert.match(text, /untracked files/i);
    assert.match(text, /unpushed commits/i);
    assert.ok(text.includes('.harness/work/'), 'names .harness/work/');
  });
}
