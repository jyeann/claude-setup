'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VERIFY = path.join(__dirname, '..', 'bin', 'verify.js');

const MATH = `'use strict';
function add(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') throw new TypeError('numbers only');
  return a + b;
}
function isPositive(n) {
  return n > 0 && true;
}
module.exports = { add, isPositive };
`;

const GOOD_TEST = `const test = require('node:test');
const assert = require('node:assert/strict');
const { add, isPositive } = require('../src/math');
test('add', () => {
  assert.equal(add(1, 2), 3);
  assert.equal(add(-1, 1), 0);
  assert.throws(() => add('a', 1), TypeError);
  assert.throws(() => add(1, 'b'), TypeError);
});
test('isPositive', () => {
  assert.equal(isPositive(1), true);
  assert.equal(isPositive(0), false);
  assert.equal(isPositive(-1), false);
});
`;

const CONFIG = {
  testCommand: 'node --test "tests/*.test.js"',
  minTests: 2,
  srcDirs: ['src'],
  coverage: { minLines: 80, minFileLines: 50, exclude: [] },
  testQuality: { dirs: ['tests'], minAssertionsPerFile: 3 },
  mutation: { samples: 5, minKillRate: 0.75, copy: ['src', 'tests'], timeoutMs: 60000 },
};

function project(files, config = CONFIG) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-cli-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'src', 'math.js'), MATH);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'tests', name), text);
  fs.writeFileSync(path.join(dir, 'verify.config.json'), JSON.stringify(config));
  return dir;
}
const { NODE_TEST_CONTEXT, ...cleanEnv } = process.env;
const verify = (dir, ...args) => spawnSync('node', [VERIFY, ...args], { cwd: dir, encoding: 'utf8', env: cleanEnv });
const text = (r) => `${r.stdout}${r.stderr}`;

test('a project with real tests passes every gate', () => {
  const r = verify(project({ 'math.test.js': GOOD_TEST }));
  assert.equal(r.status, 0, text(r));
  assert.match(r.stdout, /VERIFY PASSED/);
  assert.match(r.stdout, /mutation/i);
});

test('a placeholder test cannot pad a project: it is named and rejected', () => {
  const smoke = "const test = require('node:test');\nconst assert = require('node:assert');\ntest('smoke', () => { assert.ok(true); });\n";
  const r = verify(project({ 'math.test.js': GOOD_TEST, 'smoke.test.js': smoke }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /VERIFY FAILED/);
  assert.match(r.stdout, /tests\/smoke\.test\.js/);
  assert.match(r.stdout, /tautolog/i);
});

test('skipped tests fail the run', () => {
  const r = verify(project({ 'math.test.js': `${GOOD_TEST}\ntest.skip('later', () => { assert.equal(add(1, 1), 2); });\n` }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /skipped|todo/i);
});

test('source coverage is measured on src, not on test files, and a floor is enforced', () => {
  const thin = `const test = require('node:test');
const assert = require('node:assert/strict');
const { add } = require('../src/math');
test('add', () => { assert.equal(add(1, 2), 3); assert.equal(add(2, 2), 4); assert.equal(add(0, 0), 0); });
`;
  const r = verify(project({ 'math.test.js': thin }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /coverage/i);
  assert.match(r.stdout, /src\/math\.js/);
  assert.match(r.stdout, /uncovered lines?:? ?[0-9, -]+/i);
});

test('mutation spot-check fails when tests run the code but do not pin its behaviour, and names the survivors', () => {
  const weak = `const test = require('node:test');
const assert = require('node:assert/strict');
const { add, isPositive } = require('../src/math');
test('add runs', () => {
  assert.equal(typeof add(1, 2), 'number');
  assert.ok(add(1, 2) !== undefined);
});
test('isPositive runs', () => {
  assert.equal(typeof isPositive(5), 'boolean');
});
`;
  const dir = project({ 'math.test.js': weak });
  const r = verify(dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /survived/i);
  assert.match(r.stdout, /src\/math\.js:\d+/);
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'math.js'), 'utf8'), MATH, 'real source must be untouched');

  const fast = verify(dir, '--fast');
  assert.equal(fast.status, 0, text(fast));
  assert.match(fast.stdout, /mutation: skipped/i);
});

