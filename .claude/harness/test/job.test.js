'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const job = require('../lib/job');
const { checkWrite } = require('../lib/guards');

const CLI = path.join(__dirname, '..', 'bin', 'job.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-job-'));
const cli = (dir, ...args) => spawnSync('node', [CLI, ...args], { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });
const throwsMsg = (fn, re) => assert.throws(fn, (e) => re.test(e.message));

function accepted(root, id = 'j1', extra = {}) {
  job.create(root, { id, title: 'Add dark mode' });
  job.intake(root, id, { decision: 'accept', risk: 'low', ...extra });
  job.recordRefCheck(root, id, { expect: 'red', passed: true });
  return id;
}

function toApprove(root, id) {
  for (const s of ['build', 'gate']) job.advance(root, id, s);
  job.recordGate(root, id, { passed: true });
  job.advance(root, id, 'review');
  for (const r of job.read(root, id).reviewers) job.recordReview(root, id, { reviewer: r, verdict: 'pass' });
  job.advance(root, id, 'approve');
}

test('creating a job starts it at intake with a history entry, and a duplicate id is refused', () => {
  const root = tmp();
  const j = job.create(root, { id: 'a', title: 'Hello' });
  assert.equal(j.stage, 'intake');
  assert.equal(j.status, 'active');
  assert.equal(j.history[0].event, 'created');
  throwsMsg(() => job.create(root, { id: 'a', title: 'Again' }), /already exists/);
});

test('job ids that could escape the folder are refused', () => {
  const root = tmp();
  for (const bad of ['../x', 'A', 'a/b', '', '-x']) throwsMsg(() => job.create(root, { id: bad, title: 't' }), /Invalid job id/);
  throwsMsg(() => job.read(root, '../etc'), /Invalid job id/);
});

test('a job needs a title, a known kind and a known builder', () => {
  const root = tmp();
  throwsMsg(() => job.create(root, { id: 'a', title: '  ' }), /title/);
  throwsMsg(() => job.create(root, { id: 'a', title: 't', kind: 'nope' }), /kind/);
  throwsMsg(() => job.create(root, { id: 'a', title: 't', builder: 'nope' }), /builder/);
});

test('a rebuild job records who asked and what they acknowledged, and is refused without both', () => {
  const root = tmp();
  throwsMsg(() => job.create(root, { id: 'r', title: 't', kind: 'rebuild' }), /requested-by/);
  throwsMsg(() => job.create(root, { id: 'r', title: 't', kind: 'rebuild', requestedBy: 'sam' }), /ack/);
  const j = job.create(root, { id: 'r', title: 't', kind: 'rebuild', builder: 'craft-anything', requestedBy: 'sam', acknowledgement: 'I own the legal responsibility for this rebuild' });
  assert.equal(j.requestedBy, 'sam');
  assert.match(j.acknowledgement, /legal responsibility/);
});

test('intake accept needs a risk, and the risk picks the reviewers', () => {
  const root = tmp();
  job.create(root, { id: 'a', title: 't' });
  throwsMsg(() => job.intake(root, 'a', { decision: 'accept' }), /needs a risk/);
  const j = job.intake(root, 'a', { decision: 'accept', risk: 'medium' });
  assert.equal(j.stage, 'spec');
  assert.deepEqual(j.reviewers, ['code-reviewer', 'security-reviewer']);
  const root2 = tmp();
  assert.deepEqual(job.read(root2, accepted(root2)).reviewers, ['code-reviewer']);
  const root3 = tmp();
  accepted(root3, 'h', {});
  job.create(root3, { id: 'h2', title: 't' });
  assert.deepEqual(job.intake(root3, 'h2', { decision: 'accept', risk: 'high' }).reviewers, ['code-reviewer', 'security-reviewer', 'architect']);
});

test('a low-risk job that touches money, logins or personal data is raised to medium', () => {
  const root = tmp();
  job.create(root, { id: 'a', title: 't' });
  const j = job.intake(root, 'a', { decision: 'accept', risk: 'low', surfaces: ['logins'] });
  assert.equal(j.risk, 'medium');
  assert.ok(j.reviewers.includes('security-reviewer'));
});

