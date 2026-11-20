'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { lineCoverage, collectCoverage } = require('../lib/v8-coverage');
const { listMutations, applyMutation, selectMutations, maskNonCode } = require('../lib/mutate');
const { analyzeTestFile } = require('../lib/test-quality');
const { parseTestSummary, extractFailures } = require('../lib/summary');
const { mutationTimeoutMs } = require('../lib/strong-verify');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'verify-libs-'));

// ---------- v8 coverage ----------
const SRC = ['// header comment', 'function a() {', '  return 1;', '}', '', 'function b() {', '  return 2;', '}'].join('\n');
const offsetOf = (needle) => SRC.indexOf(needle);
const bBody = { startOffset: offsetOf('function b'), endOffset: SRC.length, count: 0 };
const wholeFile = { startOffset: 0, endOffset: SRC.length, count: 1 };

test('lineCoverage ignores blank and comment lines and marks uncovered blocks', () => {
  const r = lineCoverage(SRC, [[{ ranges: [wholeFile, bBody] }]]);
  assert.equal(r.executable, 6);
  assert.equal(r.covered, 3);
  assert.deepEqual(r.uncoveredLines, [6, 7, 8]);
  assert.equal(r.pct, 50);
});

test('lineCoverage unions coverage across processes', () => {
  const procA = [{ ranges: [wholeFile, bBody] }];
  const procB = [{ ranges: [{ ...wholeFile }] }];
  assert.equal(lineCoverage(SRC, [procA, procB]).pct, 100);
});

test('lineCoverage reports 0% for a file no process loaded', () => {
  const r = lineCoverage(SRC, []);
  assert.equal(r.pct, 0);
  assert.equal(r.executable, 6);
});

test('collectCoverage groups function ranges by project-relative path and ignores node_modules and outside files', () => {
  const root = tmp();
  const cov = tmp();
  const url = (p) => pathToFileURL(path.join(root, p)).href;
  const payload = {
    result: [
      { url: url('src/a.js'), functions: [{ ranges: [wholeFile] }] },
      { url: url('node_modules/x/i.js'), functions: [] },
      { url: 'file:///elsewhere/src/z.js', functions: [] },
      { url: 'node:internal/foo', functions: [] },
    ],
  };
  fs.writeFileSync(path.join(cov, 'coverage-1.json'), JSON.stringify(payload));
  fs.writeFileSync(path.join(cov, 'coverage-2.json'), JSON.stringify(payload));
  fs.writeFileSync(path.join(cov, 'not-json.txt'), 'ignored');
  const map = collectCoverage(cov, root);
  assert.deepEqual([...map.keys()], ['src/a.js']);
  assert.equal(map.get('src/a.js').length, 2);
});

// ---------- mutation ----------
test('listMutations finds operators in code but not in strings or comments', () => {
  const src = [
    "const msg = 'a === b && true';",
    '// x === y || false',
    '/* a !== b */',
    'if (a === b && c) return true;',
  ].join('\n');
  const kinds = listMutations(src).map((m) => `${m.from}->${m.to}`);
  assert.deepEqual(kinds.sort(), ['&&->||', '===->!==', 'true->false'].sort());
});

test('applyMutation changes exactly one occurrence and keeps the rest', () => {
  const src = 'if (a === b) { return a === c; }';
  const muts = listMutations(src);
  assert.equal(muts.length, 2);
  const mutated = applyMutation(src, muts[0]);
  assert.equal(mutated, 'if (a !== b) { return a === c; }');
});

test('mutants that would not compile are dropped', () => {
  const src = 'const x = a >= 1 ? 1 : 2;\nconst fn = (v) => v > 0;\n';
  for (const m of listMutations(src)) assert.doesNotThrow(() => new (require('node:vm').Script)(applyMutation(src, m)));
});

