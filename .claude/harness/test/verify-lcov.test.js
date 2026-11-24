'use strict';
// Coverage from lcov end to end (#58): verify.js with "adapter": "junit" and the vitest runner, driven by a
// script that takes the gate's flags the way Vitest does and writes the real lcov captured in the spike.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VERIFY = path.join(__dirname, '..', 'bin', 'verify.js');
const REPORTS = path.join(__dirname, 'fixtures', 'reports');
const PASS_LCOV = path.join(REPORTS, 'vitest-pass.lcov.info');
const NO_INCLUDE_LCOV = path.join(REPORTS, 'vitest-fail-no-include.lcov.info');
const WEAKER = { missing: ['test-quality', 'mutation'], decision: 'decisions.md row 8' };

// `sh vitest.sh run <lcov file | none> [old]`: writes a 3-test JUnit report and copies <lcov file> to the
// lcov path the gate's flags name; exits 9 when a coverage flag the gate must append is missing.
const VITEST = `#!/bin/sh
src="$2"; old="$3"; junit=""; covdir=""; include=""; onfail=""; enabled=""; reporter=""
printf '%s\\n' "$@" > args.txt
for a in "$@"; do case "$a" in
  --outputFile.junit=*) junit="\${a#--outputFile.junit=}" ;;
  --coverage.reportsDirectory=*) covdir="\${a#--coverage.reportsDirectory=}" ;;
  --coverage.include=*) include=1 ;;
  --coverage.reportOnFailure) onfail=1 ;;
  --coverage.enabled) enabled=1 ;;
  --coverage.reporter=lcovonly) reporter=1 ;;
esac; done
[ -n "$junit" ] && [ -n "$covdir" ] && [ -n "$include" ] && [ -n "$onfail" ] && [ -n "$enabled" ] && [ -n "$reporter" ] || { echo "missing coverage flags" >&2; exit 9; }
cat > "$junit" <<'XML'
<testsuites><testsuite name="s" tests="3"><testcase name="a"/><testcase name="b"/><testcase name="c"/></testsuite></testsuites>
XML
mkdir -p "$covdir"
[ "$src" = none ] || cp "$src" "$covdir/lcov.info"
[ "$old" = old ] && touch -t 200101010000 "$covdir/lcov.info"
echo "      Tests  3 passed (3)"
exit 0
`;

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
// Stand-ins for the spike's files, as long as the real ones (the lcov names lines up to 28 and 4).
const lines = (n, prefix) => Array.from({ length: n }, (_, i) => `export const ${prefix}${i + 1} = ${i + 1};`).join('\n');
const SLUG = `${lines(30, 'slug')}\n`;
const MAIN = `${lines(5, 'main')}\n`;
const writeLcov = (text) => { const file = path.join(tmp('verify-lcov-custom-'), 'lcov.info'); fs.writeFileSync(file, text); return file; };

function project({ lcov = PASS_LCOV, extra = '', files = { 'src/Slug.tsx': SLUG }, config = {} } = {}) {
  const dir = tmp('verify-lcov-');
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  write('vitest.sh', VITEST);
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  const cfg = { adapter: 'junit', runner: 'vitest', testCommand: `sh vitest.sh run ${JSON.stringify(lcov)} ${extra}`.trim(), minTests: 2, replicates: 1, weakerGate: WEAKER, ...config };
  write('verify.config.json', JSON.stringify(cfg));
  return dir;
}

const { NODE_TEST_CONTEXT, ...cleanEnv } = process.env;
function verify(dir) {
  const tmpdir = tmp('verify-lcov-tmpdir-');
  const r = spawnSync('node', [VERIFY], { cwd: dir, encoding: 'utf8', env: { ...cleanEnv, TMPDIR: tmpdir } });
  return { ...r, leftovers: fs.readdirSync(tmpdir) };
}
const text = (r) => `${r.stdout}${r.stderr}`;