test('a bad config is a usage error, not a pass', () => {
  const dir = project({ 'math.test.js': GOOD_TEST }, { minTests: 1 });
  const r = verify(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /testCommand/);
  assert.equal(verify(dir, '--config', 'missing.json').status, 2);
});

test('failing tests fail the run and show the output tail', () => {
  const r = verify(project({ 'math.test.js': `${GOOD_TEST}\ntest('boom', () => { assert.equal(add(1, 1), 3); });\n` }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /tests? failed/i);
});

test('mutation cannot pass vacuously: a copy that does not pass its own tests is reported', () => {
  const cfg = { ...CONFIG, testCommand: 'node --test "tests/*.test.js" && node fixtures/check.js' };
  const dir = project({ 'math.test.js': GOOD_TEST }, cfg);
  fs.mkdirSync(path.join(dir, 'fixtures'));
  fs.writeFileSync(path.join(dir, 'fixtures', 'check.js'), 'process.exit(0);\n');
  const r = verify(dir);
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /mutation: baseline/i);
  assert.match(r.stdout, /mutation\.copy/);
});

test('srcDirs and test dirs are copied automatically for the mutation run', () => {
  const dir = project({ 'math.test.js': GOOD_TEST.replace('../src/math', '../lib/math') }, {
    ...CONFIG, srcDirs: ['lib'], mutation: { ...CONFIG.mutation, copy: [] },
  });
  fs.renameSync(path.join(dir, 'src'), path.join(dir, 'lib'));
  const r = verify(dir);
  assert.equal(r.status, 0, text(r));
  assert.match(r.stdout, /mutation: killed 5\/5/);
});

test('invalid numeric settings are usage errors, not silent passes', () => {
  for (const mutation of [{ ...CONFIG.mutation, samples: 0 }, { ...CONFIG.mutation, minKillRate: 2 }]) {
    const r = verify(project({ 'math.test.js': GOOD_TEST }, { ...CONFIG, mutation }));
    assert.equal(r.status, 2, text(r));
    assert.match(r.stderr, /mutation\./);
  }
});

test('test files hiding inside src are rejected', () => {
  const dir = project({ 'math.test.js': GOOD_TEST });
  fs.writeFileSync(path.join(dir, 'src', 'hidden.test.js'), GOOD_TEST.replace('../src/math', './math'));
  const r = verify(dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /src\/hidden\.test\.js/);
});

test('deleting all source cannot shrink the coverage denominator to nothing', () => {
  const dir = project({ 'math.test.js': GOOD_TEST }, { ...CONFIG, coverage: { ...CONFIG.coverage, minSourceFiles: 2 } });
  const r = verify(dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /at least 2 source file/i);
});

const FLAKY_TEST = `const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { add } = require('../src/math');
const marker = path.join(__dirname, '..', '.flaky-marker');
test('flaky', () => {
  const seen = fs.existsSync(marker);
  fs.writeFileSync(marker, '1');
  assert.equal(seen, false);
  assert.equal(add(1, 2), 3);
  assert.equal(add(2, 2), 4);
});
`;

test('a test that passes once and then fails is reported as flaky, and --fast skips the replicate run', () => {
  const dir = project({ 'math.test.js': GOOD_TEST, 'flaky.test.js': FLAKY_TEST });
  const r = verify(dir);
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /flaky|non-?determinis/i);
  fs.rmSync(path.join(dir, '.flaky-marker'), { force: true });
  const fast = verify(dir, '--fast');
  assert.equal(fast.status, 0, text(fast));
  assert.match(fast.stdout, /replicate.*skipped/i);
});

test('replicates can be turned off with replicates: 1', () => {
  const dir = project({ 'math.test.js': GOOD_TEST, 'flaky.test.js': FLAKY_TEST }, { ...CONFIG, replicates: 1 });
  assert.equal(verify(dir).status, 0);
});