test('selectMutations is deterministic for a seed, bounded, and spreads across files', () => {
  const pool = [
    ...Array.from({ length: 10 }, (_, i) => ({ file: 'a.js', index: i })),
    ...Array.from({ length: 10 }, (_, i) => ({ file: 'b.js', index: i })),
  ];
  const one = selectMutations(pool, 6, 'seed');
  assert.deepEqual(selectMutations(pool, 6, 'seed'), one);
  assert.equal(one.length, 6);
  assert.equal(new Set(one.map((m) => m.file)).size, 2);
  assert.equal(selectMutations(pool.slice(0, 3), 6, 's').length, 3);
  assert.notDeepEqual(selectMutations(pool, 6, 'other-seed'), one);
});

// ---------- test quality ----------
const GOOD = "const { add } = require('../src/math');\ntest('a', () => { assert.equal(add(1,2),3); assert.equal(add(0,0),0); assert.throws(() => add()); });";

test('analyzeTestFile accepts a test that exercises src with real assertions', () => {
  assert.deepEqual(analyzeTestFile(GOOD, { srcDirs: ['src'], minAssertions: 3 }).issues, []);
});

test('analyzeTestFile flags tautologies, skips, missing src reference and thin assertions', () => {
  const opts = { srcDirs: ['src'], minAssertions: 3 };
  const placeholder = "const test = require('node:test');\ntest('smoke', () => { assert.ok(true); });";
  const issues = analyzeTestFile(placeholder, opts).issues.join(' | ');
  assert.match(issues, /tautolog/i);
  assert.match(issues, /src/i);
  assert.match(issues, /assertion/i);
  assert.match(analyzeTestFile(`${GOOD}\ntest.skip('x', () => {});`, opts).issues.join(), /skip/i);
  assert.match(analyzeTestFile(`${GOOD}\nexpect(true).toBe(true);`, opts).issues.join(), /tautolog/i);
  assert.match(analyzeTestFile(`${GOOD}\nassert.equal(1, 1);`, opts).issues.join(), /tautolog/i);
});

// ---------- summary ----------
test('parseTestSummary reads tap and spec reporter totals', () => {
  const tap = '# tests 14\n# suites 0\n# pass 12\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 1\n';
  assert.deepEqual(parseTestSummary(tap), { tests: 14, pass: 12, fail: 0, skipped: 1, todo: 1 });
  assert.equal(parseTestSummary('ℹ tests 3\nℹ pass 3\nℹ fail 0\nℹ skipped 0\nℹ todo 0').tests, 3);
  assert.deepEqual(parseTestSummary('no summary here'), { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0 });
});

// ---------- mutation timeout ----------
test('mutationTimeoutMs scales with the baseline, with a floor and a cap', () => {
  const cfg = { timeoutMs: 120000, timeoutFactor: 3, minTimeoutMs: 10000 };
  assert.equal(mutationTimeoutMs(1000, cfg), 10000);
  assert.equal(mutationTimeoutMs(20000, cfg), 60000);
  assert.equal(mutationTimeoutMs(90000, cfg), 120000);
});

// ---------- review round: masking, shebang, summary, BOM, comments ----------
test('a regex literal containing a quote does not invert string/code masking', () => {
  const src = 'const r = /["\']/;\nconst s = a === b ? "x" : "y";\nconst t = "p === q";';
  const lines = listMutations(src).filter((m) => m.from === '===').map((m) => m.line);
  assert.deepEqual(lines, [2]);
});

test('division is not mistaken for a regex, and template text is masked while ${} code is not', () => {
  assert.equal(listMutations('const h = a / 2 === b / 2;').length, 1);
  const src = 'const m = `a === b ${x === y ? "p" : "q"} c === d`;';
  const muts = listMutations(src).filter((m) => m.from === '===');
  assert.equal(muts.length, 1);
  assert.equal(src.slice(muts[0].index - 2, muts[0].index), 'x ');
  assert.equal(maskNonCode(src).length, src.length);
});

test('a shebang does not hide every mutant of a CommonJS file', () => {
  assert.equal(listMutations('#!/usr/bin/env node\nif (a === b) x();').length, 1);
});

