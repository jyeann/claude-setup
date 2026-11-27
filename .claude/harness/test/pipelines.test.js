'use strict';
// The design pipeline catalogue (#157, #158, spec #156): the format of a pipeline, the checker, the six shipped
// pipelines and the suggested starting sets.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  PIPELINES_DIR, STARTING_SETS, CHECK_KINDS, HANDOFF_KINDS, PIPELINE_FIELDS,
  loadPipelines, validatePipeline, validateCatalogue, dependencyOrder,
  loadStartingSets, validateStartingSets, checkFolder,
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
  assert.match(problemsOf(criterion({ check: undefined })), /demo\.fits: check is not an object/);
  assert.match(problemsOf(criterion({ check: 'review' })), /demo\.fits: check is not an object/);
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
  assert.match(problemsOf(pipeline({ questions: [{ id: 'demo.who', path: 'borrow', ask: 'Who?', why: 'Because.' }] })), /demo\.who: names path "borrow"/);
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

test('a dependency or pipeline named like a built-in object property is handled as any other name', () => {
  assert.match(catalogueProblems(named('a', ['constructor'])), /a\.json: pipeline: depends on "constructor", which is not a pipeline/);
  assert.equal(catalogueProblems(named('constructor')), '');
  assert.deepEqual(dependencyOrder({ a: ['constructor'] }), ['a']);
});