const HOLDOUT_FAIL = `const test = require('node:test');
const assert = require('node:assert/strict');
const { add } = require('../src/math');
test('hidden case SECRET_CASE_NAME', () => { assert.equal(add(2, 2), 'SECRET_EXPECTED_VALUE'); });
`;
const HOLDOUT_PASS = `const test = require('node:test');
const assert = require('node:assert/strict');
const { add } = require('../src/math');
test('hidden ok', () => { assert.equal(add(2, 2), 4); });
`;
const withHoldout = (file, cfg = {}) => {
  const dir = project({ 'math.test.js': GOOD_TEST }, { ...CONFIG, holdout: { command: 'node --test "holdout/*.test.js"', ...cfg } });
  fs.mkdirSync(path.join(dir, 'holdout'));
  if (file) fs.writeFileSync(path.join(dir, 'holdout', 'h.test.js'), file);
  return dir;
};

test('a failing holdout set fails the gate but reveals only counts, never names, paths or expected values', () => {
  const r = verify(withHoldout(HOLDOUT_FAIL));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /holdout: 1 of 1/i);
  assert.doesNotMatch(text(r), /SECRET_EXPECTED_VALUE|SECRET_CASE_NAME|h\.test\.js/);
});

test('a passing holdout set lets the gate pass', () => {
  const r = verify(withHoldout(HOLDOUT_PASS));
  assert.equal(r.status, 0, text(r));
  assert.match(r.stdout, /holdout: 1\/1 passing/i);
});

test('an empty or deleted holdout cannot pass vacuously', () => {
  const r = verify(withHoldout(null));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /holdout/i);
});

test('--fast skips the holdout', () => {
  const r = verify(withHoldout(HOLDOUT_FAIL), '--fast');
  assert.equal(r.status, 0, text(r));
  assert.match(r.stdout, /holdout: skipped/i);
});

test('holdout config needs a command', () => {
  const r = verify(project({ 'math.test.js': GOOD_TEST }, { ...CONFIG, holdout: {} }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /holdout\.command/);
});

test('when tests fail, the output ends with the failing assertions so a truncated tail still carries them', () => {
  const r = verify(project({ 'math.test.js': `${GOOD_TEST}\ntest('boom', () => { assert.equal(add(1, 1), 3); });\n` }));
  assert.equal(r.status, 1);
  const tail = r.stdout.trimEnd().split('\n').slice(-25).join('\n');
  assert.match(tail, /VERIFY FAILED/);
  assert.match(tail, /Failing tests/i);
  assert.match(tail, /boom/);
  assert.match(tail, /2 !== 3|expected: 3|actual: 2/);
  assert.doesNotMatch(tail, /duration_ms|# Subtest/);
});

// ---------- TypeScript projects (Node's native type stripping) ----------
const tsSupported = Boolean(process.features.typescript);

const MATH_TS = `export interface Limits { min: number; strict: true }
type Check<T>= T extends true ? false : never;
const history: Array<number>= [];
export type Sign = 'neg' | 'zero' | 'pos';
export function add(a: number, b: number): number {
  if (typeof a !== 'number' || typeof b !== 'number') throw new TypeError('numbers only');
  history.push(a + b);
  return a + b;
}
export function isPositive(n: number): boolean {
  return n > 0 && true;
}
export function isAdult(age: number): boolean { return age >= 18; }
`;

const TS_HEAD = `import test from 'node:test';
import assert from 'node:assert/strict';
import { add, isPositive, isAdult } from '../src/math.ts';
`;
const TS_GOOD = `${TS_HEAD}test('add', () => {
  assert.equal(add(1, 2), 3);
  assert.deepEqual<number[]>([add(-1, 1)], [0]);
  assert.throws(() => add('a' as unknown as number, 1), TypeError);
  assert.throws(() => add(1, 'b' as unknown as number), TypeError);
});
test('isPositive', () => {
  assert.equal(isPositive(1), true);
  assert.equal(isPositive(0), false);
  assert.equal(isPositive(-1), false);
});
test('isAdult', () => {
  assert.equal(isAdult(18), true);
  assert.equal(isAdult(17), false);
});
`;

const TS_CONFIG = {
  testCommand: 'node --test "tests/*.test.ts"',
  minTests: 3,
  srcDirs: ['src'],
  coverage: { minLines: 80, minFileLines: 50, exclude: [] },
  testQuality: { dirs: ['tests'], minAssertionsPerFile: 3 },
  mutation: { samples: 20, minKillRate: 0.75, copy: ['src', 'tests'], timeoutMs: 60000 },
};

function tsProject(files, config = TS_CONFIG, src = MATH_TS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-ts-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'src', 'math.ts'), src);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'tests', name), body);
  fs.writeFileSync(path.join(dir, 'verify.config.json'), JSON.stringify(config));
  return dir;
}
const tsTest = (name, fn) => test(name, { skip: !tsSupported && 'Node without native type stripping' }, fn);