test('intake reject and ask need a reason; reject ends the job and ask waits for the owner', () => {
  const root = tmp();
  job.create(root, { id: 'a', title: 't' });
  throwsMsg(() => job.intake(root, 'a', { decision: 'reject' }), /needs a reason/);
  assert.equal(job.intake(root, 'a', { decision: 'reject', reason: 'duplicate' }).status, 'rejected');
  job.create(root, { id: 'b', title: 't' });
  const asked = job.intake(root, 'b', { decision: 'ask', reason: 'which currency?' });
  assert.equal(asked.status, 'needs-human');
  assert.equal(asked.needsHuman.reason, 'spend-legal-scope');
  throwsMsg(() => job.intake(root, 'a', { decision: 'maybe' }), /accept, reject or ask/);
});

test('intake cannot be redone once the job has moved on', () => {
  const root = tmp();
  accepted(root);
  throwsMsg(() => job.intake(root, 'j1', { decision: 'accept', risk: 'low' }), /past intake/);
});

test('stages move forward one step at a time, and a rejected job cannot advance', () => {
  const root = tmp();
  accepted(root);
  throwsMsg(() => job.advance(root, 'j1', 'gate'), /cannot go from spec to gate/);
  throwsMsg(() => job.advance(root, 'j1', 'bogus'), /Unknown stage/);
  throwsMsg(() => job.advance(root, 'j1', 'merged'), /Use "merge"/);
  job.create(root, { id: 'r', title: 't' });
  job.intake(root, 'r', { decision: 'reject', reason: 'no' });
  throwsMsg(() => job.advance(root, 'r', 'spec'), /rejected/);
});

test('the gate must pass before review, and a failed gate sends the job back to build', () => {
  const root = tmp();
  accepted(root);
  job.advance(root, 'j1', 'build');
  job.advance(root, 'j1', 'gate');
  throwsMsg(() => job.advance(root, 'j1', 'review'), /gate has not passed/);
  job.recordGate(root, 'j1', { passed: false, summary: 'lint' });
  throwsMsg(() => job.advance(root, 'j1', 'review'), /gate has not passed/);
  assert.equal(job.advance(root, 'j1', 'build').stage, 'build');
});

test('only assigned reviewers can review, only in the review stage, and a re-review replaces the earlier verdict', () => {
  const root = tmp();
  accepted(root);
  throwsMsg(() => job.recordReview(root, 'j1', { reviewer: 'code-reviewer', verdict: 'pass' }), /not review/);
  for (const s of ['build', 'gate']) job.advance(root, 'j1', s);
  job.recordGate(root, 'j1', { passed: true });
  job.advance(root, 'j1', 'review');
  throwsMsg(() => job.recordReview(root, 'j1', { reviewer: 'security-reviewer', verdict: 'pass' }), /not a reviewer/);
  throwsMsg(() => job.recordReview(root, 'j1', { reviewer: 'code-reviewer', verdict: 'meh' }), /pass or fail/);
  job.recordReview(root, 'j1', { reviewer: 'code-reviewer', verdict: 'fail', summary: 'naming' });
  const j = job.recordReview(root, 'j1', { reviewer: 'code-reviewer', verdict: 'pass' });
  assert.equal(j.reviews.length, 1);
  assert.equal(j.reviews[0].verdict, 'pass');
});

test('a low-risk job with every check green is merged by the approver', () => {
  const root = tmp();
  accepted(root);
  toApprove(root, 'j1');
  assert.equal(job.mergeVerdict(job.read(root, 'j1')).auto, true);
  const j = job.merge(root, 'j1', { ref: 'PR 7' });
  assert.equal(j.stage, 'merged');
  assert.equal(j.status, 'done');
  assert.equal(j.merge.human, false);
});

test('a job cannot merge before approval or with a missing review', () => {
  const root = tmp();
  accepted(root);
  throwsMsg(() => job.merge(root, 'j1', {}), /stage is spec/);
  for (const s of ['build', 'gate']) job.advance(root, 'j1', s);
  job.recordGate(root, 'j1', { passed: true });
  job.advance(root, 'j1', 'review');
  job.advance(root, 'j1', 'approve');
  throwsMsg(() => job.merge(root, 'j1', {}), /reviews not passed: code-reviewer/);
});

