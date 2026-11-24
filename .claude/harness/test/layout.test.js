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

test('history, skipped paths, paths in another repository and look-alike paths are allowed', () => {
  const dir = repo({
    'CHANGELOG.md': 'moved examples/retro-board\n',
    'plugins/vendor/x.md': 'see examples/foo\n',
    'docs/dod.md': 'kept in history: `git show bfad3bb:docs/product/wiki/retro.md`\n',
    'skill.md': 'records in `<product-repo>/docs/product/<slug>/`, code in <product-repo>/examples/x\n',
    'other.md': 'code-examples/ and tune/golden/docs/product-like and my-examples/\n',
    'notes.txt': 'examples/ in a non-doc file\n',
  });
  assert.deepEqual(checkLayout(dir, POLICY), []);
});

test('a placeholder path with no repository in front still fails, so it cannot be read as this repo', () => {
  const dir = repo({ 'agent.md': 'write `docs/product/<slug>/brief.md`\nor `examples/<p>`\n' });
  assert.deepEqual(checkLayout(dir, POLICY), ['agent.md:1 cites docs/product/', 'agent.md:2 cites examples/']);
});

test('untracked files are not read, and a policy without refs only checks folders', () => {
  const dir = repo({ 'README.md': 'clean\n' });
  fs.writeFileSync(path.join(dir, 'scratch.md'), 'examples/ draft\n');
  assert.deepEqual(checkLayout(dir, POLICY), []);
  assert.deepEqual(checkLayout(dir, { forbiddenDirs: ['README.md'] }), ['README.md/ exists']);
});

test('fails when a current doc names a retired skill, in prose or as a path, and its folder is a forbidden dir', () => {
  const policy = { ...POLICY, forbiddenDirs: ['.claude/skills/old-skill'], retiredNames: ['old-skill'] };
  const dir = repo({
    'README.md': 'Build the list with the `old-skill` skill.\n',
    'docs/run.md': 'see .claude/skills/old-skill/SKILL.md\n',
    '.claude/skills/old-skill/SKILL.md': 'name: old-skill\n',
    'CHANGELOG.md': 'removed old-skill\n',
    'other.md': 'my-old-skill, old-skills and old-skill-v2 are other names\n',
  });
  assert.deepEqual(checkLayout(dir, policy), [
    '.claude/skills/old-skill/ exists',
    '.claude/skills/old-skill/SKILL.md:1 names retired old-skill',
    'README.md:1 names retired old-skill',
    'docs/run.md:1 names retired old-skill',
  ]);
});

test('current docs in this repository do not name plan-to-tasks, and its skill folder stays deleted (#23)', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(REPO, '.claude', 'layout.json'), 'utf8'));
  assert.ok(policy.retiredNames.includes('plan-to-tasks'));
  assert.ok(policy.forbiddenDirs.includes('.claude/skills/plan-to-tasks'));
  assert.deepEqual(checkLayout(REPO, { ...policy, forbiddenRefs: [] }), []);
});

test('a policy with only retiredNames checks names, and retiredNamesSkip exempts a file from that check alone', () => {
  const dir = repo({ 'a.md': 'use old-skill\n', 'adr.md': 'rejected old-skill; see examples/x\n' });
  assert.deepEqual(checkLayout(dir, { retiredNames: ['old-skill'] }), ['a.md:1 names retired old-skill', 'adr.md:1 names retired old-skill']);
  const policy = { forbiddenRefs: ['examples/'], retiredNames: ['old-skill'], retiredNamesSkip: ['adr.md'] };
  assert.deepEqual(checkLayout(dir, policy), ['a.md:1 names retired old-skill', 'adr.md:1 cites examples/']);
});

test('CLI takes --policy and exits 0 when the repository has no policy', () => {
  const dir = repo({ 'README.md': 'see examples/x\n' });
  const policy = path.join(dir, 'p.json');
  fs.writeFileSync(policy, JSON.stringify({ forbiddenRefs: ['nothing/'] }));
  assert.equal(cli(dir, '--policy', policy).status, 0);
  fs.rmSync(path.join(dir, '.claude', 'layout.json'));
  fs.writeFileSync(policy, '{ not json');
  const bad = cli(dir, '--policy', policy);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /cannot read policy/);
  const none = cli(dir);
  assert.equal(none.status, 0);
  assert.match(none.stdout, /no policy/);
});
