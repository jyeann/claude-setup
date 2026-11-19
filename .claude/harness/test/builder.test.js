'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const jobs = require('../lib/job');
const builder = require('../lib/builder');

const CLI = path.join(__dirname, '..', 'bin', 'builder.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-builder-'));
const write = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const throwsMsg = (fn, re) => assert.throws(fn, (e) => re.test(e.message));

// A job at the build stage, ready for the craft-anything builder.
function buildJob(dir, { id = 'j', kind = 'build', source = '', surfaces = [], builderName = 'craft-anything', risk = 'low' } = {}) {
  const root = jobs.rootOf(dir);
  const extra = kind === 'rebuild' ? { requestedBy: 'sam', acknowledgement: 'I own the legal side', source } : {};
  jobs.create(root, { id, title: 'Thing', kind, builder: builderName, ...extra });
  jobs.intake(root, id, { decision: 'accept', risk, surfaces });
  jobs.recordRefCheck(root, id, { expect: 'red', passed: true });
  jobs.advance(root, id, 'build');
  return { root, job: jobs.read(root, id) };
}
const opts = (dir, extra = {}) => ({ projectDir: dir, env: {}, request: 'A snake game', ...extra });

test('a greenfield build is planned as rebuild - "<request>" with an unattended run and no allow-run', () => {
  const dir = tmp();
  const { job } = buildJob(dir);
  const p = builder.buildCommand(job, opts(dir, { buildWith: 'Rust + macroquad', rounds: 1 }));
  assert.equal(p.binary, 'craft-anything-cli');
  assert.deepEqual(p.argv.slice(0, 2), ['rebuild', '-']);
  assert.equal(p.argv[2], 'A snake game');
  assert.ok(p.argv.includes('--unattended'));
  assert.ok(!p.argv.includes('--allow-run'));
  assert.ok(!p.argv.includes('--clean-room'));
  assert.deepEqual(p.argv.slice(p.argv.indexOf('--rounds'), p.argv.indexOf('--rounds') + 2), ['--rounds', '1']);
  assert.deepEqual(p.argv.slice(p.argv.indexOf('--build-with'), p.argv.indexOf('--build-with') + 2), ['--build-with', 'Rust + macroquad']);
  assert.equal(p.folder, path.join(dir, '.harness', 'builds', 'j'));
  assert.equal(p.mode, 'build');
});

test('a rebuild of someone else\'s product is clean-room by default and passes the source as the target', () => {
  const dir = tmp();
  const { job } = buildJob(dir, { kind: 'rebuild', source: 'https://example.com/' });
  const p = builder.buildCommand(job, opts(dir));
  assert.deepEqual(p.argv.slice(0, 2), ['rebuild', 'https://example.com/']);
  assert.ok(p.argv.includes('--clean-room'));
  assert.ok(!p.argv.includes('--deep'));
  assert.equal(p.mode, 'clean-room');
});

test('deep mode needs a rebuild and a recorded reason; it is never the default', () => {
  const dir = tmp();
  const rb = buildJob(dir, { id: 'r', kind: 'rebuild', source: 'https://example.com/' }).job;
  throwsMsg(() => builder.buildCommand(rb, opts(dir, { deep: true })), /Give a reason/);
  const p = builder.buildCommand(rb, opts(dir, { deep: true, deepReason: 'owner asked to study the checkout flow' }));
  assert.ok(p.argv.includes('--deep') && !p.argv.includes('--clean-room'));
  assert.equal(p.mode, 'deep');
  const gf = buildJob(dir, { id: 'g' }).job;
  throwsMsg(() => builder.buildCommand(gf, opts(dir, { deep: true, deepReason: 'x' })), /for rebuilds/);
});

test('allow-run needs intake to have tagged runs-generated-code, which also raises the risk and adds security review', () => {
  const dir = tmp();
  const plain = buildJob(dir, { id: 'a' });
  throwsMsg(() => builder.buildCommand(plain.job, opts(dir, { allowRun: true })), /tag the job runs-generated-code/);
  const tagged = buildJob(dir, { id: 'b', surfaces: ['runs-generated-code'] });
  assert.equal(tagged.job.risk, 'medium');
  assert.ok(tagged.job.reviewers.includes('security-reviewer'));
  const p = builder.buildCommand(tagged.job, opts(dir, { allowRun: true }));
  assert.ok(p.argv.includes('--allow-run'));
  assert.ok(p.argv.includes('--unattended'));
});