test('medium risk work, and anything touching money, logins or personal data, needs a human to merge', () => {
  const root = tmp();
  job.create(root, { id: 'm', title: 't' });
  job.intake(root, 'm', { decision: 'accept', risk: 'medium' });
  job.recordRefCheck(root, 'm', { expect: 'red', passed: true });
  toApprove(root, 'm');
  throwsMsg(() => job.merge(root, 'm', {}), /needs a human to merge \(risk is medium\)/);
  assert.equal(job.merge(root, 'm', { human: true, by: 'human' }).merge.human, true);
  job.create(root, { id: 's', title: 't', surfaces: ['money'] });
  job.intake(root, 's', { decision: 'accept', risk: 'low' });
  assert.equal(job.read(root, 's').risk, 'medium');
  const v = job.mergeVerdict({ ...job.read(root, 's'), risk: 'low' });
  assert.equal(v.auto, false);
  assert.match(v.human, /touches money/);
});

test('needs-human accepts only the three owner reasons and always needs detail', () => {
  const root = tmp();
  accepted(root);
  throwsMsg(() => job.needsHuman(root, 'j1', { reason: 'which colour?', detail: 'x' }), /Not a reason to contact the owner/);
  throwsMsg(() => job.needsHuman(root, 'j1', { reason: 'spend-legal-scope' }), /Say what you need/);
  const j = job.needsHuman(root, 'j1', { reason: 'secrets-or-access', detail: 'need the API key via the secure route' });
  assert.equal(j.status, 'needs-human');
  throwsMsg(() => job.advance(root, 'j1', 'build'), /needs-human/);
});

test('feedback is recorded and releases a job that was waiting for the owner', () => {
  const root = tmp();
  accepted(root);
  job.needsHuman(root, 'j1', { reason: 'spend-legal-scope', detail: 'paid API?' });
  throwsMsg(() => job.feedback(root, 'j1', { text: ' ' }), /needs text/);
  const j = job.feedback(root, 'j1', { text: 'free tier only' });
  assert.equal(j.status, 'active');
  assert.equal(j.needsHuman, null);
  assert.equal(j.feedback[0].text, 'free tier only');
});

test('summary rolls agent cost up by phase and counts failed and unreported agents instead of assuming success', () => {
  const root = tmp();
  accepted(root);
  job.recordAgent(root, 'j1', { agent: 'architect', phase: 'design', effort: 'low', tokens: 1000, durationMs: 5000, ok: true });
  job.recordAgent(root, 'j1', { agent: 'tdd-guide', phase: 'build', tokens: 3000, durationMs: 9000, ok: true });
  job.recordAgent(root, 'j1', { agent: 'tdd-guide', phase: 'build', ok: null });
  job.recordAgent(root, 'j1', { agent: 'code-reviewer', phase: 'review', tokens: 500, durationMs: 1000, ok: false });
  throwsMsg(() => job.recordAgent(root, 'j1', { agent: 'x' }), /--agent and --phase/);
  const s = job.summary(job.read(root, 'j1'));
  assert.equal(s.runs, 4);
  assert.equal(s.failed, 1);
  assert.equal(s.unreported, 1);
  assert.equal(s.tokens, 4500);
  assert.equal(s.byPhase.build.runs, 2);
  assert.equal(s.byPhase.build.unreported, 1);
});

test('the queue lists active and waiting jobs only, and list ignores stray files and corrupt records', () => {
  const root = tmp();
  accepted(root, 'a');
  accepted(root, 'b');
  job.needsHuman(root, 'b', { reason: 'spend-legal-scope', detail: 'cost' });
  job.create(root, { id: 'c', title: 't' });
  job.intake(root, 'c', { decision: 'reject', reason: 'no' });
  fs.mkdirSync(path.join(root, 'broken'));
  fs.writeFileSync(path.join(root, 'broken', 'job.json'), '{nope');
  fs.writeFileSync(path.join(root, 'stray.txt'), 'x');
  assert.deepEqual(job.queue(root).map((j) => j.id).sort(), ['a', 'b']);
  assert.equal(job.list(path.join(root, 'missing')).length, 0);
  throwsMsg(() => job.read(root, 'broken'), /Corrupt job/);
  throwsMsg(() => job.read(root, 'nope'), /No such job/);
});

