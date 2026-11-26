'use strict';
// #118: a product run (harness.js init with a pipeline.js check verify command) refuses to start while the
// product repository's setup checklist is not complete. GitHub is a fake client or a stub `gh` on PATH that
// always fails, so nothing here reaches the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { setupRepo, productRunGate, isProductRun, isSetupSource, LABELS } = require('../lib/repo-setup');

const CLAUDE_DIR = path.join(__dirname, '..', '..');
const HARNESS = path.join(__dirname, '..', 'bin', 'harness.js');
const SETUP = path.join(__dirname, '..', 'bin', 'setup-repo.js');
const PIPELINE = "node .claude/harness/bin/pipeline.js check --product . --docs docs/product/shop";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'setup-gate-'));
const byId = (res) => Object.fromEntries(res.rows.map((r) => [r.id, r]));

function fakeGithub(existing = [], { unreachable = false } = {}) {
  const have = new Set(existing);
  const calls = [];
  return {
    calls,
    listLabels: () => { calls.push('list'); return unreachable ? { ok: false, message: 'could not resolve host' } : { ok: true, names: [...have] }; },
    createLabel: (_repo, label) => { calls.push('create'); have.add(label.name); return { ok: true }; },
  };
}
const allLabels = () => fakeGithub(LABELS.map((l) => l.name));

// A product repository with a GitHub origin remote (only written to .git/config, never contacted).
function productRepo() {
  const dir = tmp();
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/shop.git'], { cwd: dir });
  return dir;
}
const setUp = (dir, extra = {}) => setupRepo({ sourceClaudeDir: CLAUDE_DIR, targetDir: dir, github: allLabels(), environment: 'acme-shop', ...extra });
const gate = (dir, verifyCommand, extra = {}) => productRunGate({ sourceClaudeDir: CLAUDE_DIR, projectDir: dir, verifyCommand, ...extra });

// A `gh` that always fails, first on PATH: the CLI runs cannot reach a real gh or GitHub.
function offlinePath() {
  const bin = tmp();
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\necho "gh: offline (test stub)" >&2\nexit 1\n', { mode: 0o755 });
  return `${bin}${path.delimiter}${process.env.PATH}`;
}
const cli = (script, dir, args) => spawnSync('node', [script, ...args], {
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_PROJECT_DIR: dir, PATH: offlinePath() },
});
const savedLabels = (names = LABELS.map((l) => l.name)) => {
  const file = path.join(tmp(), 'labels.json');
  fs.writeFileSync(file, JSON.stringify(names.map((name) => ({ name, color: 'ededed' }))));
  return file;
};

test('only a pipeline.js check verify command is a product run', () => {
  assert.equal(isProductRun(PIPELINE), true);
  assert.equal(isProductRun("node '/abs/path/.claude/harness/bin/pipeline.js' check --product /p --docs /p/d --change 12"), true);
  assert.equal(isProductRun('node .claude/harness/bin/verify.js'), false);
  assert.equal(isProductRun('npm test'), false);
  assert.equal(isProductRun(undefined), false);
});

test('a build-only run is not checked and never asks GitHub', () => {
  const github = fakeGithub();
  const r = gate(tmp(), 'node .claude/harness/bin/verify.js', { github });
  assert.equal(r.ok, true);
  assert.equal(r.checked, false);
  assert.deepEqual(github.calls, []);
});

test("this repository's own runs are not checked", () => {
  const root = path.join(CLAUDE_DIR, '..');
  assert.equal(isSetupSource(root), true);
  assert.equal(isSetupSource(tmp()), false);
  const github = fakeGithub();
  const r = gate(root, PIPELINE, { github });
  assert.equal(r.ok, true);
  assert.equal(r.checked, false);
  assert.deepEqual(github.calls, []);
});

