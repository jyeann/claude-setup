'use strict';
// The lcov reader (lib/reports/lcov.js, #58): the real reports captured in the spike, malformed input, and the
// normalisation of `SF:` paths against the project root (absolute, relative, backslashes, letter case).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseLcov, LcovError, toProjectPath, indexLcov, fileCoverage, coverageHints, isBlankSource } = require('../lib/reports/lcov');
const { filePatterns } = require('../lib/strong-verify');

const REPORTS = path.join(__dirname, 'fixtures', 'reports');
const real = (name) => fs.readFileSync(path.join(REPORTS, name), 'utf8');

test('reads the real Vitest lcov of the spike: Slug.tsx 11 of 12 lines, main.tsx present at 0%', () => {
  const records = parseLcov(real('vitest-pass.lcov.info'));
  assert.deepEqual(records.map((r) => r.file), ['src/Slug.tsx', 'src/main.tsx']);
  const slug = fileCoverage(records[0].lines);
  assert.deepEqual(slug, { executable: 12, covered: 11, uncoveredLines: [17], pct: 91.67 });
  assert.equal(records[0].lines.get(7), 25);
  assert.deepEqual(fileCoverage(records[1].lines), { executable: 1, covered: 0, uncoveredLines: [4], pct: 0 });
});

test('reads the real lcov of the run without --coverage.include: main.tsx is simply absent', () => {
  const records = parseLcov(real('vitest-fail-no-include.lcov.info'));
  assert.deepEqual(records.map((r) => r.file), ['src/Slug.tsx']);
});

test('a file with no executable lines counts as fully covered; lcov 2 records and checksums are accepted', () => {
  const [rec] = parseLcov('VER:2.0\nTN:\nSF:src/types.ts\nFNL:0,1,2\nFNA:0,0,f\nLF:0\nLH:0\nend_of_record\n');
  assert.deepEqual(fileCoverage(rec.lines), { executable: 0, covered: 0, uncoveredLines: [], pct: 100 });
  const [sum] = parseLcov('SF:a.js\r\nDA:1,3,abcdef\r\nDA:2,0\r\nend_of_record\r\n');
  assert.deepEqual(fileCoverage(sum.lines), { executable: 2, covered: 1, uncoveredLines: [2], pct: 50 });
});

test('refuses a report with no SF: record: nothing was measured', () => {
  assert.throws(() => parseLcov(''), (err) => err instanceof LcovError && /no SF: record/.test(err.message));
  assert.throws(() => parseLcov('\n\nTN:\n'), /no SF: record/);
});

test('refuses malformed lcov with the line number, never guessing', () => {
  const cases = [
    ['DA:1,1\nend_of_record\n', /line 1: DA: outside an SF: record/],
    ['SF:a.js\nDA:1,1\n', /line 1: the SF: record is not closed by end_of_record/],
    ['SF:a.js\nSF:b.js\nend_of_record\n', /line 2: SF: before end_of_record/],
    ['SF:a.js\nDA:x,1\nend_of_record\n', /line 2: unreadable DA: entry/],
    ['SF:a.js\nDA:1,-2\nend_of_record\n', /line 2: unreadable DA: entry/],
    ['SF:a.js\nDA:0,1\nend_of_record\n', /line 2: unreadable DA: entry/],
    ['SF:a.js\nDA:1\nend_of_record\n', /line 2: unreadable DA: entry/],
    ['SF:\nend_of_record\n', /line 1: SF: has no path/],
    ['SF:a.js\nthis is not lcov\nend_of_record\n', /line 2: not an lcov record/],
    ['end_of_record\n', /line 1: end_of_record without SF:/],
    ['SF:a.js\nDA:1,1\nDA:2,0\nLF:3\nLH:1\nend_of_record\n', /line 4: LF:3 disagrees with the 2 DA: line\(s\)/],
    ['SF:a.js\nDA:1,1\nDA:2,0\nLF:2\nLH:2\nend_of_record\n', /line 5: LH:2 disagrees with the 1 covered DA: line\(s\)/],
    ['SF:a.js\nLF:two\nend_of_record\n', /line 2: unreadable LF: entry/],
  ];
  for (const [text, message] of cases) {
    assert.throws(() => parseLcov(text), (err) => err instanceof LcovError && /^malformed lcov report: /.test(err.message) && message.test(err.message), text);
  }
});

test('a line listed twice in one record keeps the higher hit count', () => {
  const [rec] = parseLcov('SF:a.js\nDA:1,0\nDA:1,4\nend_of_record\n');
  assert.equal(rec.lines.get(1), 4);
});