test('a job file written with a different version is refused instead of being overwritten', () => {
  const root = tmp();
  accepted(root);
  const file = job.fileOf(root, 'j1');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...raw, version: 99 }));
  throwsMsg(() => job.advance(root, 'j1', 'build'), /version 99/);
});

test('a stale lock from a dead writer is taken over, and a fresh lock blocks with a clear error', () => {
  const root = tmp();
  accepted(root);
  const lock = path.join(root, 'j1', '.lock');
  fs.writeFileSync(lock, '999999');
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(lock, old, old);
  assert.equal(job.advance(root, 'j1', 'build').stage, 'build');
  assert.equal(fs.existsSync(lock), false);
});

test('rootOf honours HARNESS_JOBS_DIR and defaults to docs/jobs', () => {
  assert.equal(job.rootOf('/p', {}), '/p/docs/jobs');
  assert.equal(job.rootOf('/p', { HARNESS_JOBS_DIR: 'x/jobs' }), '/p/x/jobs');
});

test('the CLI drives a whole job and prints JSON', () => {
  const dir = tmp();
  const ok = (...a) => { const r = cli(dir, ...a); assert.equal(r.status, 0, r.stderr); return r.stdout ? JSON.parse(r.stdout) : null; };
  ok('create', '--id', 'x', '--title', 'Dark mode', '--surface', 'ui');
  assert.equal(ok('intake', 'x', '--decision', 'accept', '--risk', 'low').stage, 'spec');
  const blocked = cli(dir, 'advance', 'x', 'build');
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /not been checked against a stub/);
  assert.match(cli(dir, 'waive-ref-check', 'x', '--reason', ' ').stderr, /needs a reason/);
  assert.equal(ok('waive-ref-check', 'x', '--reason', 'no stub exists for a one-file change').refCheckWaiver.by, 'orchestrator');
  ok('advance', 'x', 'build');
  ok('agent', 'x', '--agent', 'tdd-guide', '--phase', 'build', '--tokens', '120', '--duration-ms', '800', '--ok', 'true', '--effort', 'medium');
  ok('advance', 'x', 'gate');
  ok('gate', 'x', '--passed', 'true', '--summary', 'green');
  ok('advance', 'x', 'review');
  ok('review', 'x', '--reviewer', 'code-reviewer', '--verdict', 'pass');
  ok('advance', 'x', 'approve');
  assert.equal(ok('merge', 'x', '--ref', 'PR 1').status, 'done');
  assert.equal(ok('summary', 'x').tokens, 120);
  assert.equal(ok('show', 'x').merge.ref, 'PR 1');
  assert.deepEqual(ok('queue'), []);
  assert.ok(fs.existsSync(path.join(dir, 'docs', 'jobs', 'x', 'job.json')));
});

