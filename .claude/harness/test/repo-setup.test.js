'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { setupRepo, ghClient, parseRepo, formatChecklist, LABELS, GATE_LABELS } = require('../lib/repo-setup');

const CLAUDE_DIR = path.join(__dirname, '..', '..');
const BIN = path.join(__dirname, '..', 'bin', 'setup-repo.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'repo-setup-'));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const byId = (res) => Object.fromEntries(res.rows.map((r) => [r.id, r]));

// A GitHub stand-in: a set of existing label names; records every create.
function fakeGithub(existing = [], { unreachable = false } = {}) {
  const have = new Set(existing);
  const created = [];
  return {
    created,
    listLabels: () => (unreachable ? { ok: false, message: 'could not resolve host' } : { ok: true, names: [...have] }),
    createLabel: (_repo, label) => { have.add(label.name); created.push(label.name); return { ok: true }; },
  };
}
const run = (dir, opts = {}) => setupRepo({ sourceClaudeDir: CLAUDE_DIR, targetDir: dir, repo: 'acme/shop', ...opts });

test('sets up every row in an empty repository and leaves only the environment for the owner', () => {
  const dir = tmp();
  const github = fakeGithub(['bug']);
  const res = run(dir, { github });
  const rows = byId(res);
  assert.deepEqual(res.rows.map((r) => r.id), ['harness', 'product-team', 'mattpocock-skills', 'labels', 'docs', 'environment']);
  for (const id of ['harness', 'product-team', 'mattpocock-skills', 'labels', 'docs']) assert.equal(rows[id].status, 'done', id);
  assert.equal(rows.environment.status, 'needs you');
  assert.match(rows.environment.action, /--environment <name>/);
  assert.match(rows.environment.link, /^https:\/\//);
  assert.equal(res.complete, false);
  assert.deepEqual(github.created.sort(), LABELS.map((l) => l.name).sort());
  const s = readJson(path.join(dir, '.claude', 'settings.json'));
  assert.equal(s.enabledPlugins['product-team@jyeann'], true);
  assert.equal(s.enabledPlugins['mattpocock-skills@jyeann'], true);
  assert.equal(s.extraKnownMarketplaces.jyeann.source.repo, 'jyeann/claude-setup');
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'harness', 'hooks', 'stop.js')));
  for (const f of ['docs/agents/issue-tracker.md', 'docs/agents/triage-labels.md', 'docs/agents/domain.md', 'GLOSSARY.md', 'docs/adr/README.md']) {
    assert.ok(fs.existsSync(path.join(dir, f)), f);
  }
  assert.match(fs.readFileSync(path.join(dir, 'docs/agents/issue-tracker.md'), 'utf8'), /`acme\/shop`/);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'docs/agents/issue-tracker.md'), 'utf8'), /\{\{/);
});

test('records the named cloud environment and is complete', () => {
  const dir = tmp();
  const res = run(dir, { github: fakeGithub(), environment: 'acme-shop' });
  assert.equal(byId(res).environment.status, 'done');
  assert.match(fs.readFileSync(path.join(dir, 'docs/agents/environment.md'), 'utf8'), /^Cloud environment: acme-shop$/m);
  assert.equal(res.complete, true);
});

