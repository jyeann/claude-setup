'use strict';
// #105: the full gate runs only on ready PRs. These tests read the real workflow files and evaluate their `if:`
// expressions for each event, so a draft, a push to main, a ready PR and a manual run are checked, not assumed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isDocFile, isDocsOnly } = require('../lib/docs-only');
const { DEFAULT_PROTECTED } = require('../lib/protected');

const HARNESS = path.join(__dirname, '..');
const REPO_ROOT = path.join(HARNESS, '..', '..');
const DOCS_ONLY = path.join(HARNESS, 'bin', 'docs-only.js');
const CI = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const TEMPLATE = fs.readFileSync(path.join(HARNESS, 'ci', 'verify.yml'), 'utf8');
const RULESET = JSON.parse(fs.readFileSync(path.join(HARNESS, 'ci', 'ruleset.json'), 'utf8'));
const REQUIRED = RULESET.rules.find((r) => r.type === 'required_status_checks').parameters.required_status_checks.map((c) => c.context);

const WORKFLOWS = {
  'ci.yml': { text: CI, heavy: ['gate-retro-board', 'gate-slug-react', 'eval-kit-selftest'], fast: ['harness-tests', 'secret-scan'], required: REQUIRED },
  'verify.yml': { text: TEMPLATE, heavy: ['verify'], fast: ['protected-files', 'secret-scan'], required: ['verify', 'protected-files', 'secret-scan'] },
};

// ---------- a small evaluator for the GitHub expression subset the workflows use ----------
function tokenize(src) {
  const re = /\s*(\|\||&&|==|!=|!|\(|\)|,|'(?:[^']|'')*'|[A-Za-z_][\w.-]*)/y;
  const text = src.trimEnd();
  const out = [];
  while (re.lastIndex < text.length) {
    const m = re.exec(text);
    if (!m) throw new Error(`cannot parse expression at ${re.lastIndex}: ${src}`);
    out.push(m[1]);
  }
  return out;
}
function evaluate(src, ctx) {
  const t = tokenize(src);
  let i = 0;
  const peek = () => t[i];
  const take = (want) => { const v = t[i]; if (want && v !== want) throw new Error(`expected ${want}, got ${v} in ${src}`); i += 1; return v; };
  const or = () => { let v = and(); while (peek() === '||') { take(); const r = and(); v = v || r; } return v; };
  const and = () => { let v = cmp(); while (peek() === '&&') { take(); const r = cmp(); v = v && r; } return v; };
  const cmp = () => {
    let v = unary();
    while (peek() === '==' || peek() === '!=') {
      const op = take();
      const r = unary();
      v = op === '==' ? String(v ?? '') === String(r ?? '') : String(v ?? '') !== String(r ?? '');
    }
    return v;
  };
  const unary = () => (peek() === '!' ? (take(), !unary()) : primary());
  const primary = () => {
    const v = take();
    if (v === '(') { const r = or(); take(')'); return r; }
    if (v.startsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
    if (v === 'true' || v === 'false') return v === 'true';
    if (peek() === '(') {
      take('(');
      const args = [];
      while (peek() !== ')') { args.push(or()); if (peek() === ',') take(','); }
      take(')');
      return ctx.functions[v](...args);
    }
    return v.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
  };
  const result = or();
  if (i !== t.length) throw new Error(`trailing tokens in ${src}`);
  return result;
}
const condition = (raw) => raw.trim().replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '');

// ---------- reading jobs and steps out of the workflow text ----------
function jobBlock(text, name) {
  const jobs = text.slice(text.indexOf('\njobs:'));
  const start = jobs.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `job ${name}`);
  const next = jobs.slice(start + 1).search(/\n {2}[\w-]+:\s*\n/);
  return next < 0 ? jobs.slice(start) : jobs.slice(start, start + 1 + next);
}
const jobIf = (block) => (block.match(/^ {4}if: (.*)$/m) || [])[1];
function steps(block) {
  return block.slice(block.indexOf('\n    steps:\n')).split(/\n(?= {6}- )/).slice(1).map((s) => ({
    text: s,
    id: (s.match(/^ {8}id: (\S+)$/m) || [])[1],
    ifs: [...s.matchAll(/^ {8}if: (.*)$/gm)].map((m) => m[1]),
  }));
}

const EVENTS = {
  'draft PR opened': { event_name: 'pull_request', event: { action: 'opened', pull_request: { draft: true } } },
  'push to a draft PR': { event_name: 'pull_request', event: { action: 'synchronize', pull_request: { draft: true } } },
  'ready PR opened': { event_name: 'pull_request', event: { action: 'opened', pull_request: { draft: false } } },
  'draft marked ready': { event_name: 'pull_request', event: { action: 'ready_for_review', pull_request: { draft: false } } },
  'push to a ready PR': { event_name: 'pull_request', event: { action: 'synchronize', pull_request: { draft: false } } },
  'ready PR reopened': { event_name: 'pull_request', event: { action: 'reopened', pull_request: { draft: false } } },
  'push to main': { event_name: 'push', event: {} },
  'manual run': { event_name: 'workflow_dispatch', event: {} },
};
const HEAVY_RUNS = new Set(['ready PR opened', 'draft marked ready', 'push to a ready PR', 'ready PR reopened', 'manual run']);
const jobRuns = (block, github) => {
  const cond = jobIf(block);
  return cond === undefined ? true : Boolean(evaluate(condition(cond), { github, functions: {} }));
};

