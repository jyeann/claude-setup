'use strict';
// #128 (spec #126): the kickoff choices file, its validator and its plain-language printout.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const k = require('../lib/kickoff');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'kickoff.js');
const TEMPLATE = path.join(ROOT, 'templates', 'kickoff.json');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kickoff-'));
const run = (args, cwd = tmp()) => spawnSync('node', [CLI, ...args], { encoding: 'utf8', cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd } });
const errorsOf = (raw) => k.validate(raw).errors.join('\n');

// The owner's picks, read from the Kickoff Choices page and posted on #126 (2026-11-26).
const OWNER_PICKS = {
  gate_how: 'word', gate1: 'me', gate2: 'me', merge: 'agent_safe', absent: 'absent', halt: 'email',
  standards: 'agent_show', design: 'key', look: 'me', staging: 'yes', uat: 'both', security: 'agent',
};

// --- schema and defaults ---

test('the twelve choice ids match the Kickoff Choices page', () => {
  assert.deepEqual(k.CHOICES.map((c) => c.id), Object.keys(OWNER_PICKS));
});

test('defaults equal the owner picks of 2026-11-26', () => {
  assert.deepEqual(k.DEFAULTS, OWNER_PICKS);
});

test('every default is one of its choice options', () => {
  for (const c of k.CHOICES) assert.ok(Object.hasOwn(c.options, k.DEFAULTS[c.id]), c.id);
});

test('the template file holds exactly the defaults and validates', () => {
  const raw = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
  assert.deepEqual(raw.choices, OWNER_PICKS);
  const r = k.validate(raw);
  assert.equal(r.ok, true, r.errors.join('\n'));
});

test('an empty object reads as the defaults, each marked as a default', () => {
  const r = k.validate({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.choices, OWNER_PICKS);
  assert.ok(Object.values(r.sources).every((s) => s === 'default'));
});

test('a choice set in the file is marked as chosen and overrides the default', () => {
  const r = k.validate({ choices: { merge: 'me', halt: 'list' } });
  assert.equal(r.ok, true);
  assert.equal(r.choices.merge, 'me');
  assert.equal(r.sources.merge, 'file');
  assert.equal(r.sources.gate1, 'default');
});

// --- refusals ---

test('an unknown choice id is refused and named', () => {
  const r = k.validate({ choices: { gate3: 'me' } });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /unknown choice "gate3"/);
});

test('an unknown value is refused, naming the allowed values', () => {
  const msg = errorsOf({ choices: { merge: 'whoever' } });
  assert.match(msg, /merge.*"whoever".*me, agent_safe, agent_all/);
});

test('a value that is not a string is refused', () => {
  assert.match(errorsOf({ choices: { staging: true } }), /staging/);
});

test('an unknown top-level field is refused', () => {
  assert.match(errorsOf({ choices: {}, colour: 'blue' }), /unknown field "colour"/);
});

test('choices that are not an object are refused', () => {
  assert.match(errorsOf({ choices: ['word'] }), /"choices" must be an object/);
});

test('a file that is not an object is refused', () => {
  for (const raw of [null, [], 'word', 3]) assert.equal(k.validate(raw).ok, false);
});

test('a version other than 1 is refused', () => {
  assert.match(errorsOf({ version: 2 }), /version/);
  assert.equal(k.validate({ version: 1 }).ok, true);
});

test('prototype must be true or false', () => {
  assert.match(errorsOf({ prototype: 'yes' }), /prototype/);
});

// --- prototype-only values ---

test('prototype-only values are refused for a product that is not a prototype', () => {
  assert.match(errorsOf({ choices: { merge: 'agent_all' } }), /merge.*agent_all.*prototype/);
  assert.match(errorsOf({ choices: { gate1: 'agent' } }), /gate1.*agent.*prototype/);
});

test('prototype-only values are accepted for a prototype', () => {
  const r = k.validate({ prototype: true, choices: { merge: 'agent_all', gate1: 'agent' } });
  assert.equal(r.ok, true, r.errors.join('\n'));
});

// --- hard limits ---

test('the hard limits are the eight areas of spec #126 item 7', () => {
  assert.deepEqual(k.HARD_LIMITS.map((h) => h.id),
    ['login', 'payments', 'user_data', 'migrations', 'deploy', 'secrets', 'spend', 'legal']);
  assert.ok(Object.isFrozen(k.HARD_LIMITS));
  assert.ok(k.HARD_LIMITS.every((h) => Object.isFrozen(h)));
});

test('every result carries all hard limits, whatever the file says', () => {
  for (const raw of [{}, { prototype: true, choices: { merge: 'agent_all' } }]) {
    const ids = k.validate(raw).hardLimits.map((h) => h.id);
    for (const h of k.HARD_LIMITS) assert.ok(ids.includes(h.id), h.id);
  }
});

test('a field that tries to switch the hard limits off is refused', () => {
  for (const field of ['hardLimits', 'hard_limits', 'limits', 'sensitive', 'exceptions', 'exempt', 'override', 'skipHardLimits', 'allowSensitive']) {
    const r = k.validate({ [field]: [] });
    assert.equal(r.ok, false, field);
    assert.match(r.errors.join('\n'), /hard limits cannot be switched off/, field);
  }
});