test('a second run changes nothing and reports every row as already there', () => {
  const dir = tmp();
  run(dir, { github: fakeGithub(), environment: 'acme-shop' });
  const snapshot = () => fs.readdirSync(dir, { recursive: true }).sort()
    .map((f) => `${f} ${fs.statSync(path.join(dir, f)).mtimeMs}`).join('\n');
  const before = snapshot();
  const settings = fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8');
  const glossary = fs.readFileSync(path.join(dir, 'GLOSSARY.md'), 'utf8');
  const github = fakeGithub(LABELS.map((l) => l.name));
  const res = run(dir, { github });
  for (const r of res.rows) assert.equal(r.status, 'already there', r.id);
  assert.equal(res.complete, true);
  assert.deepEqual(github.created, []);
  assert.equal(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'), settings);
  assert.equal(fs.readFileSync(path.join(dir, 'GLOSSARY.md'), 'utf8'), glossary);
  assert.equal(snapshot(), before);
});

test('reports what was missing on a re-run and keeps files the owner wrote', () => {
  const dir = tmp();
  run(dir, { github: fakeGithub(), environment: 'acme-shop' });
  fs.writeFileSync(path.join(dir, 'GLOSSARY.md'), '# Mine\n');
  fs.rmSync(path.join(dir, 'docs', 'adr'), { recursive: true });
  const github = fakeGithub(LABELS.map((l) => l.name).filter((n) => n !== 'needs-fable'));
  const rows = byId(run(dir, { github }));
  assert.equal(rows.docs.status, 'done');
  assert.match(rows.docs.detail, /docs\/adr\/README\.md/);
  assert.doesNotMatch(rows.docs.detail, /GLOSSARY/);
  assert.equal(fs.readFileSync(path.join(dir, 'GLOSSARY.md'), 'utf8'), '# Mine\n');
  assert.equal(rows.labels.status, 'done');
  assert.match(rows.labels.detail, /needs-fable/);
  assert.deepEqual(github.created, ['needs-fable']);
  assert.equal(rows.harness.status, 'already there');
});

test('check mode writes nothing and creates no label', () => {
  const dir = tmp();
  const github = fakeGithub();
  const res = run(dir, { github, check: true });
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.deepEqual(github.created, []);
  assert.equal(res.complete, false);
  for (const id of ['harness', 'product-team', 'mattpocock-skills', 'labels', 'docs']) assert.equal(byId(res)[id].status, 'missing', id);
  assert.match(byId(res).labels.detail, /spec-approved/);
});

test('unreachable GitHub leaves labels to the owner with the link and the list', () => {
  const dir = tmp();
  const rows = byId(run(dir, { github: fakeGithub([], { unreachable: true }) }));
  assert.equal(rows.labels.status, 'needs you');
  assert.equal(rows.labels.link, 'https://github.com/acme/shop/labels');
  assert.match(rows.labels.action, /spec-approved/);
  assert.match(rows.labels.detail, /could not resolve host/);
});

test('without a repository name the labels row asks for --repo', () => {
  const dir = tmp();
  const rows = byId(setupRepo({ sourceClaudeDir: CLAUDE_DIR, targetDir: dir, github: fakeGithub() }));
  assert.equal(rows.labels.status, 'needs you');
  assert.match(rows.labels.action, /--repo owner\/name/);
});

test('a plugin the owner switched off stays off and is reported', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'mattpocock-skills@jyeann': false } }));
  const rows = byId(run(dir, { github: fakeGithub() }));
  assert.equal(rows['mattpocock-skills'].status, 'needs you');
  assert.match(rows['mattpocock-skills'].action, /enabledPlugins/);
  assert.equal(readJson(path.join(dir, '.claude', 'settings.json')).enabledPlugins['mattpocock-skills@jyeann'], false);
  assert.equal(rows['product-team'].status, 'done');
});

test('a refused harness install is a needs-you row and the other rows still run', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.harness'));
  fs.writeFileSync(path.join(dir, '.harness', 'state.json'), '{}');
  const rows = byId(run(dir, { github: fakeGithub() }));
  assert.equal(rows.harness.status, 'needs you');
  assert.match(rows.harness.action, /harness\.js off/);
  assert.equal(rows.docs.status, 'done');
});