for (const [file, wf] of Object.entries(WORKFLOWS)) {
  test(`${file}: PR events are opened, reopened, synchronize and ready_for_review; main pushes and manual runs still trigger`, () => {
    assert.match(wf.text, /^on:\n {2}pull_request:\n {4}types: \[opened, reopened, synchronize, ready_for_review\]\n {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:\n/m);
    assert.match(wf.text, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/, 'cancel-in-progress stays for PRs');
  });

  test(`${file}: heavy jobs run only on a ready PR or a manual run; a draft and a push to main get the fast checks only`, () => {
    for (const [label, github] of Object.entries(EVENTS)) {
      for (const job of wf.heavy) assert.equal(jobRuns(jobBlock(wf.text, job), github), HEAVY_RUNS.has(label), `${job} on ${label}`);
      for (const job of wf.fast) {
        const expected = job === 'protected-files' ? github.event_name === 'pull_request' : true;
        assert.equal(jobRuns(jobBlock(wf.text, job), github), expected, `${job} on ${label}`);
      }
    }
  });

  test(`${file}: job names are unchanged and every required check is a fast job or a heavy job that runs on every mergeable PR`, () => {
    const names = [...wf.text.slice(wf.text.indexOf('\njobs:')).matchAll(/^ {4}name: (\S+)$/gm)].map((m) => m[1]);
    assert.deepEqual(names.sort(), [...wf.heavy, ...wf.fast].sort());
    for (const check of wf.required) {
      assert.ok(names.includes(check), `required check ${check} is a job`);
      const mergeable = ['ready PR opened', 'draft marked ready', 'push to a ready PR', 'ready PR reopened'];
      for (const label of mergeable) assert.ok(jobRuns(jobBlock(wf.text, check), EVENTS[label]), `${check} must report on ${label}`);
    }
  });

  test(`${file}: in each heavy job the docs-only step runs on PRs first and every later step skips only on an exact "true"`, () => {
    for (const job of wf.heavy) {
      const all = steps(jobBlock(wf.text, job));
      assert.match(all[0].text, /uses: actions\/checkout@\S+[\s\S]*fetch-depth: 0/, `${job}: full history for the base diff`);
      assert.equal(all[1].id, 'scope', `${job}: the docs-only step comes right after checkout`);
      assert.match(all[1].text, /run: node \.claude\/harness\/bin\/docs-only\.js --base "origin\/\$BASE_REF"/);
      assert.match(all[1].text, /BASE_REF: \$\{\{ github\.base_ref \}\}/);
      for (const s of all) assert.ok(s.ifs.length <= 1, `${job}: a step has two if: keys (YAML keeps only the last)`);
      for (const s of all.slice(2)) {
        assert.equal(s.ifs.length, 1, `${job}: every step after the docs-only check is conditional`);
        const cond = condition(s.ifs[0]);
        const run = (docsOnly) => Boolean(evaluate(cond, { steps: { scope: { outputs: { docs_only: docsOnly } } }, github: {}, functions: { hashFiles: () => 'abc' } }));
        assert.equal(run('true'), false, `${job}: skipped on a docs-only PR`);
        for (const v of ['false', '', undefined]) assert.equal(run(v), true, `${job}: runs when docs_only is ${JSON.stringify(v)} (fail closed)`);
      }
      const scopeIf = condition(all[1].ifs[0]);
      assert.equal(evaluate(scopeIf, { github: EVENTS['manual run'] }), false, 'a manual run never takes the docs-only skip');
      assert.equal(evaluate(scopeIf, { github: EVENTS['push to a ready PR'] }), true);
    }
  });
}

test('ci.yml keeps testbench/ Markdown (golden artifacts, prompts, specs) as gate inputs', () => {
  for (const job of WORKFLOWS['ci.yml'].heavy) assert.match(jobBlock(CI, job), /docs-only\.js --base "origin\/\$BASE_REF" --keep testbench\//, job);
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'testbench', 'retro-board', 'tune', 'golden')), 'the selftest grades Markdown under testbench/');
});

test('the expression evaluator handles the operators the workflows use', () => {
  const ctx = { a: { b: 'x' }, functions: { f: (v) => `${v}!` } };
  assert.equal(evaluate("a.b == 'x' && !(a.c == 'y') || false", ctx), true);
  assert.equal(evaluate("f('it''s') != 'it''s!'", ctx), false);
  assert.throws(() => evaluate("a.b == 'x' )", ctx), /trailing/);
  assert.throws(() => evaluate('a.b == #', ctx), /cannot parse/);
  assert.throws(() => evaluate('(a.b', ctx), /expected \)/);
});

// ---------- the docs-only rule ----------
const GATE = [...DEFAULT_PROTECTED];