test('coverage from the real Vitest lcov passes the floors and reports uncovered line ranges', () => {
  const dir = project();
  const r = verify(dir);
  assert.equal(r.status, 0, text(r));
  assert.match(r.stdout, /^ {2}src\/Slug\.tsx {2}91\.67% \(11\/12\) uncovered lines: 17$/m);
  assert.match(r.stdout, /total source line coverage: 91\.67% \(floor 80%\)/);
  assert.doesNotMatch(r.stdout, /coverage: not available/);
  assert.match(r.stdout, /not checked \(weaker gate, junit adapter\): test-quality, mutation \(owner decision: decisions.md row 8\)/);
  assert.deepEqual(r.leftovers, [], 'the report directory, lcov included, is deleted after reading');
  const args = fs.readFileSync(path.join(dir, 'args.txt'), 'utf8').split('\n');
  assert.ok(args.includes('--coverage.include=src/**'), args.join(' '));
  assert.ok(args.includes('--coverage.reportOnFailure'));
  assert.ok(args.some((a) => a.startsWith('--coverage.reportsDirectory=') && !a.includes(dir)), 'the lcov goes outside the project');
});

test('one --coverage.include per srcDir, trailing slashes dropped', () => {
  const dir = project({ config: { srcDirs: ['src/', 'lib'] } });
  verify(dir);
  const args = fs.readFileSync(path.join(dir, 'args.txt'), 'utf8').split('\n');
  assert.deepEqual(args.filter((a) => a.startsWith('--coverage.include=')), ['--coverage.include=src/**', '--coverage.include=lib/**']);
});