test('invalid settings.json stops the plugin rows without overwriting the file', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ nope');
  const rows = byId(run(dir, { github: fakeGithub() }));
  assert.equal(rows['product-team'].status, 'needs you');
  assert.equal(rows.harness.status, 'needs you');
  assert.equal(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'), '{ nope');
});

test('refuses a target that is not a directory or is this repository', () => {
  assert.equal(setupRepo({ sourceClaudeDir: CLAUDE_DIR, targetDir: path.join(tmp(), 'nope') }).ok, false);
  const self = setupRepo({ sourceClaudeDir: CLAUDE_DIR, targetDir: path.join(CLAUDE_DIR, '..') });
  assert.equal(self.ok, false);
  assert.match(self.message, /this repository/);
});

test('the gh client only reads and creates repository labels, never touches an issue', () => {
  const calls = [];
  const runner = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args.includes('POST')) return { status: 0, stdout: '{}', stderr: '' };
    return { status: 0, stdout: 'bug\nafk\n', stderr: '' };
  };
  const gh = ghClient(runner);
  assert.deepEqual(gh.listLabels('acme/shop'), { ok: true, names: ['bug', 'afk'] });
  for (const label of LABELS) assert.equal(gh.createLabel('acme/shop', label).ok, true);
  for (const c of calls) {
    assert.equal(c[0], 'gh');
    assert.equal(c[1], 'api');
    assert.ok(c.includes('repos/acme/shop/labels'), c.join(' '));
    assert.ok(!c.some((a) => /issues/.test(a)), c.join(' '));
  }
  assert.ok(GATE_LABELS.every((g) => LABELS.some((l) => l.name === g)));
});

test('the gh client reports a failure with its first stderr line', () => {
  const gh = ghClient(() => ({ status: 1, stdout: '', stderr: 'HTTP 404: Not Found\nmore' }));
  assert.deepEqual(gh.listLabels('acme/shop'), { ok: false, message: 'HTTP 404: Not Found' });
  assert.equal(gh.createLabel('acme/shop', LABELS[0]).ok, false);
  const missing = ghClient(() => ({ error: new Error('spawn gh ENOENT') }));
  assert.match(missing.listLabels('acme/shop').message, /ENOENT/);
});

test('reads owner/name from GitHub and proxy remote URLs', () => {
  assert.equal(parseRepo('https://github.com/acme/shop.git'), 'acme/shop');
  assert.equal(parseRepo('git@github.com:acme/shop.git'), 'acme/shop');
  assert.equal(parseRepo('http://proxy@127.0.0.1:1234/git/acme/shop'), 'acme/shop');
  assert.equal(parseRepo(''), null);
});

test('the checklist shows each row, and a link and one action for every needs-you row', () => {
  const dir = tmp();
  const res = run(dir, { github: fakeGithub([], { unreachable: true }) });
  const text = formatChecklist(res);
  assert.match(text, /\[done\] +Harness/);
  assert.match(text, /\[needs you\] +Labels/);
  assert.match(text, /-> https:\/\/github\.com\/acme\/shop\/labels/);
  assert.match(text, /2 row\(s\) need you/);
});

test('every needs-you row carries a link and one action', () => {
  const dirs = [];
  const rows = [];
  const add = (dir, opts) => { dirs.push(dir); rows.push(...run(dir, opts).rows); };
  add(tmp(), { github: fakeGithub([], { unreachable: true }) });
  const off = tmp();
  fs.mkdirSync(path.join(off, '.claude'));
  fs.writeFileSync(path.join(off, '.claude', 'settings.json'), '{ nope');
  add(off, { github: fakeGithub() });
  const switched = tmp();
  fs.mkdirSync(path.join(switched, '.claude'));
  fs.writeFileSync(path.join(switched, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'product-team@jyeann': false } }));
  add(switched, { github: fakeGithub() });
  const busy = tmp();
  fs.mkdirSync(path.join(busy, '.harness'));
  fs.writeFileSync(path.join(busy, '.harness', 'state.json'), '{}');
  add(busy, { github: fakeGithub() });
  rows.push(...setupRepo({ sourceClaudeDir: CLAUDE_DIR, targetDir: tmp(), github: fakeGithub() }).rows);
  const owner = rows.filter((r) => r.status === 'needs you');
  assert.deepEqual([...new Set(owner.map((r) => r.id))].sort(), ['environment', 'harness', 'labels', 'mattpocock-skills', 'product-team']);
  for (const r of owner) {
    assert.ok(r.link, `${r.id}: ${r.detail}`);
    assert.ok(r.action, r.id);
  }
});

