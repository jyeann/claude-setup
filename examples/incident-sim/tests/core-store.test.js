// core/store.js and core/settings.js: storage failures never throw; corrupt data is never overwritten by load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, loadProgress, saveProgress, clearProgress, PROGRESS_KEY } from '../public/js/core/store.js';
import { parseSettings, serialiseSettings, loadSettings, saveSettings } from '../public/js/core/settings.js';
import { emptyProgress, addRun, serialiseProgress } from '../public/js/core/progress.js';

const memory = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };
const throwing = () => ({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } });
const run = { scenario: 'cache-stampede', seed: 1, scenarioHash: '0123abcd', result: 'resolved', timeToMitigate: 41, budgetLeft: 4, harmful: 0, hintUsed: false, score: 87, actions: [] };

test('createStore reads, writes and removes through the storage object', () => {
  const mem = memory();
  const s = createStore(() => mem);
  assert.deepEqual(s.read('k'), { ok: true, value: null });
  assert.deepEqual(s.write('k', 'v'), { ok: true, value: undefined });
  assert.deepEqual(s.read('k'), { ok: true, value: 'v' });
  assert.equal(s.remove('k').ok, true);
  assert.equal(mem.m.has('k'), false);
});

test('createStore turns every storage failure into { ok:false } without throwing', () => {
  const blocked = createStore(() => throwing());
  assert.deepEqual(blocked.read('k'), { ok: false, reason: 'blocked' });
  assert.deepEqual(blocked.write('k', 'v'), { ok: false, reason: 'blocked' });
  assert.deepEqual(blocked.remove('k'), { ok: false, reason: 'blocked' });
  assert.equal(blocked.probe(), false);
  const getter = createStore(() => { throw new Error('SecurityError'); });
  assert.deepEqual(getter.read('k'), { ok: false, reason: 'blocked' });
  const missing = createStore(() => null);
  assert.deepEqual(missing.read('k'), { ok: false, reason: 'unavailable' });
  assert.equal(missing.probe(), false);
});

test('probe passes on a working store, leaves no key behind, and fails when reads do not return what was written', () => {
  const mem = memory();
  assert.equal(createStore(() => mem).probe(), true);
  assert.equal(mem.m.size, 0);
  const lossy = { getItem: () => null, setItem() {}, removeItem() {} };
  assert.equal(createStore(() => lossy).probe(), false);
});

test('loadProgress reports empty, ok, corrupt and blocked, and never writes', () => {
  const mem = memory();
  const s = createStore(() => mem);
  assert.deepEqual(loadProgress(s), { status: 'empty', progress: emptyProgress() });
  const p = addRun(emptyProgress(), run);
  mem.setItem(PROGRESS_KEY, serialiseProgress(p));
  const ok = loadProgress(s);
  assert.equal(ok.status, 'ok');
  assert.equal(JSON.stringify(ok.progress), JSON.stringify(p));
  mem.setItem(PROGRESS_KEY, '{"version":7,"runs":[]}');
  const bad = loadProgress(s);
  assert.equal(bad.status, 'corrupt');
  assert.equal(bad.reason, 'this file is version 7 and this app reads version 1.');
  assert.deepEqual(bad.progress, emptyProgress());
  assert.equal(mem.getItem(PROGRESS_KEY), '{"version":7,"runs":[]}', 'the corrupt value is left in place');
  assert.deepEqual(loadProgress(createStore(() => throwing())), { status: 'blocked', progress: emptyProgress() });
});

test('saveProgress writes, reads back and verifies; a corrupt store is replaced by the first successful save', () => {
  const mem = memory();
  const s = createStore(() => mem);
  mem.setItem(PROGRESS_KEY, 'garbage');
  const p = addRun(emptyProgress(), run);
  assert.deepEqual(saveProgress(s, p), { ok: true });
  assert.equal(mem.getItem(PROGRESS_KEY), serialiseProgress(p));
  assert.equal(loadProgress(s).status, 'ok');
});

test('saveProgress fails cleanly when the store blocks, drops writes or returns something else', () => {
  const p = addRun(emptyProgress(), run);
  assert.equal(saveProgress(createStore(() => throwing()), p).ok, false);
  const dropping = { getItem: () => null, setItem() {}, removeItem() {} };
  const r = saveProgress(createStore(() => dropping), p);
  assert.equal(r.ok, false);
  assert.match(r.reason, /could not be read back/);
  const mangling = { getItem: () => '{"version":1,"runs":[]}', setItem() {}, removeItem() {} };
  assert.equal(saveProgress(createStore(() => mangling), p).ok, false);
});

test('clearProgress removes the key and reports blocked stores', () => {
  const mem = memory();
  mem.setItem(PROGRESS_KEY, 'x');
  assert.equal(clearProgress(createStore(() => mem)), true);
  assert.equal(mem.m.size, 0);
  assert.equal(clearProgress(createStore(() => throwing())), false);
});

test('parseSettings defaults to shortcuts on for anything invalid and keeps valid booleans', () => {
  for (const bad of ['', 'nope', '[]', 'null', '5', '{"shortcuts":"no"}', '{"shortcuts":1}', '{"__proto__":{"shortcuts":false}}', '{', undefined, null, 5, `{"shortcuts":false,"pad":"${'x'.repeat(5000)}"}`]) {
    assert.deepEqual(parseSettings(bad), { shortcuts: true }, String(bad).slice(0, 30));
  }
  assert.deepEqual(parseSettings('{"shortcuts":false}'), { shortcuts: false });
  assert.deepEqual(parseSettings('{"shortcuts":true}'), { shortcuts: true });
  for (const v of [true, false]) assert.deepEqual(parseSettings(serialiseSettings({ shortcuts: v })), { shortcuts: v });
  assert.equal(serialiseSettings({ shortcuts: false }), '{"shortcuts":false}');
  assert.equal(serialiseSettings(undefined), '{"shortcuts":true}');
  assert.equal(serialiseSettings({}), '{"shortcuts":true}');
});

test('loadSettings and saveSettings go through the store and survive a blocked store', () => {
  const mem = memory();
  const s = createStore(() => mem);
  assert.deepEqual(loadSettings(s), { shortcuts: true });
  assert.equal(saveSettings(s, { shortcuts: false }), true);
  assert.deepEqual(loadSettings(s), { shortcuts: false });
  assert.equal(mem.getItem('incident-sim:settings'), '{"shortcuts":false}');
  const b = createStore(() => throwing());
  assert.deepEqual(loadSettings(b), { shortcuts: true });
  assert.equal(saveSettings(b, { shortcuts: false }), false);
});