tsTest('a TypeScript project with real tests passes every gate, and every mutant is in runtime code', () => {
  const r = verify(tsProject({ 'math.test.ts': TS_GOOD }));
  assert.equal(r.status, 0, text(r));
  assert.match(r.stdout, /VERIFY PASSED/);
  // 6 runtime sites (!== x2, ||, &&, true, >=); the 5 in `strict: true`, `Check<T>=`, `T extends true ? false`, `Array<number>=` are types
  assert.match(r.stdout, /mutation: killed 6\/6/);
  assert.doesNotMatch(r.stdout, /ExperimentalWarning/);
});

tsTest('type-only lines are not counted as executable, and uncovered lines match the original .ts text', () => {
  const noPositive = TS_GOOD.replace(/test\('isPositive'[\s\S]*?\n\}\);\n/, '');
  assert.ok(!noPositive.includes('isPositive('), 'fixture drops the isPositive test');
  const r = verify(tsProject({ 'math.test.ts': noPositive }, { ...TS_CONFIG, minTests: 2 }), '--fast');
  assert.equal(r.status, 0, text(r));
  // math.ts has 13 lines, 3 of them type-only: 10 executable. The body of isPositive is on lines 11-12 of the original text.
  assert.match(r.stdout, /src\/math\.ts {2}80% \(8\/10\) uncovered lines: 11-12\n/);
});

tsTest('a placeholder TypeScript test cannot pad the project', () => {
  const smoke = "import test from 'node:test';\nimport assert from 'node:assert';\ntest('smoke', () => { assert.ok(true as boolean); });\n";
  const r = verify(tsProject({ 'math.test.ts': TS_GOOD, 'smoke.test.ts': smoke }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /tests\/smoke\.test\.ts/);
  assert.match(r.stdout, /tautolog/i);
});

tsTest('a surviving mutant in TypeScript runtime code is reported with its line, and no mutant is ever in a type', () => {
  const weak = `${TS_HEAD}test('runs', () => {
  assert.equal(typeof add(1, 2), 'number');
  assert.equal(typeof isPositive(5), 'boolean');
  assert.equal(typeof isAdult(30), 'boolean');
});
`;
  const dir = tsProject({ 'math.test.ts': weak }, { ...TS_CONFIG, minTests: 1, mutation: { ...TS_CONFIG.mutation, minKillRate: 0.9 } });
  const r = verify(dir);
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /mutation: killed \d\/6/);
  const lines = [...r.stdout.matchAll(/survived: src\/math\.ts:(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(lines.length > 0, 'something survived');
  for (const line of lines) assert.ok([6, 11, 13].includes(line), `mutant on line ${line}, which has no runtime operator`);
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'math.ts'), 'utf8'), MATH_TS, 'real source must be untouched');
});

tsTest('.d.ts files and .tsx files in src are not measured as source', () => {
  const dir = tsProject({ 'math.test.ts': TS_GOOD });
  fs.writeFileSync(path.join(dir, 'src', 'types.d.ts'), 'export interface Todo { id: number }\n');
  fs.writeFileSync(path.join(dir, 'src', 'view.tsx'), 'export const v = <div />;\n');
  const r = verify(dir, '--fast');
  assert.equal(r.status, 0, text(r));
  assert.doesNotMatch(r.stdout, /types\.d\.ts|view\.tsx/);
});

const withTypecheck = (command, extra = {}) => tsProject({ 'math.test.ts': TS_GOOD }, { ...TS_CONFIG, typecheck: { command, ...extra } });