test('SF: paths are normalised against the project root: relative, ./, .., absolute, backslashes, drive letters', () => {
  const root = '/work/app';
  const linux = { platform: 'linux' };
  const win = { platform: 'win32' };
  assert.equal(toProjectPath('src/a.ts', [root], linux), 'src/a.ts');
  assert.equal(toProjectPath('./src/a.ts', [root], linux), 'src/a.ts');
  assert.equal(toProjectPath('src/lib/../a.ts', [root], linux), 'src/a.ts');
  assert.equal(toProjectPath('/work/app/src/a.ts', [root], linux), 'src/a.ts');
  assert.equal(toProjectPath('/work/app/', [root], linux), null, 'the root itself is not a file');
  assert.equal(toProjectPath('src\\nested\\a.ts', [root], linux), 'src/nested/a.ts');
  assert.equal(toProjectPath('C:\\work\\app\\src\\a.ts', ['C:\\work\\app'], win), 'src/a.ts');
  assert.equal(toProjectPath('c:/Work/App/src/a.ts', ['C:\\work\\app\\'], win), 'src/a.ts', 'on Windows the root prefix is matched ignoring letter case');
  assert.equal(toProjectPath('/Work/App/src/a.ts', [root], { platform: 'darwin' }), 'src/a.ts', 'macOS too');
  assert.equal(toProjectPath('/Work/App/src/a.ts', [root], linux), null, 'on Linux letter case is significant');
  assert.equal(toProjectPath('/elsewhere/src/a.ts', [root], linux), null, 'outside the project');
  assert.equal(toProjectPath('/work/application/src/a.ts', [root], linux), null, 'a sibling with the same prefix is outside');
  assert.equal(toProjectPath('../other/src/a.ts', [root], linux), null, 'relative paths that leave the project are outside');
  assert.equal(toProjectPath('/private/work/app/src/a.ts', [root, '/private/work/app'], linux), 'src/a.ts', 'any of the roots (the real path of a symlinked root)');
});

const MIXED = [
  'SF:/work/app/SRC/Slug.TSX', 'DA:1,1', 'DA:2,0', 'end_of_record',
  'SF:src\\b.ts', 'DA:1,3', 'DA:2,0', 'end_of_record',
  'SF:src/b.ts', 'DA:1,2', 'DA:2,1', 'end_of_record',
  'SF:tests/b.test.ts', 'DA:1,1', 'end_of_record',
  'SF:/elsewhere/x.ts', 'DA:1,1', 'end_of_record',
  'SF:src/Dup.ts', 'DA:1,1', 'end_of_record',
].join('\n');
const MIXED_FILES = ['src/Slug.tsx', 'src/b.ts', 'src/dup.ts', 'src/DUP.ts'];

test('on Windows and macOS records match ignoring letter case when unambiguous; duplicate records merge by the highest hit count', () => {
  for (const platform of ['win32', 'darwin']) {
    const byFile = indexLcov(parseLcov(MIXED), { roots: ['/work/app'], files: MIXED_FILES, platform });
    assert.deepEqual([...byFile.keys()].sort(), ['src/Slug.tsx', 'src/b.ts'], platform);
    assert.deepEqual(fileCoverage(byFile.get('src/Slug.tsx')), { executable: 2, covered: 1, uncoveredLines: [2], pct: 50 });
    assert.deepEqual([...byFile.get('src/b.ts')], [[1, 3], [2, 1]], 'two records for one file merge by max per line, not sum');
    assert.equal(byFile.has('src/dup.ts') || byFile.has('src/DUP.ts'), false, 'an ambiguous case-insensitive match is not guessed');
  }
});

test('on Linux records must match the source file\'s exact letter case', () => {
  const byFile = indexLcov(parseLcov(MIXED), { roots: ['/work/app'], files: MIXED_FILES, platform: 'linux' });
  assert.deepEqual([...byFile.keys()], ['src/b.ts']);
});

test('finds coverage ignore hints in any comment form and letter case, with their line numbers', () => {
  const text = [
    'const a = 1;',
    '/* v8 ignore next */',
    '/*  V8 Ignore Start */',
    '// c8 ignore next 3',
    '/* istanbul ignore else */',
    '/* node:coverage ignore next */',
    '/* c8 ignore stop */ const b = 2;',
    '// istanbul is a city; ignore this',
    'const v8 = "ignored";',
  ].join('\n');
  assert.deepEqual(coverageHints(text), [2, 3, 4, 5, 6, 7]);
  assert.deepEqual(coverageHints('export const x = 1;\n'), []);
});

test('a file is blank when only comments and whitespace remain', () => {
  assert.equal(isBlankSource('\n  // only a note\n/* and\n a block */\n'), true);
  assert.equal(isBlankSource(''), true);
  assert.equal(isBlankSource('export type A = string;\n'), false);
  assert.equal(isBlankSource('// x\nconst a = 1;'), false);
});

test('.tsx and .jsx count only for a runner that declares them; the node path keeps its patterns', () => {
  const node = filePatterns({ adapter: 'node', runner: null });
  assert.equal(node.source.test('src/a.tsx'), false);
  assert.equal(node.source.test('src/a.jsx'), false);
  assert.equal(node.source.test('src/a.mts'), true);
  assert.equal(node.test.test('tests/a.test.tsx'), false);
  const vitest = filePatterns({ adapter: 'junit', runner: 'vitest' });
  for (const f of ['src/a.tsx', 'src/a.jsx', 'src/a.ts', 'src/a.cjs']) assert.equal(vitest.source.test(f), true, f);
  assert.equal(vitest.source.test('src/a.css'), false);
  assert.equal(vitest.test.test('tests/a.test.tsx'), true);
  assert.equal(vitest.test.test('tests/a.spec.jsx'), true);
  const standin = filePatterns({ adapter: 'junit', runner: 'standin-pytest' });
  assert.equal(standin.source.test('src/a.tsx'), false, 'a runner that does not declare JSX keeps the node patterns');
});
