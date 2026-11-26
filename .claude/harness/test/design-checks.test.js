'use strict';
// #111: a design asset is "done" only with its quality check result attached.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const checks = require('../lib/design-checks');
const design = require('../lib/design');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'design-check.js');
const STOP = path.join(ROOT, 'hooks', 'stop-design.js');

const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-design-checks-'));
const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const runBin = (dir, ...args) => spawnSync('node', [BIN, '--root', dir, ...args], { encoding: 'utf8' });
const stopHook = (dir, event = {}) => spawnSync('node', [STOP], {
  input: JSON.stringify({ hook_event_name: 'Stop', ...event }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
});
const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
const gitRepo = (dir) => {
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
};
const commitAll = (dir) => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'x'); };

// A check script that prints a count and exits as told.
const script = (dir, name, { passed, total, exit }) => write(dir, `bin/${name}.sh`,
  `echo '${passed} of ${total} passed'\nexit ${exit}\n`);

const direction = (checksSection) => `# Design direction: gachi

## Look
Flat pastel, thick outlines, chosen 2026-11-25 from variation B.

## Tool
Blender only.

## Characters
- Gachi (cat), Mochi (rabbit)

## Reference images
- docs/design/gachi/references/variation-b.png

## Checks
${checksSection}

## Changed
- 2026-11-25: owner moved from 3D render to flat pastel.
`;

const TWO_CHECKS = [
  '- animations: `sh bin/anim.sh` files: docs/design/gachi/animations/**',
  '- brand-kit: `sh bin/brand.sh` files: docs/design/gachi/brand/**',
].join('\n');

const setup = (dir, { anim = { passed: 56, total: 56, exit: 0 }, brand = { passed: 3, total: 3, exit: 0 } } = {}) => {
  write(dir, 'docs/design/gachi/direction.md', direction(TWO_CHECKS));
  write(dir, 'docs/design/gachi/animations/idle.json', '{"frames":24}');
  write(dir, 'docs/design/gachi/brand/logo.svg', '<svg/>');
  script(dir, 'anim', anim);
  script(dir, 'brand', brand);
};

// --- the Checks section ---

test('parses each asset kind with its command and files', () => {
  const { checks: list, problems } = checks.parseChecks(TWO_CHECKS, 'gachi');
  assert.deepEqual(problems, []);
  assert.deepEqual(list[0], { asset: 'animations', command: 'sh bin/anim.sh', files: ['docs/design/gachi/animations/**'] });
  assert.equal(list[1].asset, 'brand-kit');
});

test('an asset kind without files covers the product folder', () => {
  const { checks: list } = checks.parseChecks('- art: `make check`', 'gachi');
  assert.deepEqual(list[0].files, ['docs/design/gachi/**']);
});

test('a Checks line with no command in backticks, or an asset named twice, is a problem', () => {
  assert.match(checks.parseChecks('- animations: run the benchmark', 'g').problems[0], /backticks/);
  assert.match(checks.parseChecks('- a: `x`\n- a: `y`', 'g').problems[0], /twice/);
});