tsTest('a configured type check runs after the tests and passes the gate when it exits 0', () => {
  const r = verify(withTypecheck('node -e "console.log(\'tsc stand-in ok\')"'));
  assert.equal(r.status, 0, text(r));
  assert.match(r.stdout, /\[2\/7\] type check\n {2}ok/);
});

tsTest('a failing type check fails the gate, shows the compiler output tail, and holds back holdout and mutation', () => {
  const r = verify(withTypecheck('node -e "console.error(\'src/math.ts(3,7): error TS2322: bad\'); process.exit(2)"'));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /error TS2322: bad/);
  assert.match(r.stdout, /type check failed/);
  assert.match(r.stdout, /mutation: skipped until the checks above pass/);
});

tsTest('--fast still runs the type check', () => {
  const r = verify(withTypecheck('node -e "process.exit(3)"'), '--fast');
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /type check failed/);
});

tsTest('a type check that hangs is stopped and reported as a timeout', () => {
  const r = verify(withTypecheck('node -e "setTimeout(() => {}, 60000)"', { timeoutMs: 500 }), '--fast');
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /type check timed out after 500 ms/);
});

test('without a typecheck setting the step is reported as not configured and the steps are numbered /7', () => {
  const r = verify(project({ 'math.test.js': GOOD_TEST }), '--fast');
  assert.equal(r.status, 0, text(r));
  for (const label of ['[1/7] tests', '[2/7] type check', '[3/7] source coverage', '[4/7] test quality', '[5/7] hidden holdout set', '[6/7] user journeys in a browser', '[7/7] mutation spot-check']) assert.ok(r.stdout.includes(label), label);
  assert.match(r.stdout, /typecheck: not configured/);
});

test('typecheck config needs a command and a positive timeout', () => {
  for (const [typecheck, pattern] of [[{}, /typecheck\.command/], [{ command: 'x', timeoutMs: 0 }, /typecheck\.timeoutMs/]]) {
    const r = verify(project({ 'math.test.js': GOOD_TEST }, { ...CONFIG, typecheck }));
    assert.equal(r.status, 2, text(r));
    assert.match(r.stderr, pattern);
  }
});

// ---------- Vitest / Jest contract (stand-in runner) ----------
// The suite must not depend on installing Vitest or Jest, so this stand-in speaks their contract: describe/it/expect
// globals, a Vitest-style summary line, and an Istanbul report written to $VERIFY_COVERAGE_DIR when --coverage is given.
// (Real Vitest 5.1.1 and Jest 30.5.2 were run through the gate by hand; see the README.)
const FAKE_RUNNER = `const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const args = process.argv.slice(2);
if (args.includes('--fail-always')) { console.log('boom'); process.exit(1); }
const dir = process.env.VERIFY_COVERAGE_DIR;
if (args.includes('--coverage') && !dir) { console.error('VERIFY_COVERAGE_DIR is not set'); process.exit(3); }
let pass = 0; let fail = 0; let skipped = 0;
global.describe = (name, fn) => fn();
global.it = (name, fn) => { try { fn(); pass += 1; } catch (err) { fail += 1; console.log(' FAIL  ' + name + '\\n' + err.message + '\\n'); } };
global.it.skip = () => { skipped += 1; };
global.expect = (v) => ({ toBe: (x) => assert.strictEqual(v, x), toThrow: (E) => assert.throws(v, E) });
for (const f of fs.readdirSync('tests').filter((n) => /\\.test\\.js$/.test(n))) require(path.resolve('tests', f));
const parts = [fail && fail + ' failed', pass && pass + ' passed', skipped && skipped + ' skipped'].filter(Boolean);
console.log('      Tests  ' + parts.join(' | ') + ' (' + (pass + fail + skipped) + ')');
if (args.includes('--coverage') && !args.includes('--no-report')) fs.copyFileSync('fake-coverage.json', path.join(dir, 'coverage-final.json'));
process.exit(fail ? 1 : 0);
`;
const RUNNER_TEST = `const { add, isPositive } = require('../src/math');
describe('math', () => {
  it('add', () => {
    expect(add(1, 2)).toBe(3);
    expect(add(-1, 1)).toBe(0);
    expect(() => add('a', 1)).toThrow(TypeError);
    expect(() => add(1, 'b')).toThrow(TypeError);
  });
  it('isPositive', () => {
    expect(isPositive(1)).toBe(true);
    expect(isPositive(0)).toBe(false);
    expect(isPositive(-1)).toBe(false);
  });
});
`;
// MATH statements start on lines 3, 4 and 7; counts say which ran.
const istanbulFor = (dir, counts = [1, 1, 1]) => ({
  [path.join(dir, 'src', 'math.js')]: {
    path: path.join(dir, 'src', 'math.js'),
    statementMap: { 0: { start: { line: 3 } }, 1: { start: { line: 4 } }, 2: { start: { line: 7 } } },
    s: { 0: counts[0], 1: counts[1], 2: counts[2] },
  },
});
const RUNNER_CONFIG = {
  ...CONFIG,
  runner: 'vitest',
  testCommand: 'node fake-runner.js --coverage',
  minTests: 2,
  mutation: { ...CONFIG.mutation, copy: ['src', 'tests', 'fake-runner.js', 'fake-coverage.json'] },
};
function runnerProject({ test = RUNNER_TEST, config = RUNNER_CONFIG, counts } = {}) {
  const dir = project({ 'math.test.js': test }, config);
  fs.writeFileSync(path.join(dir, 'fake-runner.js'), FAKE_RUNNER);
  fs.writeFileSync(path.join(dir, 'fake-coverage.json'), JSON.stringify(istanbulFor(dir, counts)));
  return dir;
}

