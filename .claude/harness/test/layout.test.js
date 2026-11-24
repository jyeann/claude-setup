'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { checkLayout } = require('../lib/layout');

const CLI = path.join(__dirname, '..', 'bin', 'check-layout.js');
const REPO = path.join(__dirname, '..', '..', '..');
const POLICY = {
  forbiddenDirs: ['examples', 'docs/product'],
  forbiddenRefs: ['examples/', 'docs/product/'],
  skip: ['CHANGELOG.md', 'plugins/'],
  placeholderFiles: ['skill.md'],
};

// A git repo with the given files tracked, plus the policy at .claude/layout.json.
function repo(files, policy = POLICY) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-layout-'));
  const all = { ...files, '.claude/layout.json': JSON.stringify(policy) };
  for (const [rel, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}
const cli = (...args) => spawnSync('node', [CLI, ...args], { encoding: 'utf8' });

test('this repository has no examples/ folder and no current doc cites examples/ or docs/product/', () => {
  const r = cli(REPO);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /layout is clean/);
});

test('fails when examples/ exists, even with no doc citing it', () => {
  const dir = repo({ 'examples/app/README.md': 'an app\n', 'README.md': 'see testbench/\n' });
  const r = cli(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /examples\/ exists/);
});

test('fails when a tracked doc cites examples/ or docs/product/, naming file and line', () => {
  const dir = repo({ 'README.md': 'intro\nRun `examples/retro-board`.\n', 'docs/a.md': 'Records in docs/product/x/.\n' });
  const r = cli(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /README\.md:2 cites examples\//);
  assert.match(r.stderr, /docs\/a\.md:1 cites docs\/product\//);
});

test('history, skipped paths, placeholders in listed files and look-alike paths are allowed', () => {
  const dir = repo({
    'CHANGELOG.md': 'moved examples/retro-board\n',
    'plugins/vendor/x.md': 'see examples/foo\n',
    'docs/dod.md': 'kept in history: `git show bfad3bb:docs/product/wiki/retro.md`\n',
    'skill.md': 'build into `examples/<p>` with docs in `docs/product/<slug>/`\n',
    'other.md': 'code-examples/ and tune/golden/docs/product-like and my-examples/\n',
    'notes.txt': 'examples/ in a non-doc file\n',
  });
  assert.deepEqual(checkLayout(dir, POLICY), []);
});

test('a placeholder outside the listed files still fails', () => {
  const dir = repo({ 'agent.md': 'write `docs/product/<slug>/brief.md`\n' });
  assert.deepEqual(checkLayout(dir, POLICY), ['agent.md:1 cites docs/product/']);
});

test('untracked files are not read, and a policy without refs only checks folders', () => {
  const dir = repo({ 'README.md': 'clean\n' });
  fs.writeFileSync(path.join(dir, 'scratch.md'), 'examples/ draft\n');
  assert.deepEqual(checkLayout(dir, POLICY), []);
  assert.deepEqual(checkLayout(dir, { forbiddenDirs: ['README.md'] }), ['README.md/ exists']);
});

test('CLI takes --policy and exits 0 when the repository has no policy', () => {
  const dir = repo({ 'README.md': 'see examples/x\n' });
  const policy = path.join(dir, 'p.json');
  fs.writeFileSync(policy, JSON.stringify({ forbiddenRefs: ['nothing/'] }));
  assert.equal(cli(dir, '--policy', policy).status, 0);
  fs.rmSync(path.join(dir, '.claude', 'layout.json'));
  const none = cli(dir);
  assert.equal(none.status, 0);
  assert.match(none.stdout, /no policy/);
});