test('the direction check now needs a Checks section', () => {
  const text = direction(TWO_CHECKS).replace(/## Checks\n[\s\S]*?\n\n/, '');
  assert.ok(design.checkDirection(text).some((p) => /Checks/.test(p)));
  assert.deepEqual(design.checkDirection(direction(TWO_CHECKS)), []);
});

test('the shipped direction template has a Checks section', () => {
  const tpl = fs.readFileSync(path.join(ROOT, 'templates', 'design-direction.md'), 'utf8');
  assert.match(tpl, /^## Checks$/m);
});

// --- counts ---

test('reads a pass count from common test output', () => {
  assert.deepEqual(checks.countFrom('0 of 56 passed'), { passed: 0, total: 56 });
  assert.deepEqual(checks.countFrom('result: 12/12 passing'), { passed: 12, total: 12 });
  assert.deepEqual(checks.countFrom('Tests: 50 passed, 6 failed'), { passed: 50, total: 56 });
  assert.deepEqual(checks.countFrom('# pass 9\n# fail 1\n'), { passed: 9, total: 10 });
  assert.deepEqual(checks.countFrom('3 passed'), { passed: 3, total: 3 });
  assert.equal(checks.countFrom('all good'), null);
});

// --- run: pass, fail ---

test('run records a pass with exit code, count and time, and exits 0', () => {
  const dir = project();
  setup(dir);
  const r = runBin(dir, 'run');
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(read(dir, 'docs/design/gachi/checks.json'));
  const rec = data.records.find((x) => x.asset === 'animations');
  assert.equal(rec.command, 'sh bin/anim.sh');
  assert.equal(rec.exit, 0);
  assert.equal(rec.passed, 56);
  assert.equal(rec.total, 56);
  assert.equal(rec.ok, true);
  assert.match(rec.at, /^\d{4}-\d\d-\d\dT/);
  assert.match(rec.line, /^animations: pass - 56\/56 passed, exit 0, /);
  assert.ok(r.stdout.includes(rec.line));
});

test('run records a fail and fails itself when any check fails', () => {
  const dir = project();
  setup(dir, { anim: { passed: 0, total: 56, exit: 1 } });
  const r = runBin(dir, 'run');
  assert.equal(r.status, 1);
  const rec = JSON.parse(read(dir, 'docs/design/gachi/checks.json')).records.find((x) => x.asset === 'animations');
  assert.equal(rec.exit, 1);
  assert.equal(rec.passed, 0);
  assert.equal(rec.ok, false);
  assert.match(rec.line, /^animations: fail - 0\/56 passed, exit 1/);
  assert.match(r.stderr, /1 of 2 check\(s\) failed/);
});

test('a count below the total is a fail even when the command exits 0', () => {
  const dir = project();
  setup(dir, { anim: { passed: 50, total: 56, exit: 0 } });
  assert.equal(runBin(dir, 'run').status, 1);
  const rec = JSON.parse(read(dir, 'docs/design/gachi/checks.json')).records[0];
  assert.equal(rec.ok, false);
});

test('a command that prints no count passes on exit 0 and says no count was printed', () => {
  const dir = project();
  write(dir, 'docs/design/gachi/direction.md', direction('- art: `true`'));
  assert.equal(runBin(dir, 'run').status, 0);
  const rec = JSON.parse(read(dir, 'docs/design/gachi/checks.json')).records[0];
  assert.equal(rec.passed, null);
  assert.match(rec.line, /no count printed/);
});

test('run --asset runs only that check and keeps the other record', () => {
  const dir = project();
  setup(dir);
  runBin(dir, 'run');
  script(dir, 'anim', { passed: 1, total: 56, exit: 1 });
  assert.equal(runBin(dir, 'run', '--asset', 'brand-kit').status, 0);
  const data = JSON.parse(read(dir, 'docs/design/gachi/checks.json'));
  assert.equal(data.records.length, 2);
  assert.equal(data.records.find((x) => x.asset === 'animations').passed, 56);
});

test('run with an unknown asset or product, or no Checks, fails and says why', () => {
  const dir = project();
  setup(dir);
  assert.match(runBin(dir, 'run', '--asset', 'nope').stderr, /no check named "nope"/);
  assert.match(runBin(dir, 'run', '--product', 'nope').stderr, /no product folder "nope"/);
  const empty = project();
  write(empty, 'docs/design/gachi/direction.md', direction('<none yet>'));
  const r = runBin(empty, 'run');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no checks/);
});

// --- status: done, failing, missing, stale ---

test('status calls an asset done only with its passing, current check line', () => {
  const dir = project();
  setup(dir);
  runBin(dir, 'run');
  const r = runBin(dir, 'status');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /done: animations: pass - 56\/56 passed/);
  assert.match(r.stdout, /done: brand-kit: pass/);
});