test('a Vitest-style project passes: summary parsed, coverage read from the runner report, mutants killed', () => {
  const r = verify(runnerProject());
  assert.equal(r.status, 0, text(r));
  assert.match(r.stdout, /2\/2 passing/);
  assert.match(r.stdout, /replicates: 2 runs agree/);
  assert.match(r.stdout, /src\/math\.js {2}100% \(3\/3\)/);
  assert.match(r.stdout, /mutation: killed 5\/5/);
});

test('coverage from a runner report names uncovered lines and enforces the per-file floor', () => {
  const r = verify(runnerProject({ counts: [1, 0, 0], config: { ...RUNNER_CONFIG, coverage: { ...RUNNER_CONFIG.coverage, minFileLines: 50 } } }), '--fast');
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /src\/math\.js {2}33\.33% \(1\/3\) uncovered lines: 4, 7/);
  assert.match(r.stdout, /below the 50% per-file floor/);
});

test('a runner that writes no report fails coverage with the flags to add, not a silent pass', () => {
  const r = verify(runnerProject({ config: { ...RUNNER_CONFIG, testCommand: 'node fake-runner.js' } }), '--fast');
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /wrote no coverage-final\.json to \$VERIFY_COVERAGE_DIR/);
  assert.match(r.stdout, /--coverage\.reporter=json/);
});

test('failing runner tests show the failing names, and a missing report then explains why', () => {
  const r = verify(runnerProject({ test: `${RUNNER_TEST}\nit('wrong sum', () => { expect(add(1, 1)).toBe(3); });\n`, config: { ...RUNNER_CONFIG, testCommand: 'node fake-runner.js --coverage --no-report' } }), '--fast');
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /tests failed \(1 failing\)/);
  assert.match(r.stdout, /Failing tests/);
  assert.match(r.stdout, /wrong sum/);
  assert.match(r.stdout, /the tests failed, and Vitest writes no report then/);
});

test('a skipped runner test fails the run through the runner summary', () => {
  const r = verify(runnerProject({ test: `${RUNNER_TEST}\nit.skip('later', () => { expect(1).toBe(2); });\n` }), '--fast');
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /1 skipped/);
});

test('a placeholder Vitest-style test is rejected', () => {
  const dir = runnerProject();
  fs.writeFileSync(path.join(dir, 'tests', 'smoke.test.js'), "it('smoke', () => { expect(true).toBe(true); });\n");
  const r = verify(dir, '--fast');
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /tests\/smoke\.test\.js/);
  assert.match(r.stdout, /tautolog/i);
});