test('the adapter refuses to spend money: generate-assets is never passed', () => {
  const dir = tmp();
  const { job } = buildJob(dir);
  throwsMsg(() => builder.buildCommand(job, opts(dir, { generateAssets: true })), /spend decision for the owner/);
});

test('the job must use this builder, be active and be at the build stage', () => {
  const dir = tmp();
  const native = buildJob(dir, { id: 'n', builderName: 'native' }).job;
  throwsMsg(() => builder.buildCommand(native, opts(dir)), /native builder, not craft-anything/);
  const root = jobs.rootOf(dir);
  jobs.create(root, { id: 'early', title: 't', builder: 'craft-anything' });
  jobs.intake(root, 'early', { decision: 'accept', risk: 'low' });
  throwsMsg(() => builder.buildCommand(jobs.read(root, 'early'), opts(dir)), /at spec: advance it to build first/);
  const done = buildJob(dir, { id: 'x' });
  jobs.needsHuman(done.root, 'x', { reason: 'spend-legal-scope', detail: 'paid?' });
  throwsMsg(() => builder.buildCommand(jobs.read(done.root, 'x'), opts(dir)), /needs-human/);
});

test('request and rounds are validated, and a rebuild needs a source', () => {
  const dir = tmp();
  const { job } = buildJob(dir);
  throwsMsg(() => builder.buildCommand(job, opts(dir, { request: ' ' })), /needs a request/);
  throwsMsg(() => builder.buildCommand(job, opts(dir, { request: 'x'.repeat(8001) })), /limit is 8000/);
  for (const rounds of [0, 6, 1.5]) throwsMsg(() => builder.buildCommand(job, opts(dir, { rounds })), /rounds must be/);
  const noSource = buildJob(dir, { id: 'ns', kind: 'rebuild', source: ' ' }).job;
  throwsMsg(() => builder.buildCommand(noSource, opts(dir)), /needs a source/);
  const noAck = { ...noSource, source: 'https://e.com', acknowledgement: null };
  throwsMsg(() => builder.buildCommand(noAck, opts(dir)), /requester and acknowledgement/);
});

test('HARNESS_BUILDS_DIR and CRAFT_ANYTHING_CLI change where the build goes and which binary runs', () => {
  const dir = tmp();
  const { job } = buildJob(dir);
  const p = builder.buildCommand(job, { projectDir: dir, env: { HARNESS_BUILDS_DIR: 'out/b', CRAFT_ANYTHING_CLI: '/opt/ca/cli' }, request: 'x' });
  assert.equal(p.binary, '/opt/ca/cli');
  assert.equal(p.folder, path.join(dir, 'out', 'b', 'j'));
});

test('outcome: a ready build with passing checks, usage figures and an app folder', () => {
  const dir = tmp();
  write(dir, 'craft.json', JSON.stringify({ status: 'ready', stack: 'Rust + macroquad', questions: [1], checks: [
    { round: 1, passed: false, similarity: 0.4 }, { round: 2, passed: true, similarity: 0.93 }, { round: 2, passed: true, similarity: 0.88 }] }));
  write(dir, 'usage.json', JSON.stringify({ input_tokens: 1000, output_tokens: 500, work_ms: 60000, cost_usd: 1.25, api_billed_usd: 0, tokens_incomplete: false }));
  fs.mkdirSync(path.join(dir, 'app'));
  const o = builder.readOutcome(dir);
  assert.equal(o.state, 'ready');
  assert.deepEqual(o.checks, { total: 2, passed: 2, failed: 0, unknown: 0 });
  assert.equal(o.similarity, 0.88);
  assert.deepEqual(o.usage, { tokens: 1500, incomplete: false, workMs: 60000, costUsd: 1.25, apiBilledUsd: 0 });
  assert.equal(o.app, true);
  assert.equal(o.questions, 1);
  assert.equal(o.stack, 'Rust + macroquad');
});