test('status lists a failing check as not done', () => {
  const dir = project();
  setup(dir, { anim: { passed: 0, total: 56, exit: 1 } });
  runBin(dir, 'run');
  const r = runBin(dir, 'status');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /not done: animations - check failed: animations: fail - 0\/56 passed/);
});

test('status lists an asset with no record as not done', () => {
  const dir = project();
  setup(dir);
  const r = runBin(dir, 'status');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /not done: animations - no check record/);
});

test('a design file changed after the last record is reported as stale', () => {
  const dir = project();
  setup(dir);
  runBin(dir, 'run');
  write(dir, 'docs/design/gachi/animations/idle.json', '{"frames":30}');
  write(dir, 'docs/design/gachi/animations/walk.json', '{}');
  const r = runBin(dir, 'status');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /not done: animations - stale: changed since the check .*idle\.json.*walk\.json/);
  assert.match(r.stdout, /done: brand-kit/);
});

test('a removed design file makes the record stale too', () => {
  const dir = project();
  setup(dir);
  runBin(dir, 'run');
  fs.rmSync(path.join(dir, 'docs/design/gachi/brand/logo.svg'));
  assert.match(runBin(dir, 'status').stdout, /not done: brand-kit - stale: .*logo\.svg/);
});

test('bookkeeping files do not make a record stale', () => {
  const dir = project();
  write(dir, 'docs/design/gachi/direction.md', direction('- art: `true`'));
  write(dir, 'docs/design/gachi/a.png', 'x');
  runBin(dir, 'run');
  write(dir, 'docs/design/gachi/pages.json', '{"product":"gachi","pages":[]}');
  write(dir, 'docs/design/gachi/direction.md', `${direction('- art: `true`')}\n`);
  assert.equal(runBin(dir, 'status').status, 0);
});

test('a broken checks.json is reported, never read as passing', () => {
  const dir = project();
  setup(dir);
  write(dir, 'docs/design/gachi/checks.json', '{bad');
  const r = runBin(dir, 'status');
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /checks\.json/);
  assert.match(runBin(dir).stderr, /checks\.json/);
});

test('the plain design-check also fails on a bad Checks line', () => {
  const dir = project();
  write(dir, 'docs/design/gachi/direction.md', direction('- animations: run the benchmark'));
  const r = runBin(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /backticks/);
});

// --- Stop hook ---

test('stop hook tells the session to run the check when design files changed after the record', () => {
  const dir = project();
  setup(dir);
  runBin(dir, 'run');
  write(dir, 'docs/design/gachi/animations/idle.json', '{"frames":30}');
  const r = stopHook(dir);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /animations/);
  assert.match(out.reason, /design-check\.js run/);
});

test('stop hook stays quiet when records are current, and on its own second firing', () => {
  const dir = project();
  setup(dir);
  runBin(dir, 'run');
  assert.equal(stopHook(dir).stdout, '');
  write(dir, 'docs/design/gachi/animations/idle.json', '{"frames":30}');
  assert.equal(stopHook(dir, { stop_hook_active: true }).stdout, '');
});

test('stop hook is quiet with no design folder and fails open on bad input', () => {
  assert.equal(stopHook(project()).stdout, '');
  const r = spawnSync('node', [STOP], { input: '{bad', encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: project() } });
  assert.equal(r.stdout, '');
});

test('stop hook asks for a first check only when an unchecked asset has uncommitted changes', () => {
  const dir = project();
  gitRepo(dir);
  setup(dir);
  commitAll(dir);
  assert.equal(stopHook(dir).stdout, '', 'committed, never-checked assets do not hold every session');
  write(dir, 'docs/design/gachi/animations/idle.json', '{"frames":30}');
  const out = JSON.parse(stopHook(dir).stdout);
  assert.match(out.reason, /animations.*no check record/);
  assert.doesNotMatch(out.reason, /brand-kit/);
});