test('an unknown dependency is reported once, under the real file name', () => {
  const { problems } = validateCatalogue([{ file: 'x.json', doc: named('a', ['b']) }]);
  assert.deepEqual(problems, ['x.json: file name must be a.json', 'x.json: pipeline: depends on "b", which is not a pipeline in the catalogue (a)']);
  assert.equal(catalogueProblems(named('a', ['Bad'])).match(/Bad/g).length, 1);
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
  assert.deepEqual(dependencyOrder({ d: ['b', 'c'], b: ['a'], c: ['a'], a: [] }), ['a', 'b', 'c', 'd']);
  // not only alphabetical luck: a pipeline that sorts first still comes after what it needs
  assert.deepEqual(dependencyOrder({ a: ['z'], z: [] }), ['z', 'a']);
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
  const screens = loadPipelines(PIPELINES_DIR).find((e) => e.file === 'screens.json').doc;
  assert.deepEqual(screens.dependsOn, ['brand']);
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

// ---- the concept pipelines (#158)

const shipped = () => Object.fromEntries(loadPipelines(PIPELINES_DIR).map(({ doc }) => [doc.id, doc]));

test('the catalogue holds the four concept pipelines beside brand and screens', () => {
  assert.deepEqual(Object.keys(shipped()).sort(), ['3d-assets', 'brand', 'character-concept', 'screens', 'storyboard', 'storyline']);
  for (const id of ['storyline', 'storyboard', 'character-concept', '3d-assets']) {
    const doc = shipped()[id];
    for (const field of ['questions', 'criteria', 'outputs']) assert.ok(doc[field].length > 0, `${id} ${field}`);
  }
});

test('storyboard depends on storyline and comes after it in the order', () => {
  assert.deepEqual(shipped().storyboard.dependsOn, ['storyline']);
  const { order } = validateCatalogue(loadPipelines(PIPELINES_DIR));
  assert.ok(order.indexOf('storyline') < order.indexOf('storyboard'));
});

test('3D assets can be picked with no game pipeline: it depends on nothing', () => {
  assert.deepEqual(shipped()['3d-assets'].dependsOn, []);
  assert.match(shipped()['3d-assets'].appliesWhen, /design element/);
  // nothing else depends on the game pipelines except storyboard on storyline
  for (const [id, doc] of Object.entries(shipped())) {
    const game = doc.dependsOn.filter((d) => ['storyline', 'storyboard', 'character-concept'].includes(d));
    assert.deepEqual(game, id === 'storyboard' ? ['storyline'] : [], id);
  }
});

test('storyline has a one-story and a branching path, and only the branching path needs a story map a script can read', () => {
  const doc = shipped().storyline;
  assert.deepEqual(doc.paths.map((p) => p.id), ['linear', 'branching']);
  for (const p of doc.paths) assert.ok(doc.criteria.some((c) => c.path === p.id), `criteria for ${p.id}`);
  assert.ok(doc.criteria.some((c) => c.path === 'branching' && c.check.kind === 'measure' && /story map file/.test(c.check.how)));
  for (const c of doc.criteria.filter((x) => x.path === 'linear')) assert.doesNotMatch(`${c.mustBeTrue} ${c.check.how}`, /story map/, c.id);
  assert.ok(doc.outputs.some((o) => o.path === 'branching' && /a script can read/.test(o.what)));
});

test('a measure criterion in the concept pipelines names a file a tool can open, not a picture of it', () => {
  // Lesson from #157: a measure check needs an output in a form a tool can read.
  const form = /file|script|tool|colour picker|validator|video player/i;
  for (const id of ['storyline', 'storyboard', 'character-concept', '3d-assets']) {
    for (const c of shipped()[id].criteria.filter((x) => x.check.kind === 'measure')) assert.match(c.check.how, form, c.id);
  }
  assert.ok(shipped()['3d-assets'].criteria.some((c) => c.check.kind === 'measure' && /not as a picture/.test(c.mustBeTrue)));
});

test('no concept criterion needs the product built: none checks running product code', () => {
  // Lesson from #157: the design gate comes before system design and build.
  const needsBuild = /\b(the built product|in the product code|the running product|the build passes|in the app at runtime)\b/i;
  for (const id of ['storyline', 'storyboard', 'character-concept', '3d-assets']) {
    for (const c of shipped()[id].criteria) assert.doesNotMatch(`${c.mustBeTrue} ${c.check.how}`, needsBuild, c.id);
  }
});

test('every concept hand-off names a runtime cost and the logic the output implies', () => {
  const cost = /download|frame|memory|load|size|network|bitrate/i;
  for (const id of ['storyline', 'storyboard', 'character-concept', '3d-assets']) {
    const { handoff } = shipped()[id];
    assert.ok(handoff.runtime.some((line) => cost.test(line)), `${id} runtime`);
    assert.ok(handoff.logic.length > 0, `${id} logic`);
  }
  assert.ok(shipped().storyline.handoff.logic.some((line) => /branching/.test(line) && /state the product must store/.test(line)));
});

// ---- suggested starting sets (#158)

const setsOf = (sets) => ({ sets });
const set = (over = {}) => ({ id: 'kind', productKind: 'A kind', why: 'Because.', pipelines: ['brand'], ...over });
const catalogue = [entry(named('brand')), entry(named('screens', ['brand']))];
const setProblems = (doc) => validateStartingSets(doc, catalogue).join('\n');

test('a starting set of known pipelines with their dependencies has no problems', () => {
  assert.equal(setProblems(setsOf([set({ pipelines: ['brand', 'screens'] })])), '');
});

test('a starting set naming a pipeline not in the catalogue is refused, naming the known ones', () => {
  assert.match(setProblems(setsOf([set({ pipelines: ['brand', 'storyline'] })])), /starting-sets\.json: set kind: "storyline" is not a pipeline in the catalogue \(brand, screens\)/);
  assert.match(setProblems(setsOf([set({ pipelines: ['constructor'] })])), /"constructor" is not a pipeline/);
  assert.match(setProblems(setsOf([set({ pipelines: [7] })])), /7 is not a pipeline/);
});

test('a starting set that leaves out a dependency is refused', () => {
  assert.match(setProblems(setsOf([set({ pipelines: ['screens'] })])), /set kind: screens depends on brand, which the set does not list/);
});

test('starting sets need ids, a product kind, a reason and pipelines, each once', () => {
  assert.match(setProblems(null), /is not an object with "sets"/);
  assert.match(setProblems([]), /is not an object with "sets"/);
  assert.match(setProblems({}), /"sets" is not a non-empty list/);
  assert.match(setProblems(setsOf([])), /"sets" is not a non-empty list/);
  assert.match(setProblems(setsOf(['x'])), /set 1: is not an object/);
  assert.match(setProblems(setsOf([set({ id: 'Bad Id' })])), /id "Bad Id" is not lower-case words/);
  assert.match(setProblems(setsOf([set(), set()])), /set kind: is listed twice/);
  assert.match(setProblems(setsOf([set({ productKind: ' ', why: undefined })])), /has no productKind[\s\S]*has no why/);
  assert.match(setProblems(setsOf([set({ pipelines: [] })])), /pipelines is not a non-empty list/);
  assert.match(setProblems(setsOf([set({ pipelines: ['brand', 'brand'] })])), /lists a pipeline twice/);
});

test('a folder with no starting sets file has no sets, and a file that is not JSON or a sets/ that is a file is an error', () => {
  const dir = tmp();
  assert.equal(loadStartingSets(dir), null);
  fs.mkdirSync(path.join(dir, 'sets'));
  fs.writeFileSync(path.join(dir, STARTING_SETS), '{ nope');
  assert.match(loadStartingSets(dir).error, /starting-sets\.json: is not valid JSON/);
  const asFile = tmp();
  fs.writeFileSync(path.join(asFile, 'sets'), 'not a folder');
  assert.match(loadStartingSets(asFile).error, /starting-sets\.json: cannot be read \(ENOTDIR\)/);
  assert.match(checkFolder(asFile).problems.join('\n'), /cannot be read \(ENOTDIR\)/);
});

test('check-pipelines prints good starting sets, and exits 1 on a set with an unknown pipeline, a missing dependency or bad JSON', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'brand.json'), JSON.stringify(named('brand')));
  fs.writeFileSync(path.join(dir, 'screens.json'), JSON.stringify(named('screens', ['brand'])));
  fs.mkdirSync(path.join(dir, 'sets'));
  fs.writeFileSync(path.join(dir, STARTING_SETS), JSON.stringify(setsOf([set({ id: 'product-ui', pipelines: ['brand', 'screens'] })])));
  let r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Suggested starting sets: product-ui \(brand, screens\)\./);
  fs.writeFileSync(path.join(dir, STARTING_SETS), JSON.stringify(setsOf([set({ pipelines: ['screens', 'storyline'] })])));
  r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /depends on brand, which the set does not list/);
  assert.match(r.stderr, /"storyline" is not a pipeline in the catalogue/);
  fs.writeFileSync(path.join(dir, STARTING_SETS), '{ nope');
  r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is not valid JSON/);
});