test('outcome states: a failing latest check makes a ready build not-ready; needs_you, stopped, in-progress and a missing file are distinct', () => {
  const dir = tmp();
  const at = (craft) => { write(dir, 'craft.json', JSON.stringify(craft)); return builder.readOutcome(dir).state; };
  assert.equal(at({ status: 'ready', checks: [{ round: 1, passed: false }] }), 'not-ready');
  assert.equal(at({ status: 'ready', checks: [] }), 'ready');
  assert.equal(at({ status: 'needs_you' }), 'needs-you');
  assert.equal(at({ status: 'stopped' }), 'stopped');
  assert.equal(at({ status: 'building' }), 'incomplete');
  assert.equal(at({}), 'incomplete');
  assert.equal(builder.readOutcome(path.join(dir, 'nope')).state, 'unreadable');
  write(dir, 'craft.json', '{broken');
  assert.equal(builder.readOutcome(dir).state, 'unreadable');
  assert.equal(builder.readOutcome(dir).usage, null);
});

test('unknown checks are counted as unknown, not as passes', () => {
  const dir = tmp();
  write(dir, 'craft.json', JSON.stringify({ status: 'ready', checks: [{ round: 1, passed: null }, { round: 1, passed: true }] }));
  const o = builder.readOutcome(dir);
  assert.deepEqual(o.checks, { total: 2, passed: 1, failed: 0, unknown: 1 });
  assert.equal(o.similarity, null);
});

test('the brand scan finds a forbidden term in text files, case-insensitively, and ignores binaries, dependencies and clean files', () => {
  const dir = tmp();
  write(dir, 'index.html', '<h1>Welcome to ACME Lessons</h1>\n<p>Sample copy</p>');
  write(dir, 'css/site.css', '/* acme brand blue */ body{}');
  write(dir, 'node_modules/x/index.js', 'acme');
  write(dir, 'logo.png', 'acme');
  write(dir, 'clean.js', 'console.log("hello")');
  const hits = builder.scanForbidden(dir, ['Acme', ' ']);
  assert.deepEqual(hits.map((h) => [h.file, h.line, h.term]).sort(), [['css/site.css', 1, 'Acme'], ['index.html', 1, 'Acme']]);
  assert.deepEqual(builder.scanForbidden(dir, []), []);
  assert.deepEqual(builder.scanForbidden(path.join(dir, 'missing'), ['acme']), []);
});

test('recording an outcome on the job: ready is ok, anything else is not, a missing file is unreported', () => {
  const dir = tmp();
  const { root } = buildJob(dir);
  const ready = { state: 'ready', checks: { total: 2, passed: 2, failed: 0, unknown: 0 }, usage: { tokens: 900, incomplete: true, workMs: 5000 } };
  builder.recordOutcome(root, 'j', ready);
  builder.recordOutcome(root, 'j', ready, { forbiddenHits: 2 });
  builder.recordOutcome(root, 'j', { ...ready, state: 'stopped', usage: null });
  builder.recordOutcome(root, 'j', { state: 'unreadable', checks: { total: 0 }, usage: null });
  const agents = jobs.read(root, 'j').agents;
  assert.deepEqual(agents.map((a) => a.ok), [true, false, false, null]);
  assert.equal(agents[0].tokens, 900);
  assert.match(agents[0].task, /2\/2 checks passed; token counts incomplete/);
  assert.match(agents[1].task, /2 forbidden term/);
  assert.equal(agents[3].tokens, null);
  assert.equal(jobs.summary(jobs.read(root, 'j')).unreported, 1);
});