test('labels that exist in another letter case count as there', () => {
  const github = fakeGithub(LABELS.map((l) => l.name.toUpperCase()));
  const rows = byId(run(tmp(), { github }));
  assert.equal(rows.labels.status, 'already there');
  assert.deepEqual(github.created, []);
});

test('refuses a --repo that is not owner/name', () => {
  for (const repo of ['acme', 'acme/shop/issues/1', '../x', 'acme/..', 'a b/c']) {
    const res = run(tmp(), { repo, github: fakeGithub() });
    assert.equal(res.ok, false, repo);
    assert.match(res.message, /owner\/name/);
  }
  assert.equal(parseRepo('https://example.com/acme/..'), null);
});

test('naming a new environment keeps the rest of the environment file', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true });
  const file = path.join(dir, 'docs', 'agents', 'environment.md');
  fs.writeFileSync(file, '# Env\n\nKeys: STRIPE\nCloud environment: old\n');
  assert.equal(byId(run(dir, { github: fakeGithub(), environment: 'new-env' })).environment.status, 'done');
  assert.equal(fs.readFileSync(file, 'utf8'), '# Env\n\nKeys: STRIPE\nCloud environment: new-env\n');
  fs.writeFileSync(file, '# Env\nKeys: STRIPE');
  run(dir, { github: fakeGithub(), environment: 'new-env' });
  assert.equal(fs.readFileSync(file, 'utf8'), '# Env\nKeys: STRIPE\nCloud environment: new-env\n');
  const bad = byId(run(dir, { github: fakeGithub(), environment: 'bad/name' })).environment;
  assert.equal(bad.status, 'needs you');
});

test('the CLI refuses unknown options, missing values and two targets without writing', () => {
  const dir = tmp();
  const env = { ...process.env, PATH: tmp() };
  for (const args of [['--chek'], ['--repo', '--check'], ['--environment'], [tmp()], ['--repo', 'acme/shop/x']]) {
    const r = spawnSync(process.execPath, [BIN, dir, ...args], { encoding: 'utf8', env });
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /^setup-repo: /);
  }
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('the CLI exits 0 when complete, 1 while a row needs the owner, and 2 when refused', () => {
  const dir = tmp();
  // An empty PATH, so no real gh can be reached: labels need the owner, everything else is set up.
  const env = { ...process.env, PATH: tmp() };
  const first = spawnSync(process.execPath, [BIN, dir, '--repo', 'acme/shop'], { encoding: 'utf8', env });
  assert.equal(first.status, 1, first.stderr);
  assert.match(first.stdout, /\[needs you\] +Labels/);
  assert.match(first.stdout, /\[done\] +Harness/);
  const check = spawnSync(process.execPath, [BIN, dir, '--repo', 'acme/shop', '--check'], { encoding: 'utf8', env });
  assert.equal(check.status, 1);
  assert.match(check.stdout, /\[already there\] +Harness/);
  const refused = spawnSync(process.execPath, [BIN, path.join(dir, 'nope')], { encoding: 'utf8', env });
  assert.equal(refused.status, 2);
  // A fake gh that knows every label makes the checklist complete.
  const bin = tmp();
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nprintf '%s\\n' ${LABELS.map((l) => l.name).join(' ')}\n`, { mode: 0o755 });
  const done = spawnSync(process.execPath, [BIN, dir, '--repo', 'acme/shop', '--environment', 'acme-shop'], {
    encoding: 'utf8', env: { ...env, PATH: `${bin}:${env.PATH}` },
  });
  assert.equal(done.status, 0, done.stdout + done.stderr);
  assert.match(done.stdout, /Checklist complete/);
});