test('a committed check record stays current in a fresh clone', () => {
  const dir = project();
  gitRepo(dir);
  setup(dir);
  runBin(dir, 'run');
  commitAll(dir);
  const clone = project();
  git(clone, 'clone', '-q', dir, '.');
  assert.equal(runBin(clone, 'status').status, 0);
});

test('settings register the design Stop hook', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'settings.json'), 'utf8'));
  const cmds = settings.hooks.Stop.flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(cmds.some((c) => c.includes('stop-design.js')));
});

// --- skill and brief ---

test('the brief check needs Done means to ask for the check line', () => {
  const brief = `# Brief: idle

## Task
Make the idle loop.

## Direction
Read docs/design/gachi/direction.md first.

## Page and owner
Page https://claude.ai/artifact/1 is owned by session s1.

## Hand back
Files on branch x, then send_message.

## Done means
The loop plays at 24 fps.
`;
  assert.ok(design.checkBrief(brief).some((p) => /checks\.json/.test(p)));
  const fixed = brief.replace('The loop plays at 24 fps.', 'The loop plays at 24 fps; report done only with its line from checks.json.');
  assert.deepEqual(design.checkBrief(fixed), []);
  const tpl = fs.readFileSync(path.join(ROOT, 'templates', 'design-brief.md'), 'utf8');
  assert.match(tpl.split('## Done means')[1], /checks\.json/);
});

test('the skill states the done-only-with-a-check-line rule', () => {
  const skill = fs.readFileSync(path.join(ROOT, '..', 'skills', 'design-sessions', 'SKILL.md'), 'utf8');
  assert.match(skill, /## Done only with a check line/);
  assert.match(skill, /checks\.json/);
  assert.match(skill, /not done/);
});

// --- review fixes ---

test('a stale record holds only a session with uncommitted changes to that asset', () => {
  const dir = project();
  gitRepo(dir);
  setup(dir);
  runBin(dir, 'run');
  write(dir, 'docs/design/gachi/animations/idle.json', '{"frames":30}');
  commitAll(dir);
  assert.equal(stopHook(dir).stdout, '', 'a stale record from a merge does not hold an unrelated session');
  assert.match(runBin(dir, 'status').stdout, /not done: animations - stale/, 'status still says not done');
  write(dir, 'docs/design/gachi/animations/idle.json', '{"frames":31}');
  assert.match(JSON.parse(stopHook(dir).stdout).reason, /animations/);
});

test('a check that writes inside its own files is current right after run, and one that deletes a file does not crash', () => {
  const dir = project();
  write(dir, 'docs/design/gachi/direction.md', direction([
    '- art: `mkdir -p docs/design/gachi/art && echo r > docs/design/gachi/art/report.txt` files: docs/design/gachi/art/**',
    '- old: `rm docs/design/gachi/old/a.png` files: docs/design/gachi/old/**',
  ].join('\n')));
  write(dir, 'docs/design/gachi/old/a.png', 'x');
  const r = runBin(dir, 'run');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(runBin(dir, 'status').status, 0);
});

test('brace globs are refused instead of silently matching nothing', () => {
  assert.match(checks.parseChecks('- art: `true` files: **/*.{png,jpg}', 'g').problems[0], /braces/);
});

test('a check that ran no tests is a fail', () => {
  const dir = project();
  write(dir, 'docs/design/gachi/direction.md', direction("- art: `echo '# pass 0'; echo '# fail 0'`"));
  assert.equal(runBin(dir, 'run').status, 1);
  assert.match(read(dir, 'docs/design/gachi/checks.json'), /0\/0 passed/);
});

test('an uncommitted file outside the design work does not hold the turn', () => {
  const dir = project();
  gitRepo(dir);
  setup(dir);
  commitAll(dir);
  write(dir, 'README.md', 'notes');
  assert.equal(stopHook(dir).stdout, '');
});