test('documentation is docs/ or *.md outside every gate input', () => {
  for (const f of ['docs/adr/0004.md', 'docs/img/flow.png', 'README.md', 'notes/CHANGES.MD', './docs/a.txt', 'packages/x/README.md']) assert.equal(isDocFile(f, GATE), true, f);
  for (const f of ['.claude/rules/x.md', '.github/pull_request_template.md', 'acceptance/notes.md', 'spec.md', 'SPEC.md', 'src/a.js', 'Docs/a.js', 'docs.js', 'readme.md.js']) assert.equal(isDocFile(f, GATE), false, f);
  assert.equal(isDocFile('testbench/x/spec.md', [...GATE, 'testbench/']), false, '--keep paths are gate inputs');
});

test('returns docs-only only when every changed file is documentation, never for an empty or mixed change', () => {
  assert.equal(isDocsOnly(['docs/a.md', 'README.md'], GATE), true);
  assert.equal(isDocsOnly(['docs/a.md', 'src/a.js'], GATE), false);
  assert.equal(isDocsOnly(['docs/a.md', '.github/workflows/ci.yml'], GATE), false);
  assert.equal(isDocsOnly([], GATE), false);
});

// ---------- the docs-only CLI against real git history ----------
const { NODE_TEST_CONTEXT, GITHUB_OUTPUT, ...cleanEnv } = process.env;
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};
function prRepo(base, change) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-only-'));
  const put = (files) => {
    for (const [name, text] of Object.entries(files)) {
      const full = path.join(dir, name);
      if (text === null) { fs.rmSync(full); continue; }
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, text);
    }
  };
  git(dir, 'init', '-q', '-b', 'main');
  put(base);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'pr');
  put(change);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'change');
  return dir;
}
function decide(dir, ...extra) {
  const out = path.join(dir, '..', `${path.basename(dir)}.out`);
  fs.writeFileSync(out, '');
  const r = spawnSync('node', [DOCS_ONLY, '--base', 'main', ...extra], { cwd: dir, encoding: 'utf8', env: { ...cleanEnv, GITHUB_OUTPUT: out } });
  return { ...r, output: fs.readFileSync(out, 'utf8') };
}

test('docs-only CLI writes docs_only=true for a docs-only PR and false for a PR that also changes code', () => {
  const base = { 'src/a.js': 'a', 'docs/guide.md': 'g', 'README.md': 'r' };
  const docs = decide(prRepo(base, { 'docs/guide.md': 'g2', 'README.md': 'r2', 'docs/new.md': 'n' }));
  assert.equal(docs.status, 0, docs.stderr);
  assert.equal(docs.output, 'docs_only=true\n');
  assert.match(docs.stdout, /3 changed file\(s\), all documentation/);

  const mixed = decide(prRepo(base, { 'docs/guide.md': 'g2', 'src/a.js': 'b' }));
  assert.equal(mixed.status, 0, mixed.stderr);
  assert.equal(mixed.output, 'docs_only=false\n');
  assert.match(mixed.stdout, /not docs-only: 1 non-documentation file\(s\), e\.g\. src\/a\.js/);
});

test('docs-only CLI treats a move out of code, a workflow doc, a --keep path and the base .harness-protected list as code', () => {
  const moved = prRepo({ 'src/a.js': 'a' }, { 'src/a.js': null, 'docs/a.md': 'a' });
  assert.equal(decide(moved).output, 'docs_only=false\n', 'a rename lists the old code path');
  assert.equal(decide(prRepo({ 'x.js': 'x' }, { '.github/notes.md': 'n' })).output, 'docs_only=false\n');
  assert.equal(decide(prRepo({ 'x.js': 'x' }, { 'testbench/golden/a.md': 'n' }), '--keep', 'testbench/').output, 'docs_only=false\n');
  const listed = prRepo({ '.harness-protected': 'prompts/\n' }, { 'prompts/build.md': 'p', '.harness-protected': '' });
  assert.equal(decide(listed).output, 'docs_only=false\n', 'the list comes from the base, so the PR cannot empty it');
});

test('docs-only CLI fails closed: a bad base ref or bad arguments exit 2 and write no output', () => {
  const dir = prRepo({ 'a.md': 'a' }, { 'a.md': 'b' });
  const bad = decide(dir, '--keep');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Missing value for --keep/);
  assert.equal(bad.output, '');
  const r = spawnSync('node', [DOCS_ONLY, '--base', 'no-such-ref'], { cwd: dir, encoding: 'utf8', env: cleanEnv });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no-such-ref/);
  for (const args of [[], ['--what', 'x']]) assert.equal(spawnSync('node', [DOCS_ONLY, ...args], { cwd: dir, encoding: 'utf8', env: cleanEnv }).status, 2);
});

test('docs-only CLI says when it found no changed files and runs the gate', () => {
  const dir = prRepo({ 'a.md': 'a' }, {});
  const r = spawnSync('node', [DOCS_ONLY, '--base', 'HEAD'], { cwd: dir, encoding: 'utf8', env: cleanEnv });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no changed files found; running the full gate/);
});
