'use strict';
// The adapter catalogue (#62): what the orchestrator offers at kickoff, with each adapter's status, and the
// reader pipeline.js uses for the design phase's Stack section.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CATALOGUE_FILE, STATUSES, OPTIONS, loadCatalogue, findAdapter, readStack, missingChecksOf } = require('../lib/catalogue');

const REPO = path.join(__dirname, '..', '..', '..');
const catalogue = loadCatalogue();

test('the catalogue lives in .claude/harness/adapters/ and lists the initial entries with their status', () => {
  assert.equal(CATALOGUE_FILE, path.join(__dirname, '..', 'adapters', 'catalogue.json'));
  const status = Object.fromEntries(catalogue.adapters.map((a) => [a.id, a.status]));
  assert.equal(status.node, 'proven');
  assert.equal(status['vitest-stryker'], 'experimental');
  assert.equal(status.junit, 'experimental');
  for (const id of ['python', 'rust', 'dotnet', 'expo-react-native', 'electron', 'wechat']) assert.equal(status[id], 'planned', id);
});

test('every entry names its stacks, product kinds, checks, missing checks and a known status', () => {
  const ids = new Set();
  for (const a of catalogue.adapters) {
    assert.ok(!ids.has(a.id), `${a.id} is listed twice`);
    ids.add(a.id);
    assert.ok(STATUSES.includes(a.status), a.id);
    assert.ok(Array.isArray(a.stacks) && a.stacks.length > 0, a.id);
    assert.ok(Array.isArray(a.productKinds) && a.productKinds.length > 0, a.id);
    assert.ok(Array.isArray(a.checks), a.id);
    assert.ok(Array.isArray(a.missingChecks), a.id);
  }
  assert.deepEqual(Object.keys(catalogue.statuses).sort(), [...STATUSES].sort());
  assert.deepEqual(Object.keys(catalogue.unsupportedOptions).sort(), [...OPTIONS].sort());
});

test('every proven or experimental entry has a fixture that exists', () => {
  const built = catalogue.adapters.filter((a) => a.status !== 'planned');
  assert.ok(built.length >= 3);
  for (const a of built) {
    assert.equal(typeof a.fixture, 'string', `${a.id} has no fixture`);
    assert.ok(fs.existsSync(path.join(REPO, a.fixture)), `${a.id}: fixture ${a.fixture} does not exist`);
  }
});

test('a planned entry claims no checks and no fixture', () => {
  for (const a of catalogue.adapters.filter((x) => x.status === 'planned')) {
    assert.deepEqual(a.checks, [], a.id);
    assert.equal(a.fixture, null, a.id);
  }
});

test('the junit entry lists the checks its weaker gate leaves out; the full adapters list none', () => {
  assert.deepEqual(missingChecksOf(findAdapter(catalogue, 'junit')), ['test-quality', 'coverage', 'mutation']);
  assert.deepEqual(missingChecksOf(findAdapter(catalogue, 'node')), []);
  assert.deepEqual(missingChecksOf(findAdapter(catalogue, 'vitest-stryker')), []);
  assert.equal(findAdapter(catalogue, 'cobol'), null);
});

test('the catalogue is not referenced from always-loaded rules (token cost unchanged)', () => {
  const files = [path.join(REPO, 'CLAUDE.md')];
  const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else files.push(p);
  });
  walk(path.join(REPO, '.claude', 'rules'));
  assert.ok(files.length > 1);
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /catalogue/i, f);
});

// ---- the Stack section of design.md

const design = (stack) => `# Design\n\nSome text.\n\n## Stack\n\n${stack}\n\n## Data\n\nAdapter: rust (planned) is outside the section.\n`;

test('a Stack section naming a catalogue adapter with its status is complete', () => {
  assert.deepEqual(readStack(design('Adapter: node (proven)'), catalogue), { problems: [], adapter: 'node', option: null, weakerGate: null });
  assert.deepEqual(readStack(design('- Adapter: `vitest-stryker` (experimental)\nAlternative: node (proven)'), catalogue).adapter, 'vitest-stryker');
});

test('the Stack section must exist and name an adapter or an unsupported-stack option', () => {
  assert.match(readStack('# Design\n', catalogue).problems[0], /design\.md has no "## Stack" section/);
  assert.match(readStack(null, catalogue).problems[0], /no "## Stack" section/);
  assert.match(readStack(design('We like Node.'), catalogue).problems[0], /names no adapter: record "Adapter: <id> \(<status>\)"/);
});

