'use strict';
// The vitest-stryker adapter preset (#60): one setting that expands to the report contract with Vitest for tests
// and coverage, Stryker (vitest runner) for mutation, Playwright for journeys and a required type check; test
// quality runs (the JS checker, .tsx test files included), so the gate is full with no weakerGate; and the tool
// configs that could weaken it are protected while a harness run is active and in CI. The real tools are
// exercised by the slug-react fixture; these tests use stand-ins so the harness stays dependency-free.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig } = require('../lib/strong-verify');
const { analyzeTestFile } = require('../lib/test-quality');
const { checkWrite, checkBash } = require('../lib/guards');
const { buildState } = require('../lib/state');
const { ADAPTER_PROTECTED, adapterProtected, changedProtected, matchesProtected } = require('../lib/protected');

const VERIFY = path.join(__dirname, '..', 'bin', 'verify.js');
const CHECK_PROTECTED = path.join(__dirname, '..', 'bin', 'check-protected.js');
const STRYKER = path.join(__dirname, 'fixtures', 'standin-stryker.js');

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const configFile = (raw) => { const file = path.join(tmp('vs-config-'), 'verify.config.json'); fs.writeFileSync(file, JSON.stringify(raw)); return file; };
const load = (raw) => loadConfig(configFile(raw));

// ---- the preset

test('"adapter": "vitest-stryker" fills in Vitest, Stryker on the vitest runner, Playwright journeys and a type check', () => {
  const config = load({ adapter: 'vitest-stryker', holdout: { command: 'npx vitest run --dir hidden-tests' }, journeys: { command: 'npx playwright test' } });
  assert.equal(config.adapter, 'vitest-stryker');
  assert.equal(config.runner, 'vitest');
  assert.equal(config.testCommand, 'npx vitest run');
  assert.equal(config.typecheck.command, 'npx tsc --noEmit -p tsconfig.json');
  assert.equal(config.mutation.command, 'npx stryker run');
  assert.equal(config.mutation.testRunner, 'vitest');
  assert.deepEqual(config.mutation.checkers, [], 'Stryker\'s TypeScript checker is off by default (spike: +68% time); tsc runs once instead');
  assert.equal(config.holdout.runner, 'vitest');
  assert.equal(config.journeys.runner, 'playwright');
  assert.equal(config.weakerGate, null);
});

test('the preset keeps what the project sets: commands, thresholds and an opt-in checker', () => {
  const config = load({
    adapter: 'vitest-stryker', testCommand: 'npm test --', typecheck: { command: 'npx vue-tsc --noEmit' },
    mutation: { command: 'npm exec stryker run', checkers: ['typescript'], samples: 3, minKillRate: 0.8 },
  });
  assert.equal(config.testCommand, 'npm test --');
  assert.equal(config.typecheck.command, 'npx vue-tsc --noEmit');
  assert.equal(config.typecheck.timeoutMs, 120_000);
  assert.equal(config.mutation.command, 'npm exec stryker run');
  assert.deepEqual(config.mutation.checkers, ['typescript']);
  assert.equal(config.mutation.samples, 3);
  assert.equal(config.mutation.minKillRate, 0.8);
  assert.equal(config.mutation.budgetMs, 300_000);
});

test('the preset refuses settings that would make it another adapter or drop a required check', () => {
  const refused = [
    [{ runner: 'playwright' }, /runner is "vitest" for the vitest-stryker adapter/],
    [{ typecheck: null }, /type check is required for the vitest-stryker adapter/],
    [{ typecheck: false }, /type check is required for the vitest-stryker adapter/],
    [{ mutation: { testRunner: 'jest' } }, /mutation\.testRunner is "vitest" for the vitest-stryker adapter/],
    [{ mutation: { command: '' } }, /mutation\.command must be a non-empty string/],
    [{ holdout: { command: 'x', runner: 'playwright' } }, /holdout\.runner is "vitest" for the vitest-stryker adapter/],
    [{ journeys: { command: 'x', runner: 'vitest' } }, /journeys\.runner is "playwright" for the vitest-stryker adapter/],
    [{ weakerGate: { missing: ['mutation'], decision: 'x' } }, /the vitest-stryker adapter runs every check; weakerGate does not apply/],
  ];
  for (const [extra, message] of refused) assert.throws(() => load({ adapter: 'vitest-stryker', ...extra }), message, JSON.stringify(extra));
  assert.throws(() => load({ adapter: 'jest-stryker', testCommand: 'x' }), /adapter must be one of node, junit, vitest-stryker/);
});