test('collect copies app/ into an empty folder inside the project and refuses anything else', () => {
  const dir = tmp();
  const folder = path.join(dir, '.harness', 'builds', 'j');
  write(folder, 'app/index.html', 'hi');
  write(folder, 'app/node_modules/dep/a.js', 'x');
  write(folder, 'app/src/main.rs', 'fn main(){}');
  const r = builder.collect(dir, folder, 'examples/thing');
  assert.deepEqual(r, { dest: path.join('examples', 'thing'), files: 2 });
  assert.ok(fs.existsSync(path.join(dir, 'examples', 'thing', 'src', 'main.rs')));
  assert.ok(!fs.existsSync(path.join(dir, 'examples', 'thing', 'node_modules')));
  throwsMsg(() => builder.collect(dir, folder, 'examples/thing'), /already has files/);
  throwsMsg(() => builder.collect(dir, folder, '../outside'), /inside the project/);
  throwsMsg(() => builder.collect(dir, folder, '.'), /inside the project/);
  throwsMsg(() => builder.collect(dir, path.join(dir, 'none'), 'x'), /no app\/ folder/);
});

test('run reports a missing binary clearly and passes the runner the deadline and the argument list', async () => {
  const dir = tmp();
  const { job } = buildJob(dir);
  const plan = builder.buildCommand(job, opts(dir));
  await assert.rejects(builder.run(plan, { runner: async () => ({ code: null, output: '', timedOut: false, missing: true }) }), /was not found.*CRAFT_ANYTHING_CLI/);
  let seen;
  const r = await builder.run(plan, { timeoutMs: 1234, runner: async (bin, args, o) => { seen = { bin, args, o }; return { code: 0, output: 'ok', timedOut: false, missing: false }; } });
  assert.equal(r.code, 0);
  assert.deepEqual(seen.args, plan.argv);
  assert.equal(seen.o.timeoutMs, 1234);
});

test('the real runner runs a program without stdin, captures output, reports a missing binary and kills one that overruns', async () => {
  const dir = tmp();
  const ok = await builder.spawnRunner(process.execPath, ['-e', 'console.log("hi"); process.stdin.on("data",()=>{}); process.stdin.on("end",()=>console.log("stdin closed"))'], { timeoutMs: 10_000, cwd: dir });
  assert.equal(ok.code, 0);
  assert.match(ok.output, /hi/);
  assert.match(ok.output, /stdin closed/);
  const missing = await builder.spawnRunner('/no/such/binary-xyz', [], { timeoutMs: 10_000, cwd: dir });
  assert.equal(missing.missing, true);
  const slow = await builder.spawnRunner(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 300, cwd: dir });
  assert.equal(slow.timedOut, true);
});

// A fake craft-anything-cli: writes what a finished build leaves behind, so the whole adapter runs end to end.
function fakeCli(dir, { status = 'ready', exit = 0, brand = '' } = {}) {
  const file = path.join(dir, 'fake-cli.js');
  fs.writeFileSync(file, `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
const folder = a[a.indexOf('--project-folder') + 1];
fs.mkdirSync(path.join(folder, 'app'), { recursive: true });
fs.writeFileSync(path.join(folder, 'app', 'index.html'), ${JSON.stringify(`<h1>Sample ${brand}</h1>`)});
fs.writeFileSync(path.join(folder, 'craft.json'), JSON.stringify({ status: ${JSON.stringify(status)}, stack: 'Plain HTML and CSS', checks: [{ round: 1, passed: true, similarity: 0.9 }] }));
fs.writeFileSync(path.join(folder, 'usage.json'), JSON.stringify({ input_tokens: 400, output_tokens: 100, work_ms: 2000, cost_usd: 0.1 }));
fs.writeFileSync(path.join(folder, 'argv.json'), JSON.stringify(a));
process.exit(${exit});
`, { mode: 0o755 });
  return file;
}
const cliRun = (dir, env, ...args) => spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env }, encoding: 'utf8' });

test('the CLI plans without running anything, and refuses a job that may not use the builder', () => {
  const dir = tmp();
  buildJob(dir);
  const plan = cliRun(dir, {}, 'plan', 'j', '--request', 'A snake game', '--rounds', '1');
  assert.equal(plan.status, 0, plan.stderr);
  const p = JSON.parse(plan.stdout);
  assert.equal(p.mode, 'build');
  assert.ok(p.argv.includes('--unattended'));
  assert.ok(!fs.existsSync(p.folder));
  const denied = cliRun(dir, {}, 'plan', 'j', '--request', 'x', '--allow-run');
  assert.equal(denied.status, 2);
  assert.match(denied.stderr, /runs-generated-code/);
  assert.match(cliRun(dir, {}, 'plan', 'j', '--request', 'x', '--generate-assets').stderr, /spend decision/);
  assert.match(cliRun(dir, {}).stderr, /job id is required/);
  assert.match(cliRun(dir, {}, 'bogus', 'j').stderr, /Unknown command/);
});