test('parseTestSummary adds up several summaries (npm test && node --test acceptance)', () => {
  const two = '# tests 3\n# pass 3\n# fail 0\n# skipped 1\n# todo 0\n# tests 4\n# pass 4\n# fail 0\n# skipped 0\n# todo 0\n';
  assert.deepEqual(parseTestSummary(two), { tests: 7, pass: 7, fail: 0, skipped: 1, todo: 0 });
});

test('lineCoverage ignores a leading BOM and tolerates unsorted ranges', () => {
  const r = lineCoverage(`\uFEFF${SRC}`, [[{ ranges: [bBody, wholeFile] }]]);
  assert.equal(r.pct, 50);
});

test('analyzeTestFile does not count comments as src references or assertions', () => {
  const faked = "// uses src/foo\n/* assert.equal(a, b); assert.equal(c, d); assert.equal(e, f); */\ntest('x', () => { assert.ok(1 + 1 === 2); });";
  const issues = analyzeTestFile(faked, { srcDirs: ['src'], minAssertions: 3 }).issues.join(' | ');
  assert.match(issues, /never references the source/);
  assert.match(issues, /1 assertion/);
});

// ---------- failing-test extraction ----------
const TAP = [
  'TAP version 13', '# Subtest: adds', 'ok 1 - adds', '  ---', '  duration_ms: 0.4', "  type: 'test'", '  ...',
  '# Subtest: held-out: negative zero never escapes', 'not ok 2 - held-out: negative zero never escapes', '  ---', '  duration_ms: 1.2', "  type: 'test'",
  "  location: '/tmp/x.test.js:9:1'", "  failureType: 'testCodeFailure'", '  error: |-', '    Expected values to be strictly deep-equal:', '    -0 !== 0',
  "  code: 'ERR_ASSERTION'", "  name: 'AssertionError'", '  expected: 0', '  actual: -0', '  stack: |-', '    at TestContext.<anonymous> (/tmp/x.test.js:10:3)', '    at node:internal/foo', '  ...',
  'not ok 3 - parser survives nesting', '  ---', '  duration_ms: 9', '  error: RangeError', "  error: 'Maximum call stack size exceeded'", '  stack: |-', '    at deep', '  ...',
  '1..3', '# tests 3', '# pass 1', '# fail 2',
].join('\n');