test('a surviving mutant is reported under a Vitest-style runner', () => {
  const weak = `const { add, isPositive } = require('../src/math');
describe('weak', () => {
  it('runs', () => {
    expect(typeof add(1, 2)).toBe('number');
    expect(typeof isPositive(5)).toBe('boolean');
    expect(add(1, 2) === undefined).toBe(false);
  });
});
`;
  const r = verify(runnerProject({ test: weak, config: { ...RUNNER_CONFIG, minTests: 1 } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /survived: src\/math\.js:\d+/);
});

test('mutation.testCommand replaces the test command for mutants, so slow coverage flags can be left out', () => {
  const r = verify(runnerProject({ config: { ...RUNNER_CONFIG, mutation: { ...RUNNER_CONFIG.mutation, testCommand: 'node fake-runner.js --fail-always' } } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /mutation: baseline/);
  const ok = verify(runnerProject({ config: { ...RUNNER_CONFIG, mutation: { ...RUNNER_CONFIG.mutation, testCommand: 'node fake-runner.js' } } }));
  assert.equal(ok.status, 0, text(ok));
  assert.match(ok.stdout, /mutation: killed 5\/5/);
});

test('mutation.exclude keeps a listed source file out of the mutant pool', () => {
  const build = (exclude) => {
    const dir = runnerProject({ config: { ...RUNNER_CONFIG, coverage: { minLines: 0, minFileLines: 0, exclude: [] }, mutation: { ...RUNNER_CONFIG.mutation, exclude } } });
    fs.writeFileSync(path.join(dir, 'src', 'extra.js'), 'module.exports = { same: (a, b) => a === b };\n');
    return dir;
  };
  const without = verify(build([]));
  assert.match(without.stdout, /survived: src\/extra\.js:1/, 'unlisted, the untested operator is sampled and survives');
  const listed = verify(build(['src/extra.js']));
  assert.equal(listed.status, 0, text(listed));
  assert.match(listed.stdout, /mutation: killed 5\/5/);
  assert.doesNotMatch(listed.stdout, /extra\.js:\d+/);
});

test('a Vitest or Jest command with the default runner points at the runner setting when coverage reads 0%', () => {
  const dir = runnerProject({ config: { ...RUNNER_CONFIG, runner: undefined, testCommand: 'node fake-vitest-runner.js --coverage' } });
  fs.renameSync(path.join(dir, 'fake-runner.js'), path.join(dir, 'fake-vitest-runner.js'));
  const r = verify(dir, '--fast');
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /set "runner" in verify\.config\.json/);
});

test('an unknown runner and bad runner options are usage errors', () => {
  for (const [patch, pattern] of [
    [{ runner: 'mocha' }, /runner must be one of/],
    [{ testQuality: { ...CONFIG.testQuality, srcAliases: [1] } }, /srcAliases/],
    [{ mutation: { ...CONFIG.mutation, exclude: 'src' } }, /mutation\.exclude/],
    [{ mutation: { ...CONFIG.mutation, testCommand: '' } }, /mutation\.testCommand/],
  ]) {
    const r = verify(project({ 'math.test.js': GOOD_TEST }, { ...CONFIG, ...patch }));
    assert.equal(r.status, 2, text(r));
    assert.match(r.stderr, pattern);
  }
});

test('a TypeScript file that is not erasable fails the mutation step by name, and mutation.exclude is the explicit way out', () => {
  const build = (exclude) => {
    const dir = runnerProject({ config: { ...RUNNER_CONFIG, coverage: { minLines: 0, minFileLines: 0, exclude: [] }, mutation: { ...RUNNER_CONFIG.mutation, exclude } } });
    fs.writeFileSync(path.join(dir, 'src', 'color.ts'), "export enum Color { Red = 'red' }\nexport const warm = (c: Color) => c === Color.Red;\n");
    return dir;
  };
  const r = verify(build([]));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /mutation: cannot type-strip src\/color\.ts/);
  assert.match(r.stdout, /mutation\.exclude/);
  const listed = verify(build(['src/color.ts']));
  assert.equal(listed.status, 0, text(listed));
});
