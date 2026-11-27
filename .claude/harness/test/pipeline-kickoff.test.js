'use strict';
// The kickoff step (#135, spec #126): a product's first run starts with the owner's kickoff choices. The pipeline
// has a kickoff phase before discover, the owner is shown the choices page, harness.js init names the step, and
// the spec-approved page's "Who judges each layer" section is filled from the choices.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const k = require('../lib/kickoff');
const { PAGE_SECTIONS, LAYERS, checkPipeline, formatReport } = require('../lib/pipeline');
const { setupRepo, LABELS } = require('../lib/repo-setup');

const ROOT = path.join(__dirname, '..');
const KICKOFF = path.join(ROOT, 'bin', 'kickoff.js');
const HARNESS = path.join(ROOT, 'bin', 'harness.js');
const LONG = 'x'.repeat(320);
const BRIEF = `# Brief\n## Success criteria\nSC1 a person can add two numbers. ${LONG}`;
const tmp = (prefix = 'step-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function write(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), typeof text === 'string' ? text : JSON.stringify(text));
  }
}
const labelled = (...labels) => async ({ spec }) => ({ issue: { number: spec, labels: labels.map((name) => ({ name })) } });
const check = (root, extra = {}) => checkPipeline({ root, product: 'app', docs: 'docs', runGate: async () => ({ pass: true, output: '' }), runTasksCheck: async () => ({ status: 0, stdout: '', stderr: '' }), readIssue: labelled(), ...extra });
const statusOf = (r) => Object.fromEntries(r.phases.map((p) => [p.name, p.status]));
const problemsOf = (r, name) => r.phases.find((p) => p.name === name).problems;
const notes = (r) => r.warnings.filter((w) => /kickoff step/.test(w));

// ---- the kickoff phase ----

test('a new run is incomplete at kickoff while kickoff.json is missing, and says what to do', async () => {
  const root = tmp();
  const r = await check(root);
  assert.equal(r.pass, false);
  assert.equal(r.blocked, 'kickoff');
  assert.equal(r.phases[0].name, 'kickoff');
  assert.equal(statusOf(r).discover, 'pending');
  const [problem] = problemsOf(r, 'kickoff');
  assert.match(problem, /docs\/kickoff\.json is missing: the owner has not made the kickoff choices/);
  assert.match(problem, /kickoff\.js --page/);
  assert.match(problem, /kickoff\.js --docs docs/);
  assert.match(problem, /never fill them in for the owner/);
});

test('the report at kickoff tells the agent to ask the owner, not to decide', async () => {
  const report = formatReport(await check(tmp()));
  assert.match(report, /\[1\/15\] kickoff: incomplete/);
  assert.match(report, /PIPELINE INCOMPLETE at phase "kickoff"\. This phase needs the owner's answers: ask the owner now/);
  assert.doesNotMatch(report, /do not stop to ask a human/);
});

test('an invalid kickoff.json keeps kickoff incomplete with each reason', async () => {
  const root = tmp();
  write(root, { 'docs/kickoff.json': { version: 1, choices: { gate1: 'agent', merge: 'nobody' } } });
  const r = await check(root);
  assert.equal(r.blocked, 'kickoff');
  const [problem] = problemsOf(r, 'kickoff');
  assert.match(problem, /docs\/kickoff\.json is not valid, so nothing in it applies/);
  assert.match(problem, /choice gate1: "agent" is for prototypes only/);
  assert.match(problem, /choice merge: "nobody" is not one of me, agent_safe, agent_all/);
  assert.match(problem, /ask the owner, never choose for them/);
});

test('a file that is not JSON keeps kickoff incomplete', async () => {
  const root = tmp();
  write(root, { 'docs/kickoff.json': '{ nope' });
  const r = await check(root);
  assert.equal(r.blocked, 'kickoff');
  assert.match(problemsOf(r, 'kickoff')[0], /is not valid JSON/);
});

test('a valid kickoff.json completes kickoff and the run moves on to discover', async () => {
  for (const file of [{ version: 1 }, JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'kickoff.json'), 'utf8')), { version: 1, prototype: true, choices: { gate1: 'agent' }, alsoSensitive: ['medical records'] }]) {
    const root = tmp();
    write(root, { 'docs/kickoff.json': file });
    const r = await check(root);
    assert.equal(statusOf(r).kickoff, 'done');
    assert.equal(r.blocked, 'discover');
    assert.deepEqual(notes(r), []);
  }
});

