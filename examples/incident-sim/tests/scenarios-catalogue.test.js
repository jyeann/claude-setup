// The scenario manifest against the files. The manifest is the loader's `index` ({valid, errors}), which the server
// serves as /scenarios/index.json. It is generated at boot, so no index.json file may sit in scenarios/: that name
// matches the scenario file rule and would show up as an invalid scenario.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadScenarios, MAX_FILE_BYTES } from '../src/scenarios-load.js';
import { isAllowedGuide } from '../public/js/engine/guides.js';

const DIR = path.resolve(import.meta.dirname, '..', 'scenarios');
// Spec order (spec.md "The 10 shipped scenarios").
const CATALOGUE = [
  'cache-stampede', 'thundering-herd', 'retry-storm', 'hot-partition', 'queue-backlog',
  'n-plus-one', 'connection-pool-exhaustion', 'expiring-certificate', 'split-brain', 'cascading-failure',
];

const jsonFiles = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
const loaded = await loadScenarios(DIR);

test('the catalogue is the 10 pinned ids, each once', () => {
  assert.equal(CATALOGUE.length, 10);
  assert.equal(new Set(CATALOGUE).size, 10);
});

test('scenarios/ holds exactly the catalogue files and no hand-written index.json', () => {
  assert.deepEqual(jsonFiles, CATALOGUE.map((id) => `${id}.json`).sort());
  assert.equal(fs.existsSync(path.join(DIR, 'index.json')), false);
});

test('the manifest lists every catalogue id as valid, sorted, with no errors, in the served key order', () => {
  assert.deepEqual(loaded.index.valid, [...CATALOGUE].sort());
  assert.deepEqual(loaded.index.errors, []);
  assert.deepEqual(Object.keys(loaded.index), ['valid', 'errors']);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.index)), { valid: [...CATALOGUE].sort(), errors: [] });
});

test('every manifest entry matches its file: stem equals id, bytes are the file bytes, size is within the limit', () => {
  assert.equal(loaded.scenarios.length, CATALOGUE.length);
  for (const entry of loaded.scenarios) {
    const onDisk = fs.readFileSync(path.join(DIR, `${entry.id}.json`));
    assert.equal(entry.scenario.id, entry.id);
    assert.ok(entry.bytes.equals(onDisk), `${entry.id} bytes`);
    assert.ok(onDisk.length <= MAX_FILE_BYTES, `${entry.id} is ${onDisk.length} bytes`);
  }
});

test('titles and summaries are unique, and every guide link is in the allow-list', () => {
  const titles = new Set();
  const summaries = new Set();
  for (const { id, scenario } of loaded.scenarios) {
    assert.ok(!titles.has(scenario.title), `${id} repeats a title`);
    assert.ok(!summaries.has(scenario.summary), `${id} repeats a summary`);
    titles.add(scenario.title);
    summaries.add(scenario.summary);
    assert.ok(isAllowedGuide(scenario.guideUrl), `${id} guide ${scenario.guideUrl}`);
  }
});

test('difficulty and budget stay inside the ranges the board shows', () => {
  for (const { id, scenario } of loaded.scenarios) {
    assert.ok([1, 2, 3].includes(scenario.difficulty), `${id} difficulty`);
    assert.ok(scenario.budget >= scenario.optimalSummary.cost, `${id} budget covers the optimal path`);
    assert.equal(scenario.budget, scenario.difficulty === 3 ? 8 : 6, `${id} budget follows difficulty`);
  }
});

function copyTo(names, extra = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'is-cat-')));
  for (const n of names) fs.copyFileSync(path.join(DIR, n), path.join(base, n));
  for (const [n, v] of Object.entries(extra)) fs.writeFileSync(path.join(base, n), v);
  return { dir: base, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test('the manifest follows the files: a missing file leaves the manifest without that id', async () => {
  const d = copyTo(jsonFiles.filter((f) => f !== 'split-brain.json'));
  try {
    const r = await loadScenarios(d.dir);
    assert.deepEqual(r.index.valid, CATALOGUE.filter((id) => id !== 'split-brain').sort());
    assert.deepEqual(r.index.errors, []);
  } finally { d.cleanup(); }
});

test('a hand-written index.json is reported as an invalid scenario, never as the manifest', async () => {
  const d = copyTo(jsonFiles, { 'index.json': JSON.stringify({ valid: CATALOGUE, errors: [] }) });
  try {
    const r = await loadScenarios(d.dir);
    assert.deepEqual(r.index.valid, [...CATALOGUE].sort());
    assert.ok(r.index.errors.length >= 1);
    assert.ok(r.index.errors.every((e) => e.file === 'index.json'));
  } finally { d.cleanup(); }
});

test('a broken file is listed in errors with its bare name while the others stay valid', async () => {
  const bad = JSON.parse(fs.readFileSync(path.join(DIR, 'n-plus-one.json'), 'utf8'));
  delete bad.rootCause;
  const d = copyTo(jsonFiles.filter((f) => f !== 'n-plus-one.json'), { 'n-plus-one.json': JSON.stringify(bad) });
  try {
    const r = await loadScenarios(d.dir);
    assert.deepEqual(r.index.valid, CATALOGUE.filter((id) => id !== 'n-plus-one').sort());
    assert.deepEqual(r.index.errors.map((e) => [e.file, e.field]), [['n-plus-one.json', 'rootCause']]);
  } finally { d.cleanup(); }
});