test('the junit adapter is unchanged: testCommand stays required and the type check stays optional', () => {
  assert.throws(() => load({ adapter: 'junit', runner: 'vitest' }), /config\.testCommand \(string\) is required/);
  assert.equal(load({ adapter: 'junit', runner: 'vitest', testCommand: 'x' }).typecheck, null);
});

// ---- test quality for Vitest-style tests (reused from PR #16)

test('analyzeTestFile flags string and typed expect tautologies and counts typed expect calls', () => {
  const head = "import { add } from '../src/math';\n";
  const filler = 'expect(add(0, 0)).toBe(0); expect(add(1, 1)).toBe(2);';
  const opts = { srcDirs: ['src'], minAssertions: 3 };
  for (const tautology of ["expect('a').toBe('a');", 'expect("a").toEqual("a");', 'expect<number>(1).toBe(1);', 'expect(true).toBeTruthy();']) {
    assert.match(analyzeTestFile(`${head}it('a', () => { ${tautology} ${filler} });`, opts).issues.join(), /tautolog/i, tautology);
  }
  const real = analyzeTestFile(`${head}it('a', () => { expect<number>(add(1, 2)).toBe(3); ${filler} });`, opts);
  assert.equal(real.assertions, 3);
  assert.deepEqual(real.issues, []);
  assert.deepEqual(analyzeTestFile(`${head}it('a', () => { expect('abc').toMatch('b'); expect(1).toBeGreaterThan(0); ${filler} });`, opts).issues, []);
});

test('analyzeTestFile accepts a path alias as a source reference only when it is configured', () => {
  const body = "import { add } from '@/math';\nit('a', () => { expect(add(1, 2)).toBe(3); expect(add(0, 0)).toBe(0); expect(add(1, 1)).toBe(2); });";
  assert.match(analyzeTestFile(body, { srcDirs: ['src'], minAssertions: 3 }).issues.join(), /never references the source/);
  assert.deepEqual(analyzeTestFile(body, { srcDirs: ['src'], minAssertions: 3, srcAliases: ['@/'] }).issues, []);
  assert.throws(() => load({ adapter: 'vitest-stryker', testQuality: { srcAliases: ['@/', ''] } }), /testQuality\.srcAliases must be an array of non-empty strings/);
});

// ---- the gate end to end, with stand-ins for vitest and stryker

// `sh vitest.sh run`: writes a JUnit report with the test names from tests/names.txt and an lcov covering
// src/Widget.tsx, as Vitest does with the gate's flags.
const VITEST = `#!/bin/sh
junit=""; covdir=""
for a in "$@"; do case "$a" in
  --outputFile.junit=*) junit="\${a#--outputFile.junit=}" ;;
  --coverage.reportsDirectory=*) covdir="\${a#--coverage.reportsDirectory=}" ;;
esac; done
printf '%s\\n' '<testsuites><testsuite name="s" tests="2"><testcase name="a"/><testcase name="b"/></testsuite></testsuites>' > "$junit"
if [ -n "$covdir" ]; then mkdir -p "$covdir"; printf 'SF:src/Widget.tsx\\nDA:1,1\\nLF:1\\nLH:1\\nend_of_record\\n' > "$covdir/lcov.info"; fi
echo "      Tests  2 passed (2)"
`;
const GOOD_TEST = "import { w } from '../src/Widget';\nit('w', () => { expect(w).toBe(1); expect(w + 1).toBe(2); expect(String(w)).toBe('1'); });\n";

function project({ files = {}, config = {} } = {}) {
  const dir = tmp('verify-vs-');
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  write('vitest.sh', VITEST);
  write('scenario.json', '{}');
  write('src/Widget.tsx', 'export const w = 1;\n');
  write('tests/Widget.test.tsx', GOOD_TEST);
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  const cfg = {
    adapter: 'vitest-stryker', testCommand: 'sh vitest.sh run', minTests: 2, replicates: 1, typecheck: { command: 'node -e ""' },
    mutation: { command: `node ${JSON.stringify(STRYKER)} --scenario scenario.json run`, samples: 2 }, ...config,
  };
  write('verify.config.json', JSON.stringify(cfg));
  return dir;
}