test('extractFailures keeps each failing test name with its assertion details and drops noise and stacks', () => {
  const out = extractFailures(TAP);
  assert.match(out, /held-out: negative zero never escapes/);
  assert.match(out, /-0 !== 0/);
  assert.match(out, /expected: 0/);
  assert.match(out, /actual: -0/);
  assert.match(out, /parser survives nesting/);
  assert.match(out, /Maximum call stack size exceeded/);
  assert.doesNotMatch(out, /duration_ms|location:|at TestContext|node:internal|# Subtest|adds/);
});

test('extractFailures is bounded, reports how many were omitted, and returns empty when nothing failed', () => {
  assert.equal(extractFailures('ok 1 - fine\n# tests 1\n# pass 1\n'), '');
  const many = Array.from({ length: 30 }, (_, i) => `not ok ${i + 1} - t${i}\n  ---\n  error: 'boom ${i}'\n  ...`).join('\n');
  const out = extractFailures(many, { maxFailures: 5, maxChars: 4000 });
  assert.match(out, /t0/);
  assert.doesNotMatch(out, /t6/);
  assert.match(out, /25 more failing test/);
  assert.ok(extractFailures(many, { maxFailures: 30, maxChars: 300 }).length <= 400);
});

// ---------- TypeScript ----------
const { stripTypes, canStripTypes, DECLARATION_FILE } = require('../lib/typescript');

const TS_SRC = [
  'export interface Limits { min: number; strict: true }',
  'type Check<T>= T extends true ? false : never;',
  'const history: Array<number>= [];',
  'export type Sign = "neg" | "pos";',
  'let flag: false = false as false;',
  'export function isAdult(age: number, l: Limits = { min: 18, strict: true }): boolean {',
  '  return age >= l.min && l.strict === true;',
  '}',
].join('\n');

test('type stripping blanks types but keeps every offset and line', { skip: !canStripTypes() }, () => {
  const erased = stripTypes(TS_SRC);
  assert.equal(erased.length, TS_SRC.length);
  assert.equal(erased.split('\n').length, TS_SRC.split('\n').length);
  assert.equal(erased.indexOf('isAdult'), TS_SRC.indexOf('isAdult'));
  assert.throws(() => stripTypes('const = ;'));
});

test('listMutations on TypeScript only mutates runtime code, never type positions', { skip: !canStripTypes() }, () => {
  const sites = listMutations(TS_SRC, { typescript: true }).map((m) => `${m.line}:${m.from}`);
  // line 1 `strict: true`, line 2 `>=`/`true`/`false`, line 3 `Array<number>=`, line 5 `: false` are types
  assert.deepEqual(sites, ['5:false', '6:true', '7:>=', '7:&&', '7:===', '7:true']);
});

test('listMutations without the TypeScript option would hit type positions (why the option exists)', () => {
  const lines = new Set(listMutations(TS_SRC).map((m) => m.line));
  assert.ok(lines.has(1) && lines.has(2) && lines.has(3), 'plain-JS mode mutates types');
});

test('every TypeScript mutant still parses as TypeScript, and applying it changes exactly one site', { skip: !canStripTypes() }, () => {
  const muts = listMutations(TS_SRC, { typescript: true });
  assert.ok(muts.length > 0);
  for (const m of muts) {
    const mutated = applyMutation(TS_SRC, m);
    assert.doesNotThrow(() => stripTypes(mutated));
    assert.equal(TS_SRC.slice(m.index, m.index + m.from.length), m.from);
  }
});

test('listMutations on TypeScript fails loudly when the file is not erasable TypeScript', { skip: !canStripTypes() }, () => {
  assert.throws(() => listMutations('enum Color { Red }\nconst a = 1 === 1;', { typescript: true }));
});

test('mutants in TypeScript generics and unions stay out: `|` and `&` types, `a<b>=c` shapes', { skip: !canStripTypes() }, () => {
  const src = 'type U = A | B & C;\nconst m = new Map<string, number>();\nfunction g<T>(x: T): T { return x; }\nexport const ok = g<boolean>(true);\n';
  assert.deepEqual(listMutations(src, { typescript: true }).map((m) => `${m.line}:${m.from}`), ['4:true']);
});

test('lineCoverage with the type-erased text does not count type-only lines as executable', { skip: !canStripTypes() }, () => {
  const src = ['import type { X } from "./x.ts";', 'export interface Opt {', '  a: number;', '}', 'export type Id = string;', 'export function f(o: Opt): number {', '  return o.a;', '}'].join('\n');
  const whole = [[{ ranges: [{ startOffset: 0, endOffset: src.length, count: 1 }] }]];
  assert.equal(lineCoverage(src, whole).executable, 8, 'without erasure every line looks executable');
  const r = lineCoverage(src, whole, { erasedSource: stripTypes(src) });
  assert.equal(r.executable, 3);
  assert.equal(r.pct, 100);
  const fnStart = src.indexOf('export function');
  const uncovered = [[{ ranges: [{ startOffset: 0, endOffset: src.length, count: 1 }, { startOffset: fnStart, endOffset: src.length, count: 0 }] }]];
  assert.deepEqual(lineCoverage(src, uncovered, { erasedSource: stripTypes(src) }).uncoveredLines, [6, 7, 8]);
});

test('declaration files are recognised so they never count as source', () => {
  for (const f of ['types.d.ts', 'x.d.mts', 'y.d.cts']) assert.ok(DECLARATION_FILE.test(f), f);
  assert.ok(!DECLARATION_FILE.test('data.ts'));
});

const TS_TEST = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport type { Todo } from '../src/types.ts';\nimport { add } from '../src/math.ts';\n";

test('analyzeTestFile counts assertions that carry type arguments or casts', () => {
  const body = `${TS_TEST}test('a', () => { assert.deepStrictEqual<number[]>([add(1, 2)], [3]); assert.equal<number>(add(0, 0), 0); assert.equal(add(1, 1) as number, 2); });`;
  const r = analyzeTestFile(body, { srcDirs: ['src'], minAssertions: 3 });
  assert.equal(r.assertions, 3);
  assert.deepEqual(r.issues, []);
});

test('analyzeTestFile still flags tautologies written with type arguments or casts', () => {
  const opts = { srcDirs: ['src'], minAssertions: 3 };
  const filler = "assert.equal(add(0, 0), 0); assert.equal(add(1, 1), 2);";
  for (const tautology of ['assert.equal<number>(1, 1);', 'assert.ok(true as boolean);', "assert.equal('a' as string, 'a');"]) {
    const body = `${TS_TEST}test('a', () => { ${tautology} ${filler} });`;
    assert.match(analyzeTestFile(body, opts).issues.join(), /tautolog/i, tautology);
  }
});

// ---------- Vitest and Jest ----------
const { collectIstanbul, istanbulLineCoverage } = require('../lib/istanbul-coverage');

// Captured from real runs (vitest 5.1.1, jest 30.5.2), non-TTY.
const VITEST_OUT = [
  ' RUN  v5.1.1 /work', '', ' ❯ tests/math.test.ts (4 tests | 1 failed | 1 skipped) 6ms', '   ❯ math (4)', '     × fails on purpose 4ms', '',
  '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯', '', ' FAIL  tests/math.test.ts > math > fails on purpose', 'AssertionError: expected 2 to be 3 // Object.is equality', '',
  '- Expected', '+ Received', '', '- 3', '+ 2', '', ' ❯ tests/math.test.ts:14:52', '     12|   });', '     14|   it(\'fails on purpose\', () => { expect(add(1, 1)).toBe(3); });', '',
  '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯', '', ' Test Files  1 failed (1)', '      Tests  1 failed | 2 passed | 1 skipped (4)', '   Start at  06:56:17',
].join('\n');
const JEST_OUT = [
  'FAIL tests/math.test.js', '  ● math › fails on purpose', '', '    expect(received).toBe(expected) // Object.is equality', '', '    Expected: 3', '    Received: 2', '',
  '      12 |   it.skip(\'later\', () => { expect(1).toBe(2); });', '    > 14 |   it(\'fails on purpose\', () => { expect(add(1, 1)).toBe(3); });', '         |                                                    ^', '      15 | });', '',
  '      at Object.toBe (tests/math.test.js:14:52)', '', 'Test Suites: 1 failed, 1 total', 'Tests:       1 failed, 1 skipped, 1 todo, 2 passed, 5 total', 'Snapshots:   0 total',
].join('\n');

test('parseTestSummary reads Vitest and Jest totals, including skipped and todo', () => {
  assert.deepEqual(parseTestSummary(VITEST_OUT), { tests: 4, pass: 2, fail: 1, skipped: 1, todo: 0 });
  assert.deepEqual(parseTestSummary(JEST_OUT), { tests: 5, pass: 2, fail: 1, skipped: 1, todo: 1 });
  assert.deepEqual(parseTestSummary('      Tests  3 passed | 1 todo (4)\n'), { tests: 4, pass: 3, fail: 0, skipped: 0, todo: 1 });
  assert.deepEqual(parseTestSummary('Tests:       7 passed, 7 total\n'), { tests: 7, pass: 7, fail: 0, skipped: 0, todo: 0 });
});

test('parseTestSummary does not mistake Vitest file counts or Jest suite counts for test counts', () => {
  assert.equal(parseTestSummary(' Test Files  1 failed (1)\nTest Suites: 1 failed, 1 total\n').tests, 0);
});

test('extractFailures names each failing Vitest test with its error and no code frame', () => {
  const out = extractFailures(VITEST_OUT);
  assert.match(out, /tests\/math\.test\.ts > math > fails on purpose/);
  assert.match(out, /expected 2 to be 3/);
  assert.doesNotMatch(out, /12\||14\||Test Files|Failed Tests/);
});

test('extractFailures names each failing Jest test with expected and received and no code frame', () => {
  const out = extractFailures(JEST_OUT);
  assert.match(out, /- math › fails on purpose/);
  assert.match(out, /Expected: 3/);
  assert.match(out, /Received: 2/);
  assert.doesNotMatch(out, /14 \||at Object|Test Suites|Snapshots|^- FAIL/m);
  assert.match(extractFailures('  ● adds wrongly\n\n    expect(received).toBe(expected)\n'), /- adds wrongly/, 'top-level test without a describe');
  assert.equal(extractFailures('  ● Console\n\n    console.log hi\n').includes('Console'), false);
});

const ISTANBUL = (file) => ({
  [file]: {
    path: file,
    statementMap: { 0: { start: { line: 3 } }, 1: { start: { line: 3 } }, 2: { start: { line: 4 } }, 3: { start: { line: 10 } } },
    s: { 0: 0, 1: 2, 2: 2, 3: 0 },
  },
});

test('istanbulLineCoverage counts a line once, as covered when any statement starting there ran', () => {
  const r = istanbulLineCoverage(ISTANBUL('/p/src/a.ts')['/p/src/a.ts']);
  assert.deepEqual(r, { executable: 3, covered: 2, uncoveredLines: [10], pct: 66.67 });
  assert.equal(istanbulLineCoverage({ statementMap: {}, s: {} }).pct, 100);
});

test('collectIstanbul maps absolute report paths to project-relative ones and ignores outsiders and node_modules', () => {
  const root = tmp();
  const dir = tmp();
  const report = { ...ISTANBUL(path.join(root, 'src', 'a.ts')), ...ISTANBUL(path.join(root, 'node_modules', 'x', 'i.js')), ...ISTANBUL('/elsewhere/src/z.ts') };
  fs.writeFileSync(path.join(dir, 'coverage-final.json'), JSON.stringify(report));
  assert.deepEqual([...collectIstanbul(dir, root).keys()], ['src/a.ts']);
});

test('collectIstanbul returns null when the runner wrote no usable report', () => {
  const root = tmp();
  const dir = tmp();
  assert.equal(collectIstanbul(dir, root), null);
  fs.writeFileSync(path.join(dir, 'coverage-final.json'), 'not json');
  assert.equal(collectIstanbul(dir, root), null);
});

test('analyzeTestFile accepts a path alias as a source reference only when it is configured', () => {
  const body = "import { add } from '@/math';\nit('a', () => { expect(add(1, 2)).toBe(3); expect(add(0, 0)).toBe(0); expect(add(1, 1)).toBe(2); });";
  assert.match(analyzeTestFile(body, { srcDirs: ['src'], minAssertions: 3 }).issues.join(), /never references the source/);
  assert.deepEqual(analyzeTestFile(body, { srcDirs: ['src'], minAssertions: 3, srcAliases: ['@/'] }).issues, []);
});

test('analyzeTestFile flags string and typed expect tautologies and counts typed expect calls', () => {
  const head = "import { add } from '../src/math';\n";
  const filler = 'expect(add(0, 0)).toBe(0); expect(add(1, 1)).toBe(2);';
  const opts = { srcDirs: ['src'], minAssertions: 3 };
  for (const tautology of ["expect('a').toBe('a');", 'expect<number>(1).toBe(1);', 'expect(true).toBeTruthy();']) {
    assert.match(analyzeTestFile(`${head}it('a', () => { ${tautology} ${filler} });`, opts).issues.join(), /tautolog/i, tautology);
  }
  const real = analyzeTestFile(`${head}it('a', () => { expect<number>(add(1, 2)).toBe(3); ${filler} });`, opts);
  assert.equal(real.assertions, 3);
  assert.deepEqual(real.issues, []);
  assert.deepEqual(analyzeTestFile(`${head}it('a', () => { expect('abc').toMatch('b'); expect(1).toBeGreaterThan(0); ${filler} });`, opts).issues, []);
});
