'use strict';
// The design pipeline catalogue (#157, spec #156): the format of a pipeline, the checker, and the first two.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  PIPELINES_DIR, CHECK_KINDS, HANDOFF_KINDS, PIPELINE_FIELDS,
  loadPipelines, validatePipeline, validateCatalogue, dependencyOrder,
} = require('../lib/pipelines');

const BIN = path.join(__dirname, '..', 'bin', 'check-pipelines.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pipelines-'));

const pipeline = (over = {}) => ({
  id: 'demo',
  title: 'Demo',
  appliesWhen: 'Always.',
  dependsOn: [],
  questions: [{ id: 'demo.who', ask: 'Who is it for?', why: 'Decides the rest.' }],
  criteria: [{ id: 'demo.fits', mustBeTrue: 'It fits.', check: { kind: 'review', how: 'Read it.' } }],
  outputs: [{ id: 'demo.page', title: 'A page', what: 'One rendered page.' }],
  handoff: { logic: ['One rule.'], assets: [], runtime: [] },
  ...over,
});
const problemsOf = (doc) => validatePipeline(doc, { file: 'demo.json' }).join('\n');
const entry = (doc) => ({ file: `${doc.id}.json`, doc });
const catalogueProblems = (...docs) => validateCatalogue(docs.map(entry)).problems.join('\n');

// ---- the format of one pipeline

test('a well-formed pipeline has no problems', () => {
  assert.equal(problemsOf(pipeline()), '');
});

test('a pipeline missing any field is refused, naming the field', () => {
  for (const field of PIPELINE_FIELDS) {
    const doc = pipeline();
    delete doc[field];
    assert.match(problemsOf(doc), new RegExp(`demo\\.json: pipeline: missing ${field}`), field);
  }
  assert.match(problemsOf(pipeline({ title: '  ' })), /missing title/);
  assert.match(problemsOf(null), /is not a pipeline object/);
  assert.match(problemsOf([]), /is not a pipeline object/);
});

test('a pipeline id is lower-case words joined by "-"', () => {
  assert.match(problemsOf(pipeline({ id: 'Demo' })), /id "Demo" is not lower-case words/);
  assert.match(problemsOf(pipeline({ id: 7 })), /id 7 is not lower-case words/);
  assert.equal(problemsOf(pipeline({
    id: 'three-d',
    questions: [{ id: 'three-d.who', ask: 'Who?', why: 'Because.' }],
    criteria: [{ id: 'three-d.fits', mustBeTrue: 'It fits.', check: { kind: 'measure', how: 'Measure it.' } }],
    outputs: [{ id: 'three-d.model', title: 'A model', what: 'One model.' }],
  })), '');
});

test('empty questions, criteria or outputs are refused', () => {
  for (const name of ['questions', 'criteria', 'outputs']) {
    assert.match(problemsOf(pipeline({ [name]: [] })), new RegExp(`lists no ${name}`), name);
    assert.match(problemsOf(pipeline({ [name]: 'none' })), new RegExp(`${name} is not a list`), name);
  }
});

test('questions, criteria and outputs carry the pipeline id, are unique, and have their text', () => {
  assert.match(problemsOf(pipeline({ questions: [{ id: 'other.who', ask: 'Who?', why: 'Because.' }] })), /other\.who: id must be "demo\.<lower-case-words>"/);
  assert.match(problemsOf(pipeline({ questions: [{ ask: 'Who?', why: 'Because.' }] })), /question 1: missing id/);
  assert.match(problemsOf(pipeline({ questions: [{ id: 'demo.who', ask: 'Who?' }] })), /demo\.who: missing why/);
  assert.match(problemsOf(pipeline({ questions: [{ id: 'demo.who', ask: ' ', why: 'Because.' }] })), /demo\.who: missing ask/);
  assert.match(problemsOf(pipeline({ questions: ['who'] })), /question 1: is not an object/);
  assert.match(problemsOf(pipeline({ outputs: [{ id: 'demo.page', title: 'A page' }] })), /demo\.page: missing what/);
  // an id is unique across the three lists, so a verdict or a report can name it alone
  assert.match(problemsOf(pipeline({ outputs: [{ id: 'demo.fits', title: 'A page', what: 'A page.' }] })), /demo\.fits: id is listed twice/);
});