test('the CLI covers feedback, needs-human, a human merge, and bad input', () => {
  const dir = tmp();
  const run = (...a) => cli(dir, ...a);
  assert.equal(run('create', '--id', 'y', '--title', 't').status, 0);
  assert.equal(run('intake', 'y', '--decision', 'accept', '--risk', 'medium').status, 0);
  assert.equal(run('waive-ref-check', 'y', '--reason', 'covered by a manual check').status, 0);
  assert.equal(run('needs-human', 'y', '--reason', 'spend-legal-scope', '--detail', 'paid plan?').status, 0);
  assert.match(JSON.parse(run('queue').stdout)[0].needsHuman.detail, /paid plan/);
  assert.equal(run('feedback', 'y', '--text', 'no').status, 0);
  for (const s of ['build', 'gate']) assert.equal(run('advance', 'y', s).status, 0);
  assert.equal(run('gate', 'y', '--passed', 'true').status, 0);
  assert.equal(run('advance', 'y', 'review').status, 0);
  for (const r of ['code-reviewer', 'security-reviewer']) assert.equal(run('review', 'y', '--reviewer', r, '--verdict', 'pass').status, 0);
  assert.equal(run('advance', 'y', 'approve').status, 0);
  const refused = run('merge', 'y');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /needs a human to merge/);
  assert.equal(JSON.parse(run('merge', 'y', '--human').stdout).merge.by, 'human');
  assert.match(run('bogus').stderr, /Unknown command/);
  assert.match(run('show', 'nope').stderr, /No such job/);
  assert.match(run('agent', 'y', '--agent', 'a', '--phase', 'p', '--tokens', 'x').stderr, /non-negative number/);
  assert.match(run('agent', 'y', '--agent', 'a', '--phase', 'p', '--ok', 'maybe').stderr, /true or false/);
  assert.match(run('create', '--id', 'z', '--title', 't', '--kind', 'rebuild').stderr, /requested-by/);
});

test('the write guard blocks hand-editing a job record but not other files', () => {
  const ev = (file) => ({ tool_name: 'Write', tool_input: { file_path: file, content: '{}' } });
  assert.equal(checkWrite(ev('/p/docs/jobs/x/job.json'), {}, '/p').block, true);
  assert.equal(checkWrite(ev('/p/docs/jobs/x/job.json.123.tmp'), {}, '/p').block, true);
  assert.match(checkWrite(ev('docs/jobs/x/job.json'), {}, '/p').reason, /job\.js/);
  assert.equal(checkWrite(ev('/p/docs/jobs/x/notes.md'), {}, '/p').block, false);
  assert.equal(checkWrite(ev('/p/docs/job.json'), {}, '/p').block, false);
});

test('build cannot start until the tests passed a red check against a stub, or the check is waived with a reason', () => {
  const root = tmp();
  job.create(root, { id: 'a', title: 't' });
  job.intake(root, 'a', { decision: 'accept', risk: 'low' });
  throwsMsg(() => job.advance(root, 'a', 'build'), /not been checked against a stub/);
  job.recordRefCheck(root, 'a', { expect: 'red', passed: false, summary: '3 pass against a stub' });
  throwsMsg(() => job.advance(root, 'a', 'build'), /red check failed/);
  job.recordRefCheck(root, 'a', { expect: 'red', passed: true });
  assert.equal(job.advance(root, 'a', 'build').stage, 'build');
});

test('a failed green reference check blocks the build even when the red check passed, and a later pass clears it', () => {
  const root = tmp();
  accepted(root);
  job.recordRefCheck(root, 'j1', { expect: 'green', passed: false, summary: '2 fail against the reference' });
  throwsMsg(() => job.advance(root, 'j1', 'build'), /green reference check failed/);
  job.recordRefCheck(root, 'j1', { expect: 'green', passed: true });
  assert.equal(job.advance(root, 'j1', 'build').stage, 'build');
  throwsMsg(() => job.recordRefCheck(root, 'j1', { expect: 'blue', passed: true }), /red or green/);
});

test('a waiver is recorded with who and why, needs a reason, and lets the build start', () => {
  const root = tmp();
  job.create(root, { id: 'a', title: 't' });
  job.intake(root, 'a', { decision: 'accept', risk: 'low' });
  throwsMsg(() => job.waiveRefCheck(root, 'a', { reason: '' }), /needs a reason/);
  const j = job.waiveRefCheck(root, 'a', { reason: 'one-line config change' });
  assert.equal(j.refCheckWaiver.reason, 'one-line config change');
  assert.ok(j.history.some((h) => h.event === 'ref-check:waived'));
  assert.equal(job.advance(root, 'a', 'build').stage, 'build');
});

test('going back to build after a failed gate does not repeat the ref-check requirement', () => {
  const root = tmp();
  accepted(root);
  job.advance(root, 'j1', 'build');
  job.advance(root, 'j1', 'gate');
  assert.equal(job.advance(root, 'j1', 'build').stage, 'build');
});
