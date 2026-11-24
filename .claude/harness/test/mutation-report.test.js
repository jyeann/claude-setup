'use strict';
// Mutation judged from Stryker's mutation-testing-elements report (#59, ADR-0003): the pure reader on the real
// reports captured in the spike and on crafted ones, and the gate end to end through verify.js with a stand-in
// for `stryker run` (fixtures/standin-stryker.js) that takes the gate's config file and flags like Stryker does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseMutationReport, scoreMutants, MutationReportError } = require('../lib/reports/mutation-elements');
const { sampleFiles } = require('../lib/reports/mutation-run');

const VERIFY = path.join(__dirname, '..', 'bin', 'verify.js');
const STANDIN = path.join(__dirname, 'fixtures', 'standin-runner.sh');
const STRYKER = path.join(__dirname, 'fixtures', 'standin-stryker.js');
const REPORTS = path.join(__dirname, 'fixtures', 'reports');
const read = (name) => fs.readFileSync(path.join(REPORTS, name), 'utf8');

// ---- the reader

test('scores the spike\'s real report: Timeout counts as killed, Ignored is counted apart from the score', () => {
  const report = parseMutationReport(read('stryker-mutation.json'));
  assert.deepEqual(Object.keys(report.files), ['src/Slug.tsx']);
  assert.deepEqual(report.counts, { Killed: 9, Survived: 8, Timeout: 3, NoCoverage: 2, Ignored: 2, CompileError: 0, RuntimeError: 0 });
  const score = scoreMutants(report.counts);
  assert.equal(score.detected, 12);
  assert.equal(score.valid, 22);
  assert.equal(Math.round(score.rate * 1000) / 10, 54.5, 'the spike note gives 54.5%');
  assert.deepEqual(report.config.mutate, ['src/Slug.tsx']);
  assert.equal(report.config.incremental, false);
  const survivor = report.files['src/Slug.tsx'].mutants.find((m) => m.id === '2');
  assert.deepEqual(survivor, { id: '2', mutator: 'MethodExpression', replacement: 'input', status: 'Survived', reason: '', line: 4, column: 15, endLine: 4, endColumn: 27 });
});

test('CompileError is left out of the score but counted (the spike\'s TypeScript-checker report)', () => {
  const report = parseMutationReport(read('stryker-mutation-tscheck.json'));
  assert.deepEqual(report.counts, { Killed: 7, Survived: 7, Timeout: 3, NoCoverage: 1, Ignored: 2, CompileError: 4, RuntimeError: 0 });
  const score = scoreMutants(report.counts);
  assert.equal(score.valid, 18);
  assert.equal(Math.round(score.rate * 1000) / 10, 55.6, 'the spike note gives 55.6%');
});

test('each status is scored: Killed and Timeout detected; Survived and NoCoverage not; errors and Ignored excluded', () => {
  const counts = { Killed: 1, Timeout: 1, Survived: 1, NoCoverage: 1, CompileError: 5, RuntimeError: 5, Ignored: 5 };
  assert.deepEqual(scoreMutants(counts), { detected: 2, valid: 4, rate: 0.5 });
  assert.equal(scoreMutants({ Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0, CompileError: 3 }).rate, null, 'nothing scoreable: no rate');
});

test('refuses reports it cannot read with certainty, naming why but quoting nothing from them', () => {
  const base = { schemaVersion: '1.0', files: { 'src/a.js': { mutants: [{ id: '1', mutatorName: 'X', status: 'Killed', location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } } }] } } };
  const variant = (fn) => { const r = structuredClone(base); fn(r); return JSON.stringify(r); };
  const cases = [
    ['{"files": ', /not valid JSON/],
    ['[]', /not a JSON object/],
    [variant((r) => { delete r.schemaVersion; }), /schemaVersion/],
    [variant((r) => { r.schemaVersion = '2.0'; }), /schemaVersion/],
    [variant((r) => { r.files = []; }), /"files" is not an object/],
    [variant((r) => { r.files['src/a.js'].mutants = {}; }), /no mutants list/],
    [variant((r) => { r.files['src/a.js'].mutants[0].status = 'SECRET-Pending'; }), /unknown status/],
    [variant((r) => { delete r.files['src/a.js'].mutants[0].location; }), /no start line/],
    [variant((r) => { r.files['src/a.js'].mutants[0].location.start.line = 0; }), /no start line/],
  ];
  for (const [text, message] of cases) {
    assert.throws(() => parseMutationReport(text), (err) => err instanceof MutationReportError && message.test(err.message) && !/SECRET/.test(err.message), text);
  }
});