test('a criterion says what must be true and how it is checked', () => {
  const criterion = (over) => pipeline({ criteria: [{ id: 'demo.fits', mustBeTrue: 'It fits.', check: { kind: 'review', how: 'Read it.' }, ...over }] });
  assert.match(problemsOf(criterion({ mustBeTrue: '' })), /demo\.fits: missing mustBeTrue/);
  assert.match(problemsOf(criterion({ check: { kind: 'vibes', how: 'Feel it.' } })), /check kind "vibes" is not one of measure, compare, review/);
  assert.match(problemsOf(criterion({ check: undefined })), /check kind "undefined"/);
  assert.match(problemsOf(criterion({ check: { kind: 'measure' } })), /check has no "how"/);
  for (const kind of CHECK_KINDS) assert.equal(problemsOf(criterion({ check: { kind, how: 'Do it.' } })), '', kind);
});

test('paths are optional; a criterion or output may belong to one declared path', () => {
  const paths = [{ id: 'follow', title: 'Follow', when: 'There is a guide.' }, { id: 'create', title: 'Create', when: 'There is none.' }];
  const onPath = (p, extra = {}) => pipeline({ ...extra, criteria: [{ id: 'demo.fits', path: p, mustBeTrue: 'It fits.', check: { kind: 'review', how: 'Read it.' } }] });
  assert.equal(problemsOf(onPath('follow', { paths })), '');
  assert.match(problemsOf(onPath('borrow', { paths })), /demo\.fits: path "borrow" is not one of follow, create/);
  assert.match(problemsOf(onPath('follow')), /names path "follow" but the pipeline declares no paths/);
  assert.match(problemsOf(pipeline({ paths: [] })), /paths, when given, is a non-empty list/);
  assert.match(problemsOf(pipeline({ paths: [paths[0], paths[0]] })), /path follow: is listed twice/);
  assert.match(problemsOf(pipeline({ paths: [{ id: 'follow', title: 'Follow' }] })), /path follow: has no when/);
  assert.match(problemsOf(pipeline({ paths: [{ id: 'Follow It', title: 'Follow', when: 'x' }] })), /path id "Follow It" is not lower-case words/);
  assert.match(problemsOf(pipeline({ paths, outputs: [{ id: 'demo.page', path: 'borrow', title: 'A page', what: 'A page.' }] })), /demo\.page: path "borrow"/);
});

test('the hand-off names logic, assets and runtime, and hands over something', () => {
  assert.deepEqual([...HANDOFF_KINDS], ['logic', 'assets', 'runtime']);
  assert.match(problemsOf(pipeline({ handoff: 'none' })), /handoff: is not an object with logic, assets, runtime/);
  assert.match(problemsOf(pipeline({ handoff: { logic: ['One.'], assets: [] } })), /handoff: runtime is not a list/);
  assert.match(problemsOf(pipeline({ handoff: { logic: [], assets: [], runtime: [] } })), /hands nothing to system analysis/);
  assert.match(problemsOf(pipeline({ handoff: { logic: [''], assets: [], runtime: [] } })), /logic has an entry that is not text/);
  assert.match(problemsOf(pipeline({ handoff: { logic: ['One.'], assets: [], runtime: [], cost: [] } })), /"cost" is not one of logic, assets, runtime/);
});

test('dependsOn is a list of pipeline ids, without itself or repeats', () => {
  assert.match(problemsOf(pipeline({ dependsOn: 'brand' })), /dependsOn is not a list/);
  assert.match(problemsOf(pipeline({ dependsOn: ['Brand'] })), /dependsOn entry "Brand" is not a pipeline id/);
  assert.match(problemsOf(pipeline({ dependsOn: ['demo'] })), /depends on itself/);
  assert.match(problemsOf(pipeline({ dependsOn: ['brand', 'brand'] })), /lists a dependency twice/);
});

// ---- the catalogue as a whole

const named = (id, dependsOn = []) => pipeline({
  id,
  dependsOn,
  questions: [{ id: `${id}.who`, ask: 'Who?', why: 'Because.' }],
  criteria: [{ id: `${id}.fits`, mustBeTrue: 'It fits.', check: { kind: 'review', how: 'Read it.' } }],
  outputs: [{ id: `${id}.page`, title: 'A page', what: 'A page.' }],
});

