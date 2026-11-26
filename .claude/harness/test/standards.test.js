'use strict';
// The build standards catalogue (#136, spec #127): the format of a standard, the checker, and the first layers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  STANDARDS_DIR, REPO_ROOT, LAYER_KINDS, TEST_KINDS, SOURCE_KINDS,
  loadStandards, validateLayer, validateCatalogue, sourceProblems,
} = require('../lib/standards');

const BIN = path.join(__dirname, '..', 'bin', 'check-standards.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'standards-'));

const standard = (over = {}) => ({
  id: 'demo.thing',
  layer: 'demo',
  topic: 'login',
  title: 'A thing',
  mustBeTrue: 'The thing is true.',
  test: { kind: 'unit', how: 'A test asserts the thing.' },
  why: 'Because.',
  sources: [{ kind: 'asvs', ref: '6.2.1' }],
  ...over,
});
const layerDoc = (standards = [standard()], over = {}) => ({
  layer: { id: 'demo', kind: 'capability', title: 'Demo', appliesWhen: 'Always.', topics: ['login'], ...over },
  standards,
});
const problemsOf = (doc) => validateLayer(doc, { file: 'demo.json' });

// ---- the format

test('a well-formed layer has no problems', () => {
  assert.deepEqual(problemsOf(layerDoc()), []);
});

test('a standard missing any field is refused, naming the field', () => {
  for (const field of ['layer', 'topic', 'title', 'mustBeTrue', 'test', 'why', 'sources']) {
    const s = standard();
    delete s[field];
    assert.match(problemsOf(layerDoc([s])).join('\n'), new RegExp(`demo\\.thing: missing ${field}`), field);
  }
  assert.match(problemsOf(layerDoc([standard({ id: '' })])).join('\n'), /standard 1: missing id/);
  assert.match(problemsOf(layerDoc([standard({ why: '  ' })])).join('\n'), /missing why/);
});

test('a standard with no source is refused', () => {
  assert.match(problemsOf(layerDoc([standard({ sources: [] })])).join('\n'), /demo\.thing: has no source/);
  assert.match(problemsOf(layerDoc([standard({ sources: 'ASVS' })])).join('\n'), /has no source/);
});

test('ids carry their layer, are unique, and match the standard\'s layer and a declared topic', () => {
  assert.match(problemsOf(layerDoc([standard({ id: 'other.thing' })])).join('\n'), /id must be "demo\.<lower-case-words>"/);
  assert.match(problemsOf(layerDoc([standard({ id: 'demo.Thing' })])).join('\n'), /id must be/);
  assert.match(problemsOf(layerDoc([standard(), standard()])).join('\n'), /demo\.thing: id is listed twice/);
  assert.match(problemsOf(layerDoc([standard({ layer: 'other' })])).join('\n'), /layer "other" is not this file's layer "demo"/);
  assert.match(problemsOf(layerDoc([standard({ topic: 'payments' })])).join('\n'), /topic "payments" is not declared by layer demo \(login\)/);
});

test('an unknown test kind or a test without "how" is refused', () => {
  assert.match(problemsOf(layerDoc([standard({ test: { kind: 'vibes', how: 'x' } })])).join('\n'), /test kind "vibes" is not one of unit, integration, e2e, config, scan, review/);
  assert.match(problemsOf(layerDoc([standard({ test: { kind: 'e2e' } })])).join('\n'), /test has no "how"/);
  assert.deepEqual(TEST_KINDS, ['unit', 'integration', 'e2e', 'config', 'scan', 'review']);
});

test('the layer block needs an id, a known kind, a title, when it applies, topics and standards', () => {
  assert.deepEqual(validateLayer({}, { file: 'x.json' }), ['x.json: has no "layer" block']);
  const bad = problemsOf({ layer: { id: 'Bad Id', kind: 'misc', topics: [] }, standards: [] }).join('\n');
  assert.match(bad, /id "Bad Id" is not lower-case words/);
  assert.match(bad, /kind "misc" is not one of every-product, capability, product-kind, domain, implementation/);
  assert.match(bad, /layer: has no title/);
  assert.match(bad, /layer: has no appliesWhen/);
  assert.match(bad, /declares no topics/);
  assert.match(bad, /lists no standards/);
  assert.deepEqual(LAYER_KINDS, ['every-product', 'capability', 'product-kind', 'domain', 'implementation']);
});

test('every declared topic has a standard or is listed as a gap with a reason', () => {
  const two = (gaps) => ({ ...layerDoc([standard()], { topics: ['login', 'backups'] }), gaps });
  assert.match(problemsOf(two(undefined)).join('\n'), /topic "backups" has no standard and is not listed as a gap/);
  assert.deepEqual(problemsOf(two([{ topic: 'backups', reason: 'no public source yet' }])), []);
  assert.match(problemsOf(two([{ topic: 'backups' }])).join('\n'), /each gap needs a topic and a reason/);
});

test('wrongly shaped JSON is reported, never a crash', () => {
  assert.deepEqual(validateLayer({ layer: { id: 5 } }, { file: 'x.json' }), ['x.json: layer: has no id']);
  assert.match(problemsOf({ ...layerDoc(), standards: { a: 1 } }).join('\n'), /standards is not a list/);
  assert.match(problemsOf({ ...layerDoc(), gaps: 'x' }).join('\n'), /gaps: gaps is not a list/);
  assert.match(problemsOf(layerDoc([null])).join('\n'), /standard 1: missing id/);
  assert.match(problemsOf(layerDoc([standard({ topic: 1 })], { topics: [1] })).join('\n'), /topic 1 is not lower-case words/);
  assert.match(problemsOf(layerDoc([standard()], { topics: ['login', 'login'] })).join('\n'), /declares a topic twice/);
  assert.deepEqual(validateCatalogue([{ file: 'x.json', doc: { layer: { id: {} }, standards: {} } }]).counts, {});
});

// ---- sources the checker can verify

test('source kinds are the five the checker can verify', () => {
  assert.deepEqual(SOURCE_KINDS, ['asvs', 'owasp-cheatsheet', 'wcag', 'repo', 'issue']);
  assert.deepEqual(sourceProblems(null, REPO_ROOT), ['a source is not an object']);
  assert.match(sourceProblems({ kind: 'blog', ref: 'x' }, REPO_ROOT)[0], /source kind "blog" is not one of/);
  assert.match(sourceProblems({ kind: 'asvs' }, REPO_ROOT)[0], /asvs source has no ref/);
});

test('ASVS and WCAG refs must be numbered ids', () => {
  assert.deepEqual(sourceProblems({ kind: 'asvs', ref: '6.2.12' }, REPO_ROOT), []);
  assert.match(sourceProblems({ kind: 'asvs', ref: 'V6.2' }, REPO_ROOT)[0], /ASVS ref "V6\.2" is not a requirement id like 6\.2\.1 \(OWASP ASVS 5\.0\.0\)/);
  assert.deepEqual(sourceProblems({ kind: 'wcag', ref: '2.5.8' }, REPO_ROOT), []);
  assert.match(sourceProblems({ kind: 'wcag', ref: 'SC 2.5.8' }, REPO_ROOT)[0], /WCAG ref "SC 2\.5\.8" is not a success criterion like 2\.5\.8 \(WCAG 2\.2\)/);
});

test('a cheat sheet source must link to the OWASP cheat sheet site', () => {
  const ok = { kind: 'owasp-cheatsheet', ref: 'Forgot Password', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html' };
  assert.deepEqual(sourceProblems(ok, REPO_ROOT), []);
  assert.deepEqual(sourceProblems({ ...ok, url: `${ok.url}#url-tokens` }, REPO_ROOT), []);
  assert.match(sourceProblems({ ...ok, url: 'https://example.com/Forgot_Password_Cheat_Sheet.html' }, REPO_ROOT)[0], /needs a url on https:\/\/cheatsheetseries\.owasp\.org\/cheatsheets\//);
  assert.match(sourceProblems({ kind: 'owasp-cheatsheet', ref: 'x' }, REPO_ROOT)[0], /needs a url/);
});

test('an issue source must be an issue number in this repository', () => {
  assert.deepEqual(sourceProblems({ kind: 'issue', ref: '#127' }, REPO_ROOT), []);
  assert.match(sourceProblems({ kind: 'issue', ref: 'gachi-market#4' }, REPO_ROOT)[0], /issue ref "gachi-market#4" is not like #127/);
});

test('a repository source must name a file that exists, and a heading in it when a section is given', () => {
  const skill = '.claude/skills/security-review/SKILL.md';
  assert.deepEqual(sourceProblems({ kind: 'repo', ref: skill }, REPO_ROOT), []);
  assert.deepEqual(sourceProblems({ kind: 'repo', ref: skill, section: '7. Rate Limiting' }, REPO_ROOT), []);
  assert.match(sourceProblems({ kind: 'repo', ref: skill, section: '99. Made Up' }, REPO_ROOT)[0], /has no heading "99\. Made Up"/);
  assert.match(sourceProblems({ kind: 'repo', ref: 'no/such/file.md' }, REPO_ROOT)[0], /repository file "no\/such\/file\.md" does not exist/);
  assert.match(sourceProblems({ kind: 'repo', ref: '../outside.md' }, REPO_ROOT)[0], /does not exist/);
  assert.match(sourceProblems({ kind: 'repo', ref: '/etc/passwd' }, REPO_ROOT)[0], /does not exist/);
  assert.match(sourceProblems({ kind: 'repo', ref: '.claude', section: 'x' }, REPO_ROOT)[0], /repository file "\.claude" does not exist/);
  assert.match(sourceProblems({ kind: 'repo', ref: skill, section: 5 }, REPO_ROOT)[0], /section must be the text of a heading/);
});

test('a bad source is reported against its standard', () => {
  const s = standard({ sources: [{ kind: 'asvs', ref: '6.2' }] });
  assert.match(problemsOf(layerDoc([s])).join('\n'), /demo\.json: demo\.thing: ASVS ref "6\.2"/);
});

// ---- the catalogue as a whole

test('the catalogue refuses a file named unlike its layer, a layer defined twice, an id used in two layers, and bad JSON', () => {
  const doc = layerDoc();
  const { problems } = validateCatalogue([
    { file: 'demo.json', doc },
    { file: 'demo-copy.json', doc },
    { file: 'broken.json', error: 'broken.json: is not valid JSON (x)' },
  ]);
  const text = problems.join('\n');
  assert.match(text, /demo-copy\.json: file name must be demo\.json/);
  assert.match(text, /demo-copy\.json: layer demo is defined twice/);
  assert.match(text, /demo-copy\.json: demo\.thing: id is also used in demo\.json/);
  assert.match(text, /broken\.json: is not valid JSON/);
  assert.deepEqual(validateCatalogue([]).problems, ['the standards catalogue has no layer files']);
  assert.deepEqual(validateCatalogue([{ file: 'x.json', doc: {} }]).problems, ['x.json: has no "layer" block']);
});

test('loadStandards reads every .json file in order and reports one that is not JSON', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'b.json'), '{"layer":{}}');
  fs.writeFileSync(path.join(dir, 'a.json'), '{ not json');
  fs.writeFileSync(path.join(dir, 'notes.md'), '# not a layer');
  const loaded = loadStandards(dir);
  assert.deepEqual(loaded.map((e) => e.file), ['a.json', 'b.json']);
  assert.match(loaded[0].error, /a\.json: is not valid JSON/);
  assert.deepEqual(loaded[1].doc, { layer: {} });
});

// ---- the real catalogue

const real = loadStandards();
const byLayer = Object.fromEntries(real.filter((e) => e.doc?.layer?.id).map((e) => [e.doc.layer.id, e.doc]));

test('the real catalogue validates clean', () => {
  assert.equal(STANDARDS_DIR, path.join(__dirname, '..', 'standards'));
  assert.deepEqual(validateCatalogue(real).problems, []);
});

test('the first layers are "every product" and "accounts and sign-in"', () => {
  assert.equal(byLayer['every-product'].layer.kind, 'every-product');
  assert.equal(byLayer.accounts.layer.kind, 'capability');
});

test('accounts covers login, single sign-on, email verification, password reset, change email and password, session expiry and rate limits', () => {
  const topics = new Set(byLayer.accounts.standards.map((s) => s.topic));
  for (const t of ['login', 'single-sign-on', 'email-verification', 'password-reset', 'change-email', 'change-password', 'session-expiry', 'rate-limits']) {
    assert.ok(topics.has(t), `accounts has no standard for ${t}`);
  }
});

test('every product covers the security baseline, errors, logging, dependencies, accessibility and tests; backups and privacy pages are open gaps', () => {
  const doc = byLayer['every-product'];
  const topics = new Set(doc.standards.map((s) => s.topic));
  for (const t of ['security-baseline', 'errors', 'logging', 'dependencies', 'accessibility', 'tests']) assert.ok(topics.has(t), t);
  const gaps = (doc.gaps ?? []).map((g) => g.topic);
  for (const t of ['backups', 'privacy-pages']) assert.ok(gaps.includes(t), `${t} should be a gap until a source is found`);
});

test('every security standard cites OWASP ASVS, an OWASP cheat sheet or the security-review skill', () => {
  const security = new Set(['security-baseline', 'errors', 'logging', 'dependencies']);
  const all = [...byLayer['every-product'].standards.filter((s) => security.has(s.topic)), ...byLayer.accounts.standards];
  for (const s of all) {
    const ok = s.sources.some((src) => src.kind === 'asvs' || src.kind === 'owasp-cheatsheet' || (src.kind === 'repo' && src.ref.includes('security-review')));
    assert.ok(ok, `${s.id} cites no security source`);
  }
});

test('the standards catalogue is not referenced from always-loaded rules (token cost unchanged)', () => {
  const files = [path.join(REPO_ROOT, 'CLAUDE.md')];
  const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else files.push(p);
  });
  walk(path.join(REPO_ROOT, '.claude', 'rules'));
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /harness\/standards|build standard/i, f);
});

// ---- the command

test('check-standards.js prints the count per layer and exits 0 on the real catalogue', () => {
  const r = spawnSync(process.execPath, [BIN], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /check-standards: \d+ standard\(s\) in \d+ layer\(s\): .*accounts \d+.*every-product \d+/);
});

test('check-standards.js exits 1 and names each problem in a broken catalogue', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'demo.json'), JSON.stringify(layerDoc([standard({ sources: [] })])));
  const r = spawnSync(process.execPath, [BIN, dir, '--repo', REPO_ROOT], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /check-standards: 1 problem\(s\)[\s\S]*demo\.json: demo\.thing: has no source/);
});

test('check-standards.js exits 1 when the directory cannot be read', () => {
  const r = spawnSync(process.execPath, [BIN, path.join(tmp(), 'missing')], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /check-standards: cannot read/);
});