test('a run whose first check finds the kickoff file made its choices at kickoff, even with the brief already written', async () => {
  // The first check usually comes at the first stop, after discover: the file, not the brief, tells a new run.
  const root = tmp();
  write(root, { 'docs/kickoff.json': { version: 1 }, 'docs/brief.md': BRIEF });
  const r = await check(root);
  assert.equal(statusOf(r).kickoff, 'done');
  assert.deepEqual(notes(r), []);
  fs.rmSync(path.join(root, 'docs/kickoff.json'));
  assert.equal((await check(root)).blocked, 'kickoff', 'losing the file is not "under way"');
});

// ---- runs already under way ----

test('a run already under way with no kickoff.json is told once and reads the defaults', async () => {
  const root = tmp();
  write(root, { 'docs/brief.md': BRIEF });
  const first = await check(root);
  assert.equal(statusOf(first).kickoff, 'done');
  assert.equal(first.blocked, 'ux', 'the run carries on where it was');
  assert.equal(notes(first).length, 1);
  assert.match(notes(first)[0], /^note: this run started before the kickoff step existed and has no docs\/kickoff\.json, so it reads the default kickoff choices/);
  assert.match(formatReport(first), /note: this run started before the kickoff step existed/);
  // Told once: the next checks say nothing more, and the run still is not sent back.
  for (let i = 0; i < 2; i += 1) {
    const again = await check(root);
    assert.deepEqual(notes(again), []);
    assert.equal(again.blocked, 'ux');
  }
  // The defaults apply: the design gate, which the default choice asks for, is in the walk.
  assert.equal(statusOf(first)['design-approved'], 'pending');
});

test('a run with pipeline state on record but no brief counts as under way', async () => {
  const root = tmp();
  write(root, { '.harness/pipeline/app.gates.json': { designGate: { applies: true } } });
  const r = await check(root);
  assert.equal(r.blocked, 'discover');
  assert.equal(notes(r).length, 1);
});

test('a run under way that later gets a kickoff file reads it, and an invalid one is reported', async () => {
  const root = tmp();
  write(root, { 'docs/brief.md': BRIEF });
  await check(root);
  write(root, { 'docs/kickoff.json': { version: 1, choices: { merge: 'me' } } });
  assert.equal(statusOf(await check(root)).kickoff, 'done');
  write(root, { 'docs/kickoff.json': { version: 2 } });
  const r = await check(root);
  assert.equal(r.blocked, 'kickoff');
  assert.match(problemsOf(r, 'kickoff')[0], /"version" must be 1/);
  // Removing the file again does not send a run that was under way back to kickoff.
  fs.rmSync(path.join(root, 'docs/kickoff.json'));
  assert.equal((await check(root)).blocked, 'ux');
});

test('a change run has no kickoff phase and is told nothing', async () => {
  const root = tmp();
  write(root, {
    'docs/brief.md': BRIEF,
    '.harness/pipeline/app.gates.json': { approvals: { accepted: { files: {}, amends: {} } } },
    '.harness/pipeline/app.json': { files: {}, amends: {} },
    '.harness/pipeline/app.spec.json': { spec: 19 },
  });
  const r = await check(root, { change: 30 });
  assert.equal(r.phases.some((p) => p.name === 'kickoff'), false);
  assert.equal(r.blocked, 'size');
  assert.deepEqual(notes(r), []);
});

// ---- the choices page the owner answers ----