test('refuses a product run in a repository with missing rows and names each row with its action', () => {
  const dir = productRepo();
  const r = gate(dir, PIPELINE, { github: fakeGithub(['afk']) });
  assert.equal(r.ok, false);
  for (const title of [/Harness/, /product-team/, /mattpocock-skills/, /Labels.*missing: spec-approved/, /Repository docs/, /Cloud environment/]) assert.match(r.message, title);
  assert.match(r.message, /setup-repo\.js/);
  assert.match(r.message, /--environment <name>/);
  assert.equal(fs.existsSync(path.join(dir, '.harness')), false);
  assert.equal(fs.existsSync(path.join(dir, '.claude')), false, 'the check writes nothing');
});

test('the same start succeeds once setup-repo reports the checklist complete', () => {
  const dir = productRepo();
  assert.equal(setUp(dir).complete, true);
  const r = gate(dir, PIPELINE, { github: allLabels() });
  assert.equal(r.ok, true);
  assert.equal(r.checked, true);
  assert.deepEqual(r.warnings, []);
});

test('an environment the owner has not named still blocks the run', () => {
  const dir = productRepo();
  setupRepo({ sourceClaudeDir: CLAUDE_DIR, targetDir: dir, github: allLabels() });
  const r = gate(dir, PIPELINE, { github: allLabels() });
  assert.equal(r.ok, false);
  assert.match(r.message, /Cloud environment/);
  assert.doesNotMatch(r.message, /Harness/);
});

test('with gh unreachable, a saved copy of the labels is used and the start says so', () => {
  const dir = productRepo();
  setUp(dir);
  const r = gate(dir, PIPELINE, { github: fakeGithub([], { unreachable: true }), labelsJson: savedLabels() });
  assert.equal(r.ok, true);
  assert.match(r.warnings.join('\n'), /saved copy/);
  const short = gate(dir, PIPELINE, { github: fakeGithub([], { unreachable: true }), labelsJson: savedLabels(['afk']) });
  assert.equal(short.ok, false);
  assert.match(short.message, /Labels.*missing: spec-approved/);
});

test('a saved copy is ignored while gh can reach GitHub', () => {
  const dir = productRepo();
  setUp(dir);
  const r = gate(dir, PIPELINE, { github: fakeGithub(['afk']), labelsJson: savedLabels() });
  assert.equal(r.ok, false);
  assert.match(r.message, /missing: spec-approved/);
});

test('an unreadable saved copy of the labels needs the owner, and is not a pass', () => {
  const dir = productRepo();
  setUp(dir);
  const missingFile = gate(dir, PIPELINE, { github: fakeGithub([], { unreachable: true }), labelsJson: path.join(tmp(), 'none.json') });
  assert.equal(missingFile.ok, false);
  assert.match(missingFile.message, /saved copy .*could not be read/);
  const bad = path.join(tmp(), 'bad.json');
  fs.writeFileSync(bad, '{"labels": 3}');
  assert.match(gate(dir, PIPELINE, { github: fakeGithub([], { unreachable: true }), labelsJson: bad }).message, /saved copy/);
});

test("the product's own installed harness counts as there when the check runs from it", () => {
  const dir = productRepo();
  setUp(dir);
  const own = path.join(dir, '.claude');
  const res = setupRepo({ sourceClaudeDir: own, targetDir: dir, github: allLabels(), check: true });
  assert.equal(res.ok, true);
  assert.equal(byId(res).harness.status, 'already there');
  assert.equal(res.complete, true);
  assert.equal(productRunGate({ sourceClaudeDir: own, projectDir: dir, verifyCommand: PIPELINE, github: allLabels() }).ok, true);
});

test('setup-repo run from the product\'s own copy fills the other rows and leaves its harness alone', () => {
  const dir = productRepo();
  setUp(dir);
  fs.rmSync(path.join(dir, 'GLOSSARY.md'));
  const stop = path.join(dir, '.claude', 'harness', 'hooks', 'stop.js');
  fs.appendFileSync(stop, '\n// local edit\n');
  const res = setupRepo({ sourceClaudeDir: path.join(dir, '.claude'), targetDir: dir, github: allLabels() });
  assert.equal(res.ok, true);
  assert.equal(byId(res).harness.status, 'already there');
  assert.equal(byId(res).docs.status, 'done');
  assert.match(fs.readFileSync(stop, 'utf8'), /local edit/);
});