test('an adapter outside the catalogue, a wrong status or a planned adapter is refused', () => {
  assert.match(readStack(design('Adapter: cobol (proven)'), catalogue).problems[0], /"cobol" is not in the adapter catalogue/);
  assert.match(readStack(design('Adapter: vitest-stryker (proven)'), catalogue).problems[0], /gives vitest-stryker as "proven", but the catalogue lists it as "experimental"/);
  assert.match(readStack(design('Adapter: python (planned)'), catalogue).problems[0], /python is planned: no adapter exists yet[\s\S]*Unsupported:/);
  assert.match(readStack(design('Adapter: node (proven)\nAdapter: junit (experimental)'), catalogue).problems[0], /names more than one adapter/);
});

test('design.md with more than one Stack section is refused', () => {
  const twice = `${design('Adapter: node (proven)')}\n## Stack\n\nAdapter: vitest-stryker (experimental)\n`;
  assert.match(readStack(twice, catalogue).problems[0], /design\.md has more than one "## Stack" section/);
});

test('the junit entry states its limits plainly', () => {
  const { limits } = findAdapter(catalogue, 'junit');
  assert.ok(limits.includes('report contract proven with a stand-in runner only'));
  assert.ok(limits.includes('vitest runner proven through the vitest-stryker fixture'));
  assert.ok(limits.includes('playwright as the main runner unproven'));
});

test('an unsupported stack records one of the three options', () => {
  const first = readStack(design('Unsupported: Python + FastAPI; option: adapter first'), catalogue);
  assert.deepEqual(first, { problems: [], adapter: null, option: 'adapter first', weakerGate: null });
  const weaker = readStack(design('Unsupported: Python + FastAPI; option: weaker gate\nAdapter: junit (experimental)\n- Weaker gate: coverage, test-quality'), catalogue);
  assert.deepEqual(weaker, { problems: [], adapter: 'junit', option: 'weaker gate', weakerGate: ['coverage', 'test-quality'] });
  assert.match(readStack(design('Unsupported: Python; option: weaker gate\nAdapter: junit (experimental)'), catalogue).problems[0], /option "weaker gate" needs a line "Weaker gate: <checks>" in the Stack section/);
  const alt = readStack(design('Unsupported: Rust; option: supported alternative\nAdapter: node (proven)'), catalogue);
  assert.deepEqual(alt, { problems: [], adapter: 'node', option: 'supported alternative', weakerGate: null });
  assert.match(readStack(design('Unsupported: Rust; option: supported alternative'), catalogue).problems[0], /option "supported alternative" runs an adapter from the catalogue: add "Adapter: <id> \(<status>\)"/);
  assert.match(readStack(design('Unsupported: Rust; option: wing it'), catalogue).problems[0], /records no option: write "Unsupported: <stack>; option: supported alternative\|weaker gate\|adapter first"/);
});

// ---- the weaker gate is printed by verify.js on every run, passing or not (#57 behaviour, reused here)

const STANDIN = path.join(__dirname, 'fixtures', 'standin-runner.sh');
const { NODE_TEST_CONTEXT, ...cleanEnv } = process.env;
function weakerProject(cases) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-weaker-'));
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'tests', 'cases.txt'), cases);
  const cfg = { adapter: 'junit', runner: 'standin-pytest', testCommand: `sh ${JSON.stringify(STANDIN)} tests/cases.txt`, minTests: 2, replicates: 1, weakerGate: { missing: ['coverage', 'test-quality', 'mutation'], decision: 'decisions.md: Weaker gate' } };
  fs.writeFileSync(path.join(dir, 'verify.config.json'), JSON.stringify(cfg));
  return dir;
}
const verify = (dir, ...args) => spawnSync('node', [path.join(__dirname, '..', 'bin', 'verify.js'), ...args], { cwd: dir, encoding: 'utf8', env: cleanEnv });

test('verify.js prints a weaker gate\'s missing checks on every run: passing, failing and --fast', () => {
  const line = /not checked \(weaker gate, junit adapter\): coverage, test-quality, mutation \(owner decision: decisions\.md: Weaker gate\)/;
  const pass = verify(weakerProject('pass adds\npass subtracts\n'));
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.match(pass.stdout, line);
  const fail = verify(weakerProject('pass adds\nfail subtracts\n'));
  assert.equal(fail.status, 1, fail.stdout + fail.stderr);
  assert.match(fail.stdout, line);
  const fast = verify(weakerProject('pass adds\npass subtracts\n'), '--fast');
  assert.match(fast.stdout, line);
});