test('the CLI reads the request from a file inside the project', () => {
  const dir = tmp();
  buildJob(dir);
  write(dir, 'spec-summary.txt', 'Build a todo list');
  const plan = JSON.parse(cliRun(dir, {}, 'plan', 'j', '--request-file', 'spec-summary.txt').stdout);
  assert.equal(plan.argv[2], 'Build a todo list');
});

test('run: a ready build is recorded on the job, exits 0, and its app can be collected into the repo', () => {
  const dir = tmp();
  buildJob(dir);
  const cli = fakeCli(dir);
  const r = cliRun(dir, { CRAFT_ANYTHING_CLI: cli }, 'run', 'j', '--request', 'A todo list', '--forbid', 'acme');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.outcome.state, 'ready');
  assert.deepEqual(out.forbidden, []);
  const rec = jobs.read(jobs.rootOf(dir), 'j');
  assert.equal(rec.agents.at(-1).agent, 'craft-anything');
  assert.equal(rec.agents.at(-1).ok, true);
  assert.equal(rec.agents.at(-1).tokens, 500);
  const passed = JSON.parse(fs.readFileSync(path.join(out.folder, 'argv.json'), 'utf8'));
  assert.ok(passed.includes('--unattended') && !passed.includes('--allow-run'));
  const outcome = JSON.parse(cliRun(dir, {}, 'outcome', 'j').stdout);
  assert.equal(outcome.outcome.state, 'ready');
  const col = cliRun(dir, {}, 'collect', 'j', '--to', 'examples/todo');
  assert.equal(col.status, 0, col.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'examples', 'todo', 'index.html')));
  assert.match(cliRun(dir, {}, 'collect', 'j').stderr, /--to/);
});

test('run: a forbidden brand term in the output fails the run and is recorded as a failed build', () => {
  const dir = tmp();
  buildJob(dir, { id: 'rb', kind: 'rebuild', source: 'https://acme.example/' });
  const cli = fakeCli(dir, { brand: 'ACME Lessons' });
  const r = cliRun(dir, { CRAFT_ANYTHING_CLI: cli }, 'run', 'rb', '--request', 'Recreate the layout', '--forbid', 'acme');
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.forbidden[0].term, 'acme');
  assert.equal(jobs.read(jobs.rootOf(dir), 'rb').agents.at(-1).ok, false);
});

test('run: a deep rebuild records its reason on the job, and a stopped build exits 1', () => {
  const dir = tmp();
  buildJob(dir, { id: 'd', kind: 'rebuild', source: 'https://example.com/' });
  const cli = fakeCli(dir, { status: 'stopped' });
  const r = cliRun(dir, { CRAFT_ANYTHING_CLI: cli }, 'run', 'd', '--request', 'Study it', '--deep', '--deep-reason', 'owner asked for the flow');
  assert.equal(r.status, 1);
  const rec = jobs.read(jobs.rootOf(dir), 'd');
  assert.ok(rec.history.some((h) => h.event === 'note' && /deep mode.*owner asked for the flow/.test(h.note)));
  assert.equal(rec.agents.at(-1).ok, false);
});

test('run: a missing craft-anything binary is a clear error and nothing is recorded', () => {
  const dir = tmp();
  buildJob(dir);
  const r = cliRun(dir, { CRAFT_ANYTHING_CLI: path.join(dir, 'no-such-cli') }, 'run', 'j', '--request', 'x');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /was not found/);
  assert.equal(jobs.read(jobs.rootOf(dir), 'j').agents.length, 0);
});

test('a note needs text', () => {
  const dir = tmp();
  const { root } = buildJob(dir);
  throwsMsg(() => jobs.recordNote(root, 'j', { note: ' ' }), /needs text/);
  assert.ok(jobs.recordNote(root, 'j', { note: 'ok' }).history.some((h) => h.event === 'note'));
});