test('a change run on a product set up by hand before this command existed is refused with the one command to run', () => {
  // Harness installed by install.js, the two gate labels made by hand, no plugins, docs or environment recorded.
  const dir = productRepo();
  require('../lib/install').install({ sourceClaudeDir: CLAUDE_DIR, targetDir: dir });
  const change = `${PIPELINE} --change 12`;
  const r = gate(dir, change, { github: fakeGithub(['spec-approved', 'accepted', 'afk', 'hitl']) });
  assert.equal(r.ok, false);
  assert.match(r.message, /missing: design-approved, needs-triage, needs-info, wontfix, needs-fable/);
  assert.match(r.message, /Cloud environment/);
  assert.match(r.message, /node \.claude\/harness\/bin\/setup-repo\.js .* --environment <name>/);
  assert.doesNotMatch(r.message, /\[missing\] Harness/);
});

test('harness.js init refuses a product run (exit 2, nothing written) and names the rows', () => {
  const dir = productRepo();
  const r = cli(HARNESS, dir, ['init', '--verify', PIPELINE, '--open-gate-files', '--no-commit-gate']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /setup checklist/);
  assert.match(r.stderr, /Labels/);
  assert.match(r.stderr, /Cloud environment/);
  assert.equal(fs.existsSync(path.join(dir, '.harness', 'state.json')), false);
});

test('harness.js init starts the product run once the checklist is complete, with the saved labels where gh is offline', () => {
  const dir = productRepo();
  setUp(dir);
  const refused = cli(HARNESS, dir, ['init', '--verify', PIPELINE, '--no-commit-gate']);
  assert.equal(refused.status, 2, 'gh offline and no saved copy: labels cannot be confirmed');
  assert.match(refused.stderr, /--labels-json/);
  const r = cli(HARNESS, dir, ['init', '--verify', PIPELINE, '--no-commit-gate', '--labels-json', savedLabels()]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /saved copy/);
  assert.ok(fs.existsSync(path.join(dir, '.harness', 'state.json')));
});

test('harness.js init of a build-only run does not run the setup check', () => {
  const dir = productRepo();
  const r = cli(HARNESS, dir, ['init', '--verify', 'true']);
  assert.equal(r.status, 0, r.stderr);
});

test('setup-repo.js --check accepts --labels-json and reports the labels from the saved copy', () => {
  const dir = productRepo();
  setUp(dir);
  const r = cli(SETUP, dir, [dir, '--check', '--labels-json', savedLabels()]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\[already there\] +Labels.*saved copy/);
});

test('a product whose .claude links to claude-setup is refused, and nothing in claude-setup is written', () => {
  const dir = productRepo();
  fs.symlinkSync(CLAUDE_DIR, path.join(dir, '.claude'));
  const settings = path.join(CLAUDE_DIR, 'settings.json');
  const before = fs.readFileSync(settings, 'utf8');
  const res = setupRepo({ sourceClaudeDir: path.join(dir, '.claude'), targetDir: dir, github: allLabels(), environment: 'x' });
  assert.equal(res.ok, false);
  assert.match(res.message, /claude-setup/);
  assert.equal(fs.readFileSync(settings, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(dir, 'GLOSSARY.md')), false);
  const r = productRunGate({ sourceClaudeDir: path.join(dir, '.claude'), projectDir: dir, verifyCommand: PIPELINE, github: allLabels() });
  assert.equal(r.ok, false);
});

test('a product that copied a marketplace file of its own is still checked', () => {
  const dir = productRepo();
  fs.mkdirSync(path.join(dir, '.claude-plugin'));
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'acme', plugins: [{ name: 'product-team', source: './.claude' }] }));
  assert.equal(isSetupSource(dir), false);
  const r = gate(dir, PIPELINE, { github: allLabels() });
  assert.equal(r.ok, false);
  assert.equal(r.checked, true);
});