test('the shipped starting sets suggest brand and screens for product UI, all six for a game, and 3D on a website without a game pipeline', () => {
  const loaded = loadStartingSets(PIPELINES_DIR);
  assert.ok(loaded && loaded.doc, 'the shipped catalogue has starting sets');
  assert.deepEqual(validateStartingSets(loaded.doc, loadPipelines(PIPELINES_DIR)), []);
  const byId = Object.fromEntries(loaded.doc.sets.map((s) => [s.id, s.pipelines]));
  assert.deepEqual(byId['product-ui'], ['brand', 'screens']);
  for (const id of ['brand', 'screens', 'storyline', 'storyboard', 'character-concept', '3d-assets']) assert.ok(byId.game.includes(id), `game has ${id}`);
  assert.ok(byId['website-with-3d'].includes('3d-assets'));
  for (const id of ['storyline', 'storyboard', 'character-concept']) assert.ok(!byId['website-with-3d'].includes(id), id);
  const r = run();
  assert.match(r.stdout, /Suggested starting sets: product-ui \(brand, screens\);/);
});

test('the shipped folder needs its starting sets file; another folder may go without', () => {
  const dir = tmp();
  for (const f of fs.readdirSync(PIPELINES_DIR).filter((x) => x.endsWith('.json'))) fs.copyFileSync(path.join(PIPELINES_DIR, f), path.join(dir, f));
  assert.deepEqual(checkFolder(dir).problems, []);
  assert.equal(checkFolder(dir).sets, null);
  assert.equal(run(dir).status, 0);
  assert.match(checkFolder(dir, { requireSets: true }).problems.join('\n'), /starting-sets\.json: missing/);
  assert.deepEqual(checkFolder().problems, []);
  assert.ok(checkFolder().sets.sets.length > 0);
});