test('report paths are normalised: Windows separators and a leading ./ are read as project-relative', () => {
  const report = parseMutationReport(JSON.stringify({ schemaVersion: '1', files: { '.\\src\\a.js': { mutants: [] }, './src/b.js': { mutants: [] } } }));
  assert.deepEqual(Object.keys(report.files), ['src/a.js', 'src/b.js']);
});

test('the sample is seeded from the source: stable for the same source, different when it changes', () => {
  const files = ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js', 'src/e.js'];
  const texts = new Map(files.map((f) => [f, `// ${f}\n`]));
  const first = sampleFiles(files, texts, 2);
  assert.equal(first.length, 2);
  assert.deepEqual(sampleFiles(files, texts, 2), first, 'same source, same sample');
  assert.deepEqual([...first].sort(), first, 'sorted for the --mutate flag');
  const seen = new Set([first.join()]);
  for (let i = 0; i < 20; i += 1) seen.add(sampleFiles(files, new Map([...texts, ['src/a.js', `// edit ${i}\n`]]), 2).join());
  assert.ok(seen.size > 1, 'a changed source gives another sample');
  assert.deepEqual(sampleFiles(files, texts, 9), files, 'asking for more files than exist mutates them all');
});

// ---- the gate end to end

const UNIT = 'pass adds two numbers\npass rejects text\n';
// The owner's recorded acceptance of the checks the junit adapter still cannot run once mutation is provided.
const WEAKER = { missing: ['coverage', 'test-quality'], decision: 'decisions.md row 7' };
const SOURCES = { 'src/a.js': 'exports.a = 1;\n', 'src/b.js': 'exports.b = 2;\n', 'src/c.js': 'exports.c = 3;\n' };

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
function project({ scenario = {}, mutation = {}, config = {}, sources = SOURCES } = {}) {
  const dir = tmp('verify-mutation-');
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  write('tests/cases.txt', UNIT);
  for (const [rel, text] of Object.entries(sources)) write(rel, text);
  write('scenario.json', JSON.stringify(scenario));
  const cfg = {
    adapter: 'junit', runner: 'standin-pytest', testCommand: `sh ${JSON.stringify(STANDIN)} tests/cases.txt`, minTests: 2, replicates: 1, weakerGate: WEAKER,
    mutation: { command: `node ${JSON.stringify(STRYKER)} --scenario scenario.json run`, testRunner: 'vitest', samples: 2, minKillRate: 0.6, ...mutation },
    ...config,
  };
  write('verify.config.json', JSON.stringify(cfg));
  return dir;
}
const runs = (dir) => fs.readFileSync(path.join(dir, 'scenario.json.runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const { NODE_TEST_CONTEXT, ...cleanEnv } = process.env;
function verify(dir, ...args) {
  const tmpdir = tmp('verify-mutation-tmpdir-');
  const r = spawnSync('node', [VERIFY, ...args], { cwd: dir, encoding: 'utf8', env: { ...cleanEnv, TMPDIR: tmpdir } });
  return { ...r, tmpdir, leftovers: fs.readdirSync(tmpdir) };
}
const text = (r) => `${r.stdout}${r.stderr}`;

test('the gate runs Stryker with its own config file outside the project and a seeded --mutate, never --incremental', () => {
  const dir = project();
  const r = verify(dir);
  assert.equal(r.status, 0, text(r));
  assert.match(r.stdout, /mutation: killed 2\/2 \(100%, floor 60%\)/);
  assert.match(r.stdout, /VERIFY PASSED/);
  assert.match(r.stdout, /not checked \(weaker gate, junit adapter\): coverage, test-quality \(owner decision/);
  assert.deepEqual(r.leftovers, [], 'the report directory and Stryker\'s sandbox are deleted after reading');

  const [run] = runs(dir);
  const flag = (name) => run.args[run.args.indexOf(`--${name}`) + 1];
  assert.ok(!run.args.includes('--incremental'), 'no --incremental is ever passed');
  assert.equal(run.gateConfig.incremental, false);
  assert.equal(flag('testRunner'), 'vitest');
  assert.equal(flag('reporters'), 'json');
  assert.equal(flag('checkers'), '', 'the TypeScript checker is off by default');
  const configFile = run.args.find((a) => a.endsWith('.json') && a !== 'scenario.json');
  assert.ok(configFile.startsWith(r.tmpdir), `the gate config ${configFile} lives in the gate's directory, outside the project`);
  assert.ok(run.gateConfig.jsonReporter.fileName.startsWith(r.tmpdir));
  assert.ok(path.isAbsolute(flag('tempDirName')) && flag('tempDirName').startsWith(r.tmpdir), 'Stryker\'s sandbox is outside the project');
  const mutate = flag('mutate').split(',');
  assert.equal(mutate.length, 2, 'mutation.samples files are sampled');
  assert.ok(mutate.every((f) => Object.hasOwn(SOURCES, f)));

  verify(dir);
  assert.equal(runs(dir)[1].args[runs(dir)[1].args.indexOf('--mutate') + 1], flag('mutate'), 'the same source gives the same sample');
});

test('opt-in checkers are passed through; the project\'s own Stryker config is never read', () => {
  const dir = project({ mutation: { checkers: ['typescript'] } });
  fs.writeFileSync(path.join(dir, 'stryker.config.json'), JSON.stringify({ mutate: ['nothing'], incremental: true }));
  const r = verify(dir);
  assert.equal(r.status, 0, text(r));
  const [run] = runs(dir);
  assert.equal(run.args[run.args.indexOf('--checkers') + 1], 'typescript');
  assert.ok(!run.args.includes('stryker.config.json'));
});

test('surviving and uncovered mutants fail below minKillRate, each shown with file, line and the change', () => {
  const dir = project({
    sources: { 'src/a.js': 'exports.a = (x) => x > 1;\n' },
    scenario: { mutants: { 'src/a.js': [
      { status: 'Killed' }, { status: 'Timeout' },
      { status: 'Survived', line: 1, mutator: 'EqualityOperator', replacement: 'x >= 1' },
      { status: 'NoCoverage', line: 1, mutator: 'ArrowFunction', replacement: '() => undefined' },
      { status: 'CompileError' }, { status: 'RuntimeError' },
    ] } },
    mutation: { minKillRate: 0.75 },
  });
  const r = verify(dir);
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /mutation: killed 2\/4 \(50%, floor 75%\)/);
  assert.match(r.stdout, /excluded from the score: 1 CompileError, 1 RuntimeError/);
  assert.match(r.stdout, /survived: src\/a\.js:1 EqualityOperator -> `x >= 1` \(no test noticed\)/);
  assert.match(r.stdout, /no coverage: src\/a\.js:1 ArrowFunction -> `\(\) => undefined` \(no test runs this code\)/);
  assert.match(r.stdout, /mutation: 2\/4 mutants survived or were not covered/);
});

test('the real spike report through the gate: 54.5% passes a 50% floor and fails a 60% one on its Ignored mutants', () => {
  const scenario = { fromReport: path.join(REPORTS, 'stryker-mutation.json') };
  const ignored = [{ file: 'src/a.js', line: 24, mutator: 'StringLiteral' }];
  let r = verify(project({ scenario, sources: { 'src/a.js': SOURCES['src/a.js'] }, mutation: { minKillRate: 0.5, ignored } }));
  assert.equal(r.status, 0, text(r));
  assert.match(r.stdout, /mutation: killed 12\/22 \(55%, floor 50%\)/);
  assert.match(r.stdout, /3 Timeout counted as killed/);

  r = verify(project({ scenario, sources: { 'src/a.js': SOURCES['src/a.js'] }, mutation: { minKillRate: 0.5 } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /mutation: 2 Ignored mutant\(s\) not listed in mutation\.ignored: src\/a\.js:24 StringLiteral \("hint copy is not logic"\) x2/);
});

test('an Ignored mutant fails unless listed; a listed one is printed as a weakening', () => {
  const scenario = { mutants: { 'src/a.js': [{ status: 'Killed' }, { status: 'Ignored', line: 3, mutator: 'StringLiteral', reason: 'copy text' }] } };
  const one = { 'src/a.js': SOURCES['src/a.js'] };
  let r = verify(project({ scenario, sources: one }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /mutation: 1 Ignored mutant\(s\) not listed in mutation\.ignored: src\/a\.js:3 StringLiteral \("copy text"\)/);
  assert.match(r.stdout, /a `Stryker disable` comment does not pass the gate/);

  r = verify(project({ scenario, sources: one, mutation: { ignored: [{ file: 'src/a.js', line: 3, mutator: 'StringLiteral' }] } }));
  assert.equal(r.status, 0, text(r));
  assert.match(r.stdout, /weakening: 1 Ignored mutant\(s\) accepted by mutation\.ignored in verify\.config\.json: src\/a\.js:3 StringLiteral \("copy text"\)/);
  assert.match(r.stdout, /VERIFY PASSED\n {2}weakening: mutation\.ignored accepts 1 Ignored mutant\(s\)/);

  r = verify(project({ scenario, sources: one, mutation: { ignored: [{ file: 'src/a.js', line: 4, mutator: 'StringLiteral' }] } }));
  assert.equal(r.status, 1, 'another line does not match');
});

test('a sampled file missing from the report fails; a file the gate did not ask for fails too', () => {
  const one = { 'src/a.js': SOURCES['src/a.js'], 'src/b.js': SOURCES['src/b.js'] };
  let r = verify(project({ sources: one, scenario: { omit: ['src/b.js'] } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /mutation: sampled file\(s\) missing from the report: src\/b\.js; every sampled file must be mutated/);
  r = verify(project({ sources: one, scenario: { extra: { 'src/other.js': [{ status: 'Killed' }] } } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /mutation: the report holds file\(s\) the gate did not ask to mutate: src\/other\.js/);
});

test('the report must show the gate\'s flags were honoured: no incremental run, the gate\'s --mutate list', () => {
  let r = verify(project({ scenario: { config: { incremental: true } } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /mutation: the report says Stryker ran incrementally/);
  r = verify(project({ scenario: { config: { mutate: ['src/a.js'] } }, sources: { 'src/a.js': 'x\n', 'src/b.js': 'y\n' } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /mutation: the report's mutate list \(src\/a\.js\) is not the gate's sample \(src\/a\.js, src\/b\.js\)/);
});

test('exceeding mutation.budgetMs fails with the time used', () => {
  const r = verify(project({ scenario: { sleepMs: 5000 }, mutation: { budgetMs: 300 } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /mutation: the step exceeded its budget of 300 ms \(stopped after \d+ ms\)/);
  assert.deepEqual(r.leftovers, []);
});

test('trust rules: a non-zero exit, a missing, stale or unreadable report all fail', () => {
  let r = verify(project({ scenario: { exit: 3 } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /mutation: the mutation command exited with code 3; a non-zero exit always fails/);
  r = verify(project({ scenario: { noReport: true } }));
  assert.match(r.stdout, /mutation: no mutation report was written\. The gate passes its own Stryker config file .* and --testRunner --mutate --reporters json --checkers --tempDirName/);
  r = verify(project({ scenario: { oldReport: true } }));
  assert.match(r.stdout, /mutation: the mutation report is older than this run/);
  r = verify(project({ scenario: { garbage: true } }));
  assert.match(r.stdout, /mutation: malformed mutation report: not valid JSON/);
  r = verify(project({ scenario: { mutants: { 'src/a.js': [{ status: 'CompileError' }] } }, sources: { 'src/a.js': 'x\n' } }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /mutation: no mutant could be scored \(only CompileError, RuntimeError or Ignored\)/);
});

test('--fast skips the mutation step; failing tests skip it too', () => {
  let r = verify(project(), '--fast');
  assert.equal(r.status, 0, text(r));
  assert.match(r.stdout, /mutation: skipped \(--fast\)/);
  const dir = project();
  fs.writeFileSync(path.join(dir, 'tests', 'cases.txt'), `${UNIT}fail broken | nope\n`);
  r = verify(dir);
  assert.match(r.stdout, /mutation: skipped until the checks above pass/);
  assert.ok(!fs.existsSync(path.join(dir, 'scenario.json.runs.jsonl')));
});

test('weakerGate stays exact: with a mutation command, listing mutation as missing fails; without one, omitting it fails', () => {
  let r = verify(project({ config: { weakerGate: { missing: ['coverage', 'test-quality', 'mutation'], decision: 'x' } } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /weakerGate\.missing must list exactly coverage, test-quality \(listed but checked: mutation\)/);

  const dir = project();
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'verify.config.json'), 'utf8'));
  cfg.mutation = { samples: 2 };
  fs.writeFileSync(path.join(dir, 'verify.config.json'), JSON.stringify(cfg));
  r = verify(dir);
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /mutation: not available for the junit adapter \(set mutation\.command\)/);
  assert.match(r.stdout, /\(not listed: mutation\)/);
});

test('config: mutation command keys are checked, and refused on the node adapter', () => {
  const cases = [
    [{ mutation: { command: '' } }, /mutation\.command must be a non-empty string/],
    [{ mutation: { command: 'x' } }, /mutation\.testRunner \(string\) is required with mutation\.command/],
    [{ mutation: { command: 'x', testRunner: 'vitest', budgetMs: 0 } }, /mutation\.budgetMs must be a positive integer/],
    [{ mutation: { command: 'x', testRunner: 'vitest', checkers: 'typescript' } }, /mutation\.checkers must be an array of names/],
    [{ mutation: { command: 'x', testRunner: 'vitest', ignored: [{ file: 'src/a.js', line: 'x', mutator: 'M' }] } }, /mutation\.ignored entries need "file", "line" and "mutator"/],
    [{ mutation: { command: 'x', testRunner: 'vitest', incremental: true } }, /mutation\.incremental is not allowed/],
    [{ adapter: 'node', runner: undefined, weakerGate: undefined, mutation: { command: 'x', testRunner: 'vitest' } }, /mutation\.command, mutation\.testRunner apply only with "adapter": "junit"/],
    [{ adapter: 'node', runner: undefined, weakerGate: undefined, mutation: { budgetMs: 1000 } }, /apply only with "adapter": "junit"/],
  ];
  for (const [config, message] of cases) {
    const dir = project();
    const cfg = { ...JSON.parse(fs.readFileSync(path.join(dir, 'verify.config.json'), 'utf8')), ...config };
    for (const key of Object.keys(cfg)) if (cfg[key] === undefined) delete cfg[key];
    fs.writeFileSync(path.join(dir, 'verify.config.json'), JSON.stringify(cfg));
    const r = verify(dir);
    assert.equal(r.status, 2, `${JSON.stringify(config)}: ${text(r)}`);
    assert.match(r.stderr, message, JSON.stringify(config));
  }
});