test('the choices page lists every choice in plain language with the recommended pick marked', () => {
  const text = k.page();
  assert.match(text, new RegExp(`^Kickoff choices\\n\\n${k.CHOICES.length} choices about how this run is handled`));
  const lines = text.split('\n');
  k.CHOICES.forEach((c, i) => {
    const at = lines.indexOf(`  ${i + 1}. ${c.question}`);
    assert.notEqual(at, -1, c.id);
    Object.entries(c.options).forEach(([value, label], j) => {
      assert.equal(lines[at + 1 + j], `       ${'abcdef'[j]}) ${label}${value === c.default ? '  <- recommended' : ''}`, `${c.id}=${value}`);
    });
  });
  assert.equal(text.match(/<- recommended/g).length, k.CHOICES.length);
  for (const group of new Set(k.CHOICES.map((c) => c.group))) assert.match(text, new RegExp(`^${group}$`, 'm'));
  for (const h of k.HARD_LIMITS) assert.ok(text.includes(`  - ${h.label}`));
  assert.match(text, /prototype/);
  // Plain language: no choice ids, values, file names or commands.
  assert.doesNotMatch(text, /agent_safe|gate_how|kickoff\.json|\.js\b|`/);
});

test('the page data gives each option the value kickoff.json takes', () => {
  const data = k.pageData();
  assert.deepEqual(data.map((c) => c.id), k.CHOICES.map((c) => c.id));
  for (const c of data) {
    assert.deepEqual(c.options.filter((o) => o.recommended).map((o) => o.value), [k.DEFAULTS[c.id]]);
    assert.equal(k.validate({ prototype: true, choices: Object.fromEntries([[c.id, c.options.at(-1).value]]) }).ok, true);
  }
  assert.deepEqual(data.find((c) => c.id === 'merge').options.filter((o) => o.prototypeOnly).map((o) => o.value), ['agent_all']);
});

const run = (args, cwd = tmp()) => spawnSync('node', [KICKOFF, ...args], { encoding: 'utf8', cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd } });

test('the command prints the page with --page, as data with --json, and refuses it with a file', () => {
  const plain = run(['--page']);
  assert.equal(plain.status, 0);
  assert.equal(plain.stdout.trimEnd(), k.page());
  assert.deepEqual(JSON.parse(run(['--page', '--json']).stdout), k.pageData());
  assert.equal(run(['--page', '--docs', 'docs']).status, 2);
  assert.equal(run(['--page', '--judges']).status, 2);
  assert.equal(run(['--judges', '--json']).status, 2);
});

// ---- who judges each layer ----

test('who judges each layer covers the five judgement layers and follows the picks', () => {
  assert.deepEqual(k.judges(k.DEFAULTS).map((j) => j.layer), Object.keys(LAYERS));
  const by = (choices) => Object.fromEntries(k.judges({ ...k.DEFAULTS, ...choices }).map((j) => [j.layer, j]));
  const d = by({});
  assert.equal(d.problem.judgedBy, 'The owner, every time');
  assert.equal(d.approach.judgedBy, 'The owner, every time');
  assert.equal(d.impression.judgedBy, 'The owner, from rendered variations');
  assert.equal(d.correctness.judgedBy, 'Checks (the verify gate); user acceptance testing: An agent first, then the owner; the result: The owner, every time');
  assert.equal(d.craft.judgedBy, 'Developer review; security review: An agent; the result: The owner, every time');
  assert.match(by({ gate1: 'agent_small' }).problem.judgedBy, /An agent for small changes/);
  assert.match(by({ look: 'agent' }).impression.judgedBy, /An agent picks/);
  assert.match(by({ uat: 'me', gate2: 'agent_fix' }).correctness.judgedBy, /The owner only; the result: An agent for fixes/);
  assert.match(by({ security: 'both' }).craft.judgedBy, /An agent, then a person/);
});

test('the why of a row names its choices and says when nothing checks one, in plain words', () => {
  const by = (choices) => Object.fromEntries(k.judges({ ...k.DEFAULTS, ...choices }).map((j) => [j.layer, j.why]));
  assert.equal(by({}).problem, 'Kickoff choice "Who judges Gate 1, the spec"');
  assert.match(by({ gate1: 'agent_small' }).problem, /Nothing checks the pick for "Who judges Gate 1, the spec" yet/);
  assert.match(by({}).craft, /Nothing checks the pick for "Who does the security review" yet/);
  for (const why of Object.values(by({ gate1: 'agent_small', uat: 'me' }))) assert.doesNotMatch(why, /\.js|#\d|\|/);
});

test('the command prints the judges rows for the page with --judges, and the problems of an invalid file', () => {
  const dir = tmp();
  write(dir, { 'docs/kickoff.json': { version: 1, choices: { security: 'both' } } });
  const r = run(['--docs', 'docs', '--judges'], dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trimEnd(), k.judgesTable({ ...k.DEFAULTS, security: 'both' }));
  assert.match(r.stdout, /^\| Layer \| Judged by \| Why \|\n\|---\|---\|---\|\n\| problem \| The owner, every time \|/);
  assert.equal(r.stdout.trimEnd().split('\n').length, 2 + Object.keys(LAYERS).length);
  write(dir, { 'docs/kickoff.json': { version: 3 } });
  const bad = run(['--docs', 'docs', '--judges'], dir);
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '');
  assert.match(bad.stderr, /not valid/);
});

// A run at the spec phase: kickoff, brief, ux and design in place; the spec issue named; the design gate not in
// the walk (kickoff choice design: none), so the page is the only thing the spec phase can miss.
const PAGE_STACK = '\n### Stack\n\nNode.js, gate adapter node (proven), every check runs. Alternative: Vite and React, adapter vitest-stryker (experimental).\n';
const specPage = (judges) => `# Spec-approved page: adder\n${PAGE_SECTIONS.map((name) => `\n## ${name}\n\n${name === 'Who judges each layer' ? judges : `Filled in for the adder product.\n${name === 'The real choices' ? PAGE_STACK : ''}`}`).join('')}\n`;
const SPEC_PHASE = {
  'docs/ux.md': `# UX\n### J1. Add (SC1)\nUC1 the sum is shown. ${LONG}`,
  'docs/design.md': `# Design\n${LONG}\n\n## Stack\n\nAdapter: node (proven)\nAlternative: vitest-stryker (experimental)\n`,
  'docs/decisions.md': '# Decisions\nSpec issue: #19\nLook: none\n',
};
const CHOSEN = { design: 'none', security: 'both' };
async function atSpec(page, { kickoff = { version: 1, choices: CHOSEN } } = {}) {
  const root = tmp();
  // Without a kickoff file the run is one under way, past the experience phase (so it has no design gate either).
  write(root, kickoff ? { 'docs/kickoff.json': kickoff } : { 'docs/brief.md': BRIEF, 'docs/design.md': SPEC_PHASE['docs/design.md'] });
  await check(root);
  write(root, { 'docs/brief.md': BRIEF, ...SPEC_PHASE, 'docs/spec-approved-page.md': page });
  return root;
}

test('the spec-approved page must say who judges each layer as the kickoff choices do', async () => {
  const root = await atSpec(specPage('The owner judges everything.'));
  const r = await check(root);
  assert.equal(r.blocked, 'spec');
  const [problem] = problemsOf(r, 'spec');
  assert.match(problem, /section "Who judges each layer" does not follow the kickoff choices for problem \(judged by: The owner, every time\)/);
  assert.match(problem, /craft \(judged by: Developer review; security review: An agent, then a person; the result: The owner, every time\)/);
  assert.match(problem, /kickoff\.js --docs docs --judges/);

  // The printed rows pass, and so do rows with the agent's own reason and some emphasis.
  write(root, { 'docs/spec-approved-page.md': specPage(k.judgesTable({ ...k.DEFAULTS, ...CHOSEN })) });
  assert.equal((await check(root)).blocked, 'spec-approved');
  const own = k.judges({ ...k.DEFAULTS, ...CHOSEN }).map((j) => `| **${j.layer}** | ${j.judgedBy.toLowerCase()} | Because the adder is small. |`).join('\n');
  write(root, { 'docs/spec-approved-page.md': specPage(`| Layer | Judged by | Why |\n|---|---|---|\n${own}`) });
  assert.equal((await check(root)).blocked, 'spec-approved');

  // Rows for other picks than this product's do not.
  write(root, { 'docs/spec-approved-page.md': specPage(k.judgesTable(k.DEFAULTS)) });
  const other = await check(root);
  assert.equal(other.blocked, 'spec');
  assert.match(problemsOf(other, 'spec')[0], /does not follow the kickoff choices for craft/);
  assert.doesNotMatch(problemsOf(other, 'spec')[0], /problem \(/);
});

test('a page the owner has approved is not reopened when the choices change', async () => {
  const root = await atSpec(specPage(k.judgesTable({ ...k.DEFAULTS, ...CHOSEN })));
  const approved = { readIssue: labelled('spec-approved') };
  assert.equal((await check(root, approved)).blocked, 'plan');
  write(root, { 'docs/kickoff.json': { version: 1, choices: { design: 'none', security: 'agent', uat: 'me' } } });
  assert.equal((await check(root, approved)).blocked, 'plan');
});

test('a run under way keeps its page as it is: the judges section is not held to the choices', async () => {
  const root = await atSpec(specPage('The owner judges everything.'), { kickoff: null });
  write(root, { 'docs/kickoff.json': { version: 1, choices: { design: 'none' } } });
  const r = await check(root);
  assert.equal(statusOf(r).spec, 'done');
  assert.equal(r.blocked, 'spec-approved');
});

// ---- harness.js init names the kickoff step ----

const PIPELINE = 'node .claude/harness/bin/pipeline.js check --product . --docs docs/product/shop';

test('the start note names the kickoff step while the file is missing or invalid, and is silent otherwise', () => {
  const dir = tmp();
  const note = (verifyCommand = PIPELINE) => k.startNote({ projectDir: dir, verifyCommand });
  assert.match(note(), /no kickoff choices yet\. Before phase 1, do the kickoff step/);
  assert.match(note(), /kickoff\.js --page/);
  assert.match(note(), /docs\/product\/shop\/kickoff\.json/);
  assert.match(note(), /already under way is told once and reads the defaults/);
  assert.match(note("node x/pipeline.js check --product . --docs 'docs/product/shop'"), /no kickoff choices yet/);
  write(dir, { 'docs/product/shop/kickoff.json': { version: 1, choices: { halt: 'fax' } } });
  assert.match(note(), /the kickoff file is not valid \(choice halt: "fax" is not one of list, email, phone\)/);
  write(dir, { 'docs/product/shop/kickoff.json': { version: 1 } });
  assert.equal(note(), null);
  fs.rmSync(path.join(dir, 'docs/product/shop/kickoff.json'));
  assert.equal(note(`${PIPELINE} --change 12`), null, 'a change run of an accepted product has no kickoff step');
  assert.equal(note('node .claude/harness/bin/pipeline.js check'), null);
  assert.equal(k.startNote({ projectDir: dir, verifyCommand: undefined }), null);
});

// A set-up product repository and a `gh` that always fails, as in setup-gate.test.js: nothing reaches the network.
function productRepo() {
  const dir = tmp('step-init-');
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/shop.git'], { cwd: dir });
  const have = new Set(LABELS.map((l) => l.name));
  const github = { listLabels: () => ({ ok: true, names: [...have] }), createLabel: () => ({ ok: true }) };
  assert.equal(setupRepo({ sourceClaudeDir: path.join(ROOT, '..'), targetDir: dir, github, environment: 'acme-shop' }).complete, true);
  return dir;
}
function init(dir, verify = PIPELINE) {
  const bin = tmp('step-gh-');
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\necho "gh: offline (test stub)" >&2\nexit 1\n', { mode: 0o755 });
  const labels = path.join(bin, 'labels.json');
  fs.writeFileSync(labels, JSON.stringify(LABELS.map((l) => ({ name: l.name }))));
  return spawnSync('node', [HARNESS, 'init', '--verify', verify, '--no-commit-gate', '--labels-json', labels], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir, PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
}

test('harness.js init for a product run names the kickoff step when the file is missing, and still starts', () => {
  const dir = productRepo();
  const r = init(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /\[harness\] NOTE: no kickoff choices yet\. Before phase 1, do the kickoff step/);
  assert.ok(fs.existsSync(path.join(dir, '.harness', 'state.json')));
});

test('harness.js init says nothing about kickoff once the file is valid, for a change run, or for a build-only run', () => {
  // A repository takes one run at a time, so each start gets its own.
  for (const verify of [`${PIPELINE} --change 12`, 'true']) {
    const r = init(productRepo(), verify);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /NOTE: .*kickoff/);
  }
  const dir = productRepo();
  write(dir, { 'docs/product/shop/kickoff.json': { version: 1 } });
  const r = init(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /NOTE: .*kickoff/);
});