test('alsoSensitive adds an area to the hard limits', () => {
  const r = k.validate({ alsoSensitive: ['medical records'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.hardLimits.map((h) => h.id).slice(-1), ['medical records']);
  assert.equal(r.hardLimits.length, k.HARD_LIMITS.length + 1);
});

test('refuses a negated alsoSensitive entry', () => {
  for (const entry of ['!payments', '-payments', 'not payments', 'no secrets', 'except legal', 'without deploy']) {
    const r = k.validate({ alsoSensitive: [entry] });
    assert.equal(r.ok, false, entry);
    assert.match(r.errors.join('\n'), /only add/, entry);
  }
});

test('keeps all hard limits when alsoSensitive is empty', () => {
  const r = k.validate({ alsoSensitive: [] });
  assert.equal(r.ok, true);
  assert.equal(r.hardLimits.length, k.HARD_LIMITS.length);
});

test('an alsoSensitive entry that repeats a hard limit is not listed twice', () => {
  const r = k.validate({ alsoSensitive: ['login', ' Payments ', 'user data'] });
  assert.equal(r.ok, true);
  assert.equal(r.hardLimits.length, k.HARD_LIMITS.length);
});

test('__proto__ and constructor keys are refused and leave every hard limit in place', () => {
  const raws = [
    JSON.parse('{"__proto__": {"hardLimits": []}}'),
    JSON.parse('{"choices": {"__proto__": "me"}}'),
    { choices: { constructor: 'me' } },
    { choices: { merge: 'constructor' } },
    { choices: { merge: '__proto__' } },
  ];
  for (const raw of raws) {
    const r = k.validate(raw);
    assert.equal(r.ok, false, JSON.stringify(raw));
    assert.deepEqual(r.hardLimits.map((h) => h.id), k.HARD_LIMITS.map((h) => h.id));
    assert.deepEqual(r.choices, OWNER_PICKS);
  }
});

test('an invalid file applies none of its choices', () => {
  const r = k.validate({ choices: { gate_how: 'label', merge: 'x' } });
  assert.equal(r.ok, false);
  assert.deepEqual(r.choices, OWNER_PICKS);
  assert.ok(Object.values(r.sources).every((x) => x === 'default'));
});

test('an ordinary unknown field gets the unknown-field message', () => {
  assert.match(errorsOf({ allowedDomains: [] }), /unknown field "allowedDomains"/);
});

test('alsoSensitive must be a list of non-empty strings', () => {
  assert.match(errorsOf({ alsoSensitive: 'payments' }), /alsoSensitive/);
  assert.match(errorsOf({ alsoSensitive: [''] }), /alsoSensitive/);
  assert.match(errorsOf({ alsoSensitive: [3] }), /alsoSensitive/);
});

test('a choice id given as a hard limit is not a way in', () => {
  assert.match(errorsOf({ choices: { hardLimits: 'off' } }), /hard limits cannot be switched off/);
});

// --- enforcement ---

test('every choice and value has an enforcement entry', () => {
  for (const c of k.CHOICES) {
    for (const v of Object.keys(c.options)) {
      const e = k.enforcement(c.id, { ...k.DEFAULTS, [c.id]: v });
      assert.equal(typeof e.enforced, 'boolean', `${c.id}=${v}`);
      assert.ok(e.by.length > 10, `${c.id}=${v}`);
    }
  }
});

test('with the owner picks, the gates, the look and user testing are enforced; the rest is recorded only', () => {
  const enforced = k.CHOICES.filter((c) => k.enforcement(c.id, OWNER_PICKS).enforced).map((c) => c.id);
  assert.deepEqual(enforced, ['gate1', 'gate2', 'look', 'uat']);
});

test('a choice not yet enforced names the ticket that will enforce it', () => {
  for (const id of ['gate_how', 'merge', 'absent', 'halt', 'standards', 'design', 'staging', 'security']) {
    assert.match(k.enforcement(id, OWNER_PICKS).by, /#1\d\d/, id);
  }
});

test('the look is enforced while the owner judges it: at design-approved, or at the spec gate when there is no design gate', () => {
  assert.equal(k.enforcement('look', { ...OWNER_PICKS, gate1: 'agent' }).enforced, true);
  assert.match(k.enforcement('look', OWNER_PICKS).by, /design-approved/);
  assert.equal(k.enforcement('look', { ...OWNER_PICKS, design: 'none' }).enforced, true);
  assert.equal(k.enforcement('look', { ...OWNER_PICKS, design: 'none', gate1: 'agent' }).enforced, false);
  assert.equal(k.enforcement('look', { ...OWNER_PICKS, look: 'agent' }).enforced, false);
});

test('no designed screens is enforced by leaving out the design gate; key or all screens hold the run at it (#149)', () => {
  const none = k.enforcement('design', { ...OWNER_PICKS, design: 'none' });
  assert.equal(none.enforced, true);
  assert.match(none.by, /leaves out the look phase and the design-approved gate/);
  const key = k.enforcement('design', OWNER_PICKS);
  assert.equal(key.enforced, false);
  assert.match(key.by, /design-approved.*#134/);
});

test('user testing by both is enforced only while the owner judges the result', () => {
  assert.equal(k.enforcement('uat', { ...OWNER_PICKS, gate2: 'agent_fix' }).enforced, false);
});

test('the label gate shows its known gap until #146 closes it', () => {
  for (const id of ['gate1', 'gate2']) assert.match(k.enforcement(id, OWNER_PICKS).gap, /MCP.*#146/);
  assert.equal(k.enforcement('merge', OWNER_PICKS).gap, undefined);
  assert.match(k.describe(k.validate({})), /known gap: .*#146/);
});

test('values that only match today\'s behaviour are recorded only, not enforced', () => {
  const picks = { ...OWNER_PICKS, absent: 'reachable', halt: 'list', staging: 'no' };
  for (const id of ['absent', 'halt', 'staging']) {
    const e = k.enforcement(id, picks);
    assert.equal(e.enforced, false, id);
    assert.match(e.by, /no check holds it/, id);
  }
});

test('a label gate is enforced today; a typed word is not yet', () => {
  assert.equal(k.enforcement('gate_how', { ...OWNER_PICKS, gate_how: 'label' }).enforced, true);
  assert.equal(k.enforcement('gate_how', OWNER_PICKS).enforced, false);
});

test('an unknown choice id has no enforcement entry', () => {
  assert.throws(() => k.enforcement('nope', OWNER_PICKS), /unknown choice/);
});

// --- reading the file ---

test('a missing file reads as the defaults and says so', () => {
  const r = k.readKickoff(path.join(tmp(), 'kickoff.json'));
  assert.equal(r.ok, true);
  assert.equal(r.missing, true);
  assert.deepEqual(r.choices, OWNER_PICKS);
});

test('a file that is not JSON is refused', () => {
  const file = path.join(tmp(), 'kickoff.json');
  fs.writeFileSync(file, '{ merge: me ');
  const r = k.readKickoff(file);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /not valid JSON/);
});

test('a valid file is read', () => {
  const file = path.join(tmp(), 'kickoff.json');
  fs.writeFileSync(file, JSON.stringify({ choices: { staging: 'no' } }));
  const r = k.readKickoff(file);
  assert.equal(r.ok, true);
  assert.equal(r.missing, false);
  assert.equal(r.choices.staging, 'no');
});

// --- printout ---

test('the printout names every choice in plain words with its pick and its status', () => {
  const text = k.describe(k.validate({}));
  for (const c of k.CHOICES) {
    assert.ok(text.includes(c.question), c.id);
    assert.ok(text.includes(c.options[OWNER_PICKS[c.id]]), c.id);
  }
  assert.match(text, /enforced/);
  assert.match(text, /recorded only/);
});

test('the printout lists the choices nothing enforces yet, and the hard limits', () => {
  const text = k.describe(k.validate({}));
  const notYet = text.slice(text.indexOf('Not enforced yet'));
  for (const id of ['gate_how', 'merge', 'absent', 'halt', 'standards', 'design', 'staging', 'security']) {
    const c = k.CHOICES.find((x) => x.id === id);
    assert.ok(notYet.includes(c.question), id);
  }
  assert.match(text, /Always stops for the owner/);
  for (const h of k.HARD_LIMITS) assert.ok(text.includes(h.label), h.id);
});

test('the printout says when the defaults were used because there is no file', () => {
  const text = k.describe(k.readKickoff(path.join(tmp(), 'none.json')));
  assert.match(text, /No kickoff file/);
});

test('the printout of an invalid file lists the problems', () => {
  const text = k.describe(k.validate({ choices: { merge: 'x' } }));
  assert.match(text, /not valid/);
  assert.match(text, /merge/);
});

test('the printout shows added sensitive areas with the hard limits', () => {
  assert.match(k.describe(k.validate({ alsoSensitive: ['medical records'] })), /medical records/);
});

// --- command ---

test('the command prints the defaults when there is no file', () => {
  const r = run([]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /No kickoff file/);
  assert.match(r.stdout, /Not enforced yet/);
});

test('the command reads --docs <dir>/kickoff.json', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'kickoff.json'), JSON.stringify({ choices: { merge: 'me' } }));
  const r = run(['--docs', dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /The owner, each one/);
});

test('the command reads --file and exits 1 on an invalid file', () => {
  const file = path.join(tmp(), 'k.json');
  fs.writeFileSync(file, JSON.stringify({ hardLimits: [] }));
  const r = run(['--file', file]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /hard limits cannot be switched off/);
});

test('the command prints JSON with --json', () => {
  const r = run(['--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.choices, OWNER_PICKS);
  assert.deepEqual(out.notEnforced, ['gate_how', 'merge', 'absent', 'halt', 'standards', 'design', 'staging', 'security']);
});

test('the command refuses --docs with --file, even an empty one, and a repeated flag', () => {
  assert.equal(run(['--docs', '', '--file', 'x.json']).status, 2);
  assert.equal(run(['--docs', 'a', '--docs', 'b']).status, 2);
});

test('the command refuses an unknown argument', () => {
  const r = run(['--nope']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});