test('an unknown dependency is refused, naming the known pipelines', () => {
  assert.equal(catalogueProblems(named('brand'), named('screens', ['brand'])), '');
  assert.match(catalogueProblems(named('screens', ['brand'])), /screens\.json: pipeline: depends on "brand", which is not a pipeline in the catalogue \(screens\)/);
});

test('a circle of dependencies is refused', () => {
  assert.match(catalogueProblems(named('a', ['b']), named('b', ['c']), named('c', ['a'])), /depend on each other in a circle/);
  assert.match(catalogueProblems(named('a', ['a'])), /circle/);
  assert.equal(dependencyOrder({ a: ['b'], b: ['a'] }), null);
});

test('the order puts every pipeline after what it depends on', () => {
  const { order, counts } = validateCatalogue([named('screens', ['brand']), named('storyboard', ['storyline']), named('brand'), named('storyline')].map(entry));
  assert.deepEqual(order, ['brand', 'screens', 'storyline', 'storyboard']);
  assert.deepEqual(counts, { screens: 1, storyboard: 1, brand: 1, storyline: 1 });
});

test('a duplicate id, a wrong file name, bad JSON and an empty catalogue are refused', () => {
  assert.match(validateCatalogue([{ file: 'brand.json', doc: named('brand') }, { file: 'brand2.json', doc: named('brand') }]).problems.join('\n'),
    /brand2\.json: file name must be brand\.json\nbrand2\.json: pipeline brand is defined twice/);
  assert.match(validateCatalogue([{ file: 'x.json', error: 'x.json: is not valid JSON (boom)' }]).problems.join('\n'), /x\.json: is not valid JSON/);
  assert.match(validateCatalogue([]).problems.join('\n'), /has no pipeline files/);
});

// ---- the checker

const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });

test('check-pipelines passes a good folder and prints the dependency order', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'screens.json'), JSON.stringify(named('screens', ['brand'])));
  fs.writeFileSync(path.join(dir, 'brand.json'), JSON.stringify(named('brand')));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a pipeline');
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /check-pipelines: 2 pipeline\(s\), criteria per pipeline in dependency order: brand 1, screens 1\./);
});

test('check-pipelines exits 1 and names each problem', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'screens.json'), JSON.stringify(named('screens', ['brand'])));
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json');
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /check-pipelines: 2 problem\(s\)/);
  assert.match(r.stderr, /broken\.json: is not valid JSON/);
  assert.match(r.stderr, /depends on "brand"/);
});

test('check-pipelines exits 1 on a folder it cannot read', () => {
  const r = run(path.join(tmp(), 'missing'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /check-pipelines: cannot read/);
});

// ---- the catalogue shipped in this repository

test('the shipped catalogue passes its own checker', () => {
  const { problems } = validateCatalogue(loadPipelines(PIPELINES_DIR));
  assert.deepEqual(problems, []);
  const r = run();
  assert.equal(r.status, 0, r.stderr);
});

test('the first two pipelines are brand and screens, and screens follows brand', () => {
  const { order } = validateCatalogue(loadPipelines(PIPELINES_DIR));
  for (const id of ['brand', 'screens']) assert.ok(order.includes(id), id);
  assert.ok(order.indexOf('brand') < order.indexOf('screens'));
});

test('brand has two paths, follow a guide or create one, each with its own criteria and output', () => {
  const brand = loadPipelines(PIPELINES_DIR).find((e) => e.file === 'brand.json').doc;
  assert.deepEqual(brand.paths.map((p) => p.id), ['follow-guide', 'create-guide']);
  for (const p of brand.paths) {
    assert.ok(brand.criteria.some((c) => c.path === p.id), `criteria for ${p.id}`);
    assert.ok(brand.outputs.some((o) => o.path === p.id), `output for ${p.id}`);
  }
  assert.ok(brand.criteria.some((c) => c.path === undefined), 'criteria that hold on both paths');
  assert.match(brand.questions[0].ask, /brand guide/);
});

test('every shipped pipeline names a runtime cost for system analysis', () => {
  for (const { file, doc } of loadPipelines(PIPELINES_DIR)) assert.ok(doc.handoff.runtime.length > 0, file);
});