test('.tsx counts as source for the vitest runner: an untested main.tsx at 0% fails the per-file floor', () => {
  const r = verify(project({ files: { 'src/Slug.tsx': SLUG, 'src/main.tsx': MAIN } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /^ {2}src\/main\.tsx {2}0% \(0\/1\) uncovered lines: 4$/m);
  assert.match(r.stdout, /coverage: src\/main\.tsx is 0%, below the 50% per-file floor/);
  assert.match(r.stdout, /total source line coverage: 84\.62%/);
});

test('a source file missing from the lcov report fails, naming it', () => {
  const r = verify(project({ lcov: NO_INCLUDE_LCOV, files: { 'src/Slug.tsx': SLUG, 'src/main.tsx': MAIN } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /^ {2}src\/main\.tsx {2}missing from the lcov report$/m);
  assert.match(r.stdout, /coverage: src\/main\.tsx is missing from the lcov report; every source file under src must appear in it/);
});

test('coverage.exclude leaves a file out but is printed as a weakening', () => {
  const r = verify(project({ lcov: NO_INCLUDE_LCOV, files: { 'src/Slug.tsx': SLUG, 'src/main.tsx': MAIN }, config: { coverage: { exclude: ['src/main.tsx'] } } }));
  assert.equal(r.status, 0, text(r));
  assert.match(r.stdout, /^ {2}weakening: coverage\.exclude leaves src\/main\.tsx unmeasured$/m);
  assert.match(r.stdout, /^ {2}weakened \(verify\.config\.json\): coverage\.exclude src\/main\.tsx$/m);
});

test('the total floor applies to lcov coverage as on the node path', () => {
  const r = verify(project({ config: { coverage: { minLines: 95 } } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /coverage: total 91\.67% is below the 95% floor/);
});

test('the weaker gate list shrinks for the vitest runner: coverage is checked, and listing it fails (exact match)', () => {
  let r = verify(project({ config: { weakerGate: { missing: ['coverage', 'test-quality', 'mutation'], decision: 'x' } } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /weakerGate\.missing must list exactly test-quality, mutation \(listed but checked: coverage\)/);
  r = verify(project({ config: { weakerGate: undefined } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /the junit adapter does not run test-quality, mutation; this needs an owner decision recorded as "weakerGate": \{"missing": \["test-quality","mutation"\]/);
});

test('a missing, stale or malformed lcov fails the coverage step, naming the flags', () => {
  let r = verify(project({ lcov: 'none' }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /coverage: no lcov report was written\. The gate appends --coverage\.enabled --coverage\.reporter=lcovonly --coverage\.reportsDirectory=<dir> --coverage\.include=<srcDir>\/\*\* --coverage\.reportOnFailure/);
  r = verify(project({ extra: 'old' }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /coverage: the lcov report is older than this run/);
  const bad = path.join(tmp('verify-lcov-bad-'), 'bad.info');
  fs.writeFileSync(bad, 'SF:src/Slug.tsx\nDA:oops\nend_of_record\n');
  r = verify(project({ lcov: bad }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /coverage: malformed lcov report: line 2: unreadable DA: entry/);
});

test('a test file inside srcDirs fails the lcov coverage step, as test quality does on the node path', () => {
  const r = verify(project({ files: { 'src/Slug.tsx': SLUG, 'src/Slug.test.tsx': 'y\n' } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /src\/Slug\.test\.tsx is a test file inside the source dir/);
});

test('minSourceFiles applies to lcov coverage: deleting source cannot raise the score', () => {
  const r = verify(project({ config: { coverage: { minSourceFiles: 2 } } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /coverage: expected at least 2 source file\(s\) under src, found 1; do not delete source to raise coverage/);
});

test('a coverage ignore hint in a source file fails, naming file and line, whatever its comment form or case', () => {
  for (const hint of ['/* v8 ignore next */', '/* V8 IGNORE START */', '// c8 ignore next', '/* istanbul ignore if */', '/* node:coverage ignore next */']) {
    const r = verify(project({ files: { 'src/Slug.tsx': `${lines(2, 'a')}\n${hint}\n${lines(27, 'b')}\n` } }));
    assert.equal(r.status, 1, `${hint}: ${text(r)}`);
    assert.match(r.stdout, /coverage: src\/Slug\.tsx:3 has a coverage ignore hint; lines it hides are not measured\. Remove it, or list the file in coverage\.exclude/, hint);
  }
});

test('a hint in a file listed in coverage.exclude does not fail: the exclusion is printed as a weakening instead', () => {
  const r = verify(project({ lcov: NO_INCLUDE_LCOV, files: { 'src/Slug.tsx': SLUG, 'src/main.tsx': `/* v8 ignore start */\n${MAIN}` }, config: { coverage: { exclude: ['src/main.tsx'] } } }));
  assert.equal(r.status, 0, text(r));
  assert.match(r.stdout, /weakening: coverage\.exclude leaves src\/main\.tsx unmeasured/);
});

test('a non-empty source file whose record has no executable lines fails; a blank or comment-only file does not', () => {
  const empty = writeLcov('SF:src/Slug.tsx\nDA:4,1\nend_of_record\nSF:src/empty.ts\nLF:0\nLH:0\nend_of_record\n');
  let r = verify(project({ lcov: empty, files: { 'src/Slug.tsx': SLUG, 'src/empty.ts': 'export const hidden = () => 1;\n' } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /coverage: src\/empty\.ts: no executable lines reported for a non-empty file/);
  r = verify(project({ lcov: empty, files: { 'src/Slug.tsx': SLUG, 'src/empty.ts': '// nothing here yet\n/* really */\n\n' } }));
  assert.equal(r.status, 0, text(r));
});

test('a DA: line beyond the end of the source file fails, naming file and line', () => {
  const r = verify(project({ files: { 'src/Slug.tsx': `${lines(20, 'short')}\n` } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /coverage: src\/Slug\.tsx: the lcov report names line 21, but the file has 20 line\(s\); the report does not describe this file/);
});

test('no source file under srcDirs fails as on the node path', () => {
  const r = verify(project({ files: { 'lib/a.ts': 'x\n' } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /no source files found under src/);
});
