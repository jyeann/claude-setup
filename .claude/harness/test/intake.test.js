'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const intake = require('../lib/intake');
const job = require('../lib/job');

const CLI = path.join(__dirname, '..', 'bin', 'job.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-intake-'));
const throwsMsg = (fn, re) => assert.throws(fn, (e) => re.test(e.message));

test('a verdict file is parsed into decision, risk, surfaces and reason, with a multi-line reason joined', () => {
  const v = intake.parseIntake('DECISION: accept\nRISK: Medium\nSURFACES: ui, Logins\nREASON: Adds sign-in.\n  Needs care with sessions.\n');
  assert.deepEqual(v, { decision: 'accept', risk: 'medium', surfaces: ['ui', 'logins'], reason: 'Adds sign-in. Needs care with sessions.' });
});

test('surfaces may be empty, and duplicates collapse', () => {
  assert.deepEqual(intake.parseIntake('DECISION: accept\nRISK: low\nSURFACES:\nREASON: tiny').surfaces, []);
  assert.deepEqual(intake.parseIntake('DECISION: accept\nRISK: low\nSURFACES: ui ui api').surfaces, ['ui', 'api']);
});

test('a malformed verdict is an error, never a guess', () => {
  throwsMsg(() => intake.parseIntake(''), /needs "DECISION/);
  throwsMsg(() => intake.parseIntake('DECISION: maybe'), /needs "DECISION/);
  throwsMsg(() => intake.parseIntake('DECISION: accept'), /needs "RISK/);
  throwsMsg(() => intake.parseIntake('DECISION: accept\nRISK: severe'), /needs "RISK/);
  throwsMsg(() => intake.parseIntake('DECISION: reject\nRISK: severe\nREASON: x'), /Unknown risk/);
  throwsMsg(() => intake.parseIntake('DECISION: reject'), /needs a REASON/);
  throwsMsg(() => intake.parseIntake('DECISION: ask'), /needs a REASON/);
  throwsMsg(() => intake.parseIntake('DECISION: accept\nDECISION: reject'), /two DECISION lines/);
  throwsMsg(() => intake.parseIntake('DECISION: accept\nRISK: low\nSURFACES: ui, bank'), /Unknown surface\(s\): bank/);
});

test('reject and ask verdicts parse without a risk', () => {
  assert.deepEqual(intake.parseIntake('DECISION: reject\nREASON: duplicate of job x'), { decision: 'reject', risk: null, surfaces: [], reason: 'duplicate of job x' });
  assert.equal(intake.parseIntake('DECISION: ask\nREASON: paid API?').decision, 'ask');
});

test('risk floors: sensitive, egress, generated code and third-party content are never below medium; two sensitive are high', () => {
  assert.equal(intake.riskFloor([]).risk, 'low');
  assert.equal(intake.riskFloor(['ui', 'api', 'data-store']).risk, 'low');
  for (const s of ['money', 'logins', 'personal-data', 'network-egress', 'runs-generated-code', 'third-party-content']) {
    assert.equal(intake.riskFloor([s]).risk, 'medium', s);
  }
  assert.equal(intake.riskFloor(['logins', 'personal-data']).risk, 'high');
  assert.match(intake.riskFloor(['money', 'logins']).why, /money and logins together/);
  assert.equal(intake.riskFloor([], 'rebuild').risk, 'medium');
});

test('resolveRisk keeps a higher tag and raises a lower one, saying why', () => {
  assert.deepEqual(intake.resolveRisk('high', ['ui'], 'build'), { risk: 'high', raisedBy: null });
  assert.deepEqual(intake.resolveRisk('low', ['ui'], 'build'), { risk: 'low', raisedBy: null });
  const raised = intake.resolveRisk('low', ['network-egress'], 'build');
  assert.equal(raised.risk, 'medium');
  assert.match(raised.raisedBy, /network-egress.*tagged low, raised to medium/);
  assert.equal(intake.resolveRisk('medium', ['money', 'logins'], 'build').risk, 'high');
});

test('reviewers follow the risk and the surfaces: a screen gets the accessibility reviewer at any risk', () => {
  assert.deepEqual(intake.reviewersFor('low', []), ['code-reviewer']);
  assert.deepEqual(intake.reviewersFor('low', ['ui']), ['code-reviewer', 'a11y-architect']);
  assert.deepEqual(intake.reviewersFor('medium', ['ui']), ['code-reviewer', 'security-reviewer', 'a11y-architect']);
  assert.deepEqual(intake.reviewersFor('high', []), ['code-reviewer', 'security-reviewer', 'architect']);
  assert.ok(intake.reviewersFor('low', ['runs-generated-code']).includes('security-reviewer'));
});

test('job intake applies the floor, records why, and assigns reviewers from risk and surfaces', () => {
  const root = tmp();
  job.create(root, { id: 'a', title: 't' });
  const j = job.intake(root, 'a', { decision: 'accept', risk: 'low', surfaces: ['ui', 'network-egress'] });
  assert.equal(j.risk, 'medium');
  assert.match(j.riskRaisedBy, /network-egress/);
  assert.deepEqual(j.reviewers, ['code-reviewer', 'security-reviewer', 'a11y-architect']);
  job.create(root, { id: 'b', title: 't' });
  assert.equal(job.intake(root, 'b', { decision: 'accept', risk: 'low', surfaces: ['ui'] }).riskRaisedBy, null);
  job.create(root, { id: 'c', title: 't' });
  throwsMsg(() => job.intake(root, 'c', { decision: 'accept', risk: 'low', surfaces: ['bank'] }), /Unknown surface/);
});

test('a rebuild job is never tagged below medium', () => {
  const root = tmp();
  job.create(root, { id: 'r', title: 't', kind: 'rebuild', requestedBy: 'sam', acknowledgement: 'I own the legal side' });
  const j = job.intake(root, 'r', { decision: 'accept', risk: 'low' });
  assert.equal(j.risk, 'medium');
  assert.match(j.riskRaisedBy, /rebuild/);
});

test('the CLI reads the verdict file the intake agent wrote and rejects an invalid one without changing the job', () => {
  const dir = tmp();
  const run = (...a) => spawnSync('node', [CLI, ...a], { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });
  assert.equal(run('create', '--id', 'x', '--title', 'Sign in', '--surface', 'logins').status, 0);
  fs.writeFileSync(path.join(dir, 'bad.md'), 'DECISION: accept\nRISK: low\nSURFACES: ui, bank\n');
  const bad = run('intake', 'x', '--from', 'bad.md');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Unknown surface/);
  assert.equal(JSON.parse(run('show', 'x').stdout).stage, 'intake');
  fs.writeFileSync(path.join(dir, 'ok.md'), 'DECISION: accept\nRISK: low\nSURFACES: ui\nREASON: Adds sign-in.\n');
  const ok = JSON.parse(run('intake', 'x', '--from', 'ok.md').stdout);
  assert.equal(ok.risk, 'medium');
  assert.deepEqual(ok.surfaces, ['logins', 'ui']);
  assert.equal(ok.stage, 'spec');
  assert.match(run('intake', 'x', '--from', 'missing.md').stderr, /ENOENT/);
});