const { NODE_TEST_CONTEXT, ...cleanEnv } = process.env;
function verify(dir, ...args) {
  return spawnSync('node', [VERIFY, ...args], { cwd: dir, encoding: 'utf8', env: { ...cleanEnv, TMPDIR: tmp('verify-vs-tmpdir-') } });
}
const text = (r) => `${r.stdout}${r.stderr}`;

test('vitest-stryker is a full gate: tests, type check, lcov coverage, test quality on .tsx tests and mutation, no weakerGate', () => {
  const dir = project();
  const r = verify(dir);
  assert.equal(r.status, 0, text(r));
  assert.match(r.stdout, /\[4\/7\] test quality\n {2}ok\n/);
  assert.match(r.stdout, /src\/Widget\.tsx {2}100% \(1\/1\)/);
  assert.match(r.stdout, /mutation: killed 1\/1/);
  assert.doesNotMatch(r.stdout, /not available|not checked|weaker gate/);
  const runs = fs.readFileSync(path.join(dir, 'scenario.json.runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(runs[0].args[runs[0].args.indexOf('--testRunner') + 1], 'vitest');
  assert.equal(runs[0].args[runs[0].args.indexOf('--checkers') + 1], '');
});

test('a placeholder .tsx test fails test quality for the vitest-stryker adapter', () => {
  const r = verify(project({ files: { 'tests/Widget.test.tsx': "it('placeholder', () => { expect('a').toBe('a'); });\n" } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /test quality: tests\/Widget\.test\.tsx contains a tautological assertion/);
  assert.match(r.stdout, /test quality: tests\/Widget\.test\.tsx never references the source \(src\)/);
  assert.match(r.stdout, /test quality: tests\/Widget\.test\.tsx only 1 assertion\(s\); at least 3 required/);
});

test('test quality sees .tsx tests in tests/ and a .tsx test hidden inside src/; srcAliases count as source references', () => {
  let r = verify(project({ files: { 'src/Widget.test.tsx': GOOD_TEST } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /test quality: src\/Widget\.test\.tsx is a test file inside the source dir/);
  const aliased = "import { w } from '@/Widget';\nit('w', () => { expect(w).toBe(1); expect(w + 1).toBe(2); expect(String(w)).toBe('1'); });\n";
  r = verify(project({ files: { 'tests/Widget.test.tsx': aliased } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /tests\/Widget\.test\.tsx never references the source/);
  r = verify(project({ files: { 'tests/Widget.test.tsx': aliased }, config: { testQuality: { srcAliases: ['@/'] } } }));
  assert.equal(r.status, 0, text(r));
});

test('a type error fails the vitest-stryker gate at the required type check', () => {
  const r = verify(project({ config: { typecheck: { command: 'echo "src/Widget.tsx(1,14): error TS2322: Type string is not assignable to type number." && exit 2' } } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /error TS2322/);
  assert.match(r.stdout, /type check failed: `echo .*` exited non-zero/);
});

// ---- protected tool configs

const ACTIVE = (protectedPaths) => ({ active: true, protectedPaths });
const write = (file) => ({ tool_name: 'Edit', tool_input: { file_path: file, new_string: 'x' } });

test('the vitest-stryker adapter protects the tool configs that could weaken the gate', () => {
  assert.deepEqual(ADAPTER_PROTECTED['vitest-stryker'], [
    'stryker.conf.*', 'stryker.config.*', 'vitest.config.*', 'vitest.workspace.*', 'vite.config.*', 'tsconfig*.json', 'playwright.config.*',
  ]);
  assert.deepEqual(adapterProtected('{"adapter": "vitest-stryker"}'), ADAPTER_PROTECTED['vitest-stryker']);
  for (const other of ['{"adapter": "junit"}', '{}', 'not json', null]) assert.deepEqual(adapterProtected(other), [], String(other));
  const hits = ['vitest.config.ts', 'vite.config.mts', 'tsconfig.json', 'tsconfig.app.json', 'stryker.conf.mjs', 'stryker.config.json',
    'vitest.workspace.ts', 'playwright.config.ts', 'packages/web/vite.config.ts', 'Vitest.Config.TS'];
  for (const f of hits) assert.ok(ADAPTER_PROTECTED['vitest-stryker'].some((e) => matchesProtected(f, e)), f);
  for (const f of ['src/vitest.ts', 'tsconfig.ts', 'vite.configs/x.ts', 'src/config.ts', 'tsconfig/README.md']) {
    assert.ok(!ADAPTER_PROTECTED['vitest-stryker'].some((e) => matchesProtected(f, e)), f);
  }
});

test('harness init protects the adapter\'s configs when verify.config.json names vitest-stryker', () => {
  const dir = tmp('vs-state-');
  fs.writeFileSync(path.join(dir, 'verify.config.json'), JSON.stringify({ adapter: 'vitest-stryker' }));
  const state = buildState({ verifyCommand: 'node verify.js', projectDir: dir });
  for (const p of ADAPTER_PROTECTED['vitest-stryker']) assert.ok(state.protectedPaths.includes(p), p);
  assert.ok(state.protectedPaths.includes('verify.config.json'));

  const plain = tmp('vs-state-plain-');
  fs.writeFileSync(path.join(plain, 'verify.config.json'), JSON.stringify({ testCommand: 'node --test' }));
  assert.ok(!buildState({ verifyCommand: 'v', projectDir: plain }).protectedPaths.includes('vitest.config.*'));
  assert.ok(!buildState({ verifyCommand: 'v' }).protectedPaths.includes('vitest.config.*'), 'no project dir: nothing to read');
});

test('during a run, edits and shell writes to a protected tool config are blocked; other files are not', () => {
  const ctx = { ...ACTIVE(ADAPTER_PROTECTED['vitest-stryker']), projectDir: '/p' };
  for (const f of ['/p/vitest.config.ts', 'vite.config.ts', '/p/tsconfig.node.json', './stryker.conf.mjs', '/p/apps/web/vitest.config.mts']) {
    assert.equal(checkWrite(write(f), ctx, '/p').block, true, f);
  }
  for (const f of ['/p/src/Slug.tsx', '/p/tests/Slug.test.tsx', '/p/src/vitest.ts']) assert.equal(checkWrite(write(f), ctx, '/p').block, false, f);
  assert.equal(checkWrite(write('/p/vitest.config.ts'), { active: false, protectedPaths: ctx.protectedPaths }, '/p').block, false, 'only while a run is active');
  for (const cmd of ['sed -i s/a/b/ vitest.config.ts', 'echo x > tsconfig.json', 'cp /tmp/x vite.config.ts', 'rm stryker.config.json', 'git checkout vitest.config.ts', 'node -e "require(\'fs\').writeFileSync(\'vitest.config.ts\', \'\')"']) {
    assert.equal(checkBash(cmd, ctx).block, true, cmd);
  }
  for (const cmd of ['npx vitest run', 'npx tsc --noEmit -p tsconfig.json', 'cat vitest.config.ts', 'echo x > src/a.ts']) assert.equal(checkBash(cmd, ctx).block, false, cmd);
});

test('changedProtected matches glob entries by file name at any depth; plain entries keep their exact and prefix rules', () => {
  const list = ['acceptance/', 'verify.config.json', 'vitest.config.*', 'tsconfig*.json'];
  assert.deepEqual(changedProtected(['vitest.config.ts', 'web/tsconfig.app.json', 'src/a.ts', 'acceptance/x.js', 'sub/verify.config.json'], list),
    ['vitest.config.ts', 'web/tsconfig.app.json', 'acceptance/x.js']);
});

test('check-protected adds the adapter\'s configs from the base branch\'s verify.config.json', () => {
  const repo = tmp('vs-git-');
  const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'verify.config.json'), JSON.stringify({ adapter: 'vitest-stryker' }));
  fs.writeFileSync(path.join(repo, 'vitest.config.ts'), 'export default {};\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(repo, 'vitest.config.ts'), 'export default { test: { include: [] } };\n');
  git('commit', '-q', '-am', 'weaken');
  const r = spawnSync('node', [CHECK_PROTECTED, '--base', 'main'], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /Protected files changed:\n {2}- vitest\.config\.ts/);

  git('checkout', '-q', 'main');
  fs.writeFileSync(path.join(repo, 'verify.config.json'), JSON.stringify({ adapter: 'junit' }));
  git('commit', '-q', '-am', 'junit');
  git('checkout', '-q', '-b', 'feature2');
  fs.writeFileSync(path.join(repo, 'vitest.config.ts'), 'export default { x: 1 };\n');
  git('commit', '-q', '-am', 'edit');
  const ok = spawnSync('node', [CHECK_PROTECTED, '--base', 'main'], { cwd: repo, encoding: 'utf8' });
  assert.equal(ok.status, 0, `${ok.stdout}${ok.stderr}`);
});

// ---- review fixes (PR #70)

test('configs named in the gate\'s commands are protected: --config, -c, --project, -p and --config=', () => {
  const config = JSON.stringify({
    adapter: 'vitest-stryker',
    testCommand: 'npx vitest run --config configs/vitest.unit.mts',
    typecheck: { command: 'npx tsc --noEmit -p tsconfig.build.json && npx tsc -p ./web/tsconfig.app.json' },
    holdout: { command: 'npx vitest run -c "configs/vitest.holdout.ts" --dir hidden' },
    journeys: { command: 'npx playwright test --config=e2e/pw.ts' },
    mutation: { command: 'npx stryker run --project=other.json' },
  });
  const list = adapterProtected(config);
  for (const p of ['configs/vitest.unit.mts', 'tsconfig.build.json', 'web/tsconfig.app.json', 'configs/vitest.holdout.ts', 'e2e/pw.ts', 'other.json']) {
    assert.ok(list.includes(p), p);
  }
  assert.ok(!list.includes('hidden'), '--dir is not a config');
  const odd = adapterProtected(JSON.stringify({ adapter: 'vitest-stryker', testCommand: 'npx vitest run -c $CFG --config /abs/v.ts -p' }));
  assert.ok(!odd.some((p) => p.startsWith('-') || p.includes('$') || path.isAbsolute(p)), odd.join());
  assert.equal(checkWrite(write('/p/configs/vitest.unit.mts'), { active: true, protectedPaths: list }, '/p').block, true);
});

test('the junit adapter protects the configs of the runners it uses, Stryker\'s when mutation runs, and tsconfig with a type check', () => {
  const vitest = adapterProtected(JSON.stringify({ adapter: 'junit', runner: 'vitest', testCommand: 'npx vitest run' }));
  for (const p of ['vitest.config.*', 'vitest.workspace.*', 'vite.config.*']) assert.ok(vitest.includes(p), p);
  for (const p of ['playwright.config.*', 'stryker.conf.*', 'tsconfig*.json']) assert.ok(!vitest.includes(p), p);
  const all = adapterProtected(JSON.stringify({
    adapter: 'junit', runner: 'vitest', testCommand: 'x', journeys: { command: 'npx playwright test', runner: 'playwright' },
    typecheck: { command: 'npx tsc --noEmit' }, mutation: { command: 'npx stryker run', testRunner: 'vitest' },
  }));
  for (const p of ADAPTER_PROTECTED['vitest-stryker']) assert.ok(all.includes(p), p);
  assert.deepEqual(adapterProtected(JSON.stringify({ adapter: 'junit', runner: 'playwright', testCommand: 'npx playwright test' })), ['playwright.config.*']);
  assert.deepEqual(adapterProtected(JSON.stringify({ adapter: 'junit', runner: 'standin-pytest', testCommand: 'x' })), []);
});

test('the required type check must run the compiler: a no-op command is refused', () => {
  for (const command of ['true', ' : ', 'exit 0', '  ']) {
    assert.throws(() => load({ adapter: 'vitest-stryker', typecheck: { command } }), /the required type check must run the compiler/, JSON.stringify(command));
  }
  assert.equal(load({ adapter: 'vitest-stryker', typecheck: { command: 'npx tsc --noEmit' } }).typecheck.command, 'npx tsc --noEmit');
  assert.equal(load({ adapter: 'junit', runner: 'vitest', testCommand: 'x', typecheck: { command: 'true' } }).typecheck.command, 'true', 'junit is unchanged');
});

test('testQuality.srcAliases entries must end with "/"', () => {
  assert.throws(() => load({ adapter: 'vitest-stryker', testQuality: { srcAliases: ['@'] } }), /testQuality\.srcAliases entries must end with "\/"/);
  assert.deepEqual(load({ adapter: 'vitest-stryker', testQuality: { srcAliases: ['@/', '~/'] } }).testQuality.srcAliases, ['@/', '~/']);
});
