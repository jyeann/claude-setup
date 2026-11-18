'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, randomSlug } = require('../src/store');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'st-')), 'sub', 'links.json');

test('create returns a link with zero clicks and creates the data directory', () => {
  const file = tmp();
  const s = createStore(file, () => Date.parse('2030-01-01T00:00:00Z'));
  const l = s.create({ url: 'https://a.test', slug: 'abc' });
  assert.deepEqual(l, { slug: 'abc', url: 'https://a.test', clicks: 0, createdAt: '2030-01-01T00:00:00.000Z', expiresAt: null, expired: false });
  assert.ok(fs.existsSync(file));
});

test('create generates a 7-char a-z0-9 slug when none is given', () => {
  const s = createStore(tmp());
  assert.match(s.create({ url: 'https://a.test' }).slug, /^[a-z0-9]{7}$/);
  assert.match(randomSlug(), /^[a-z0-9]{7}$/);
});

test('create returns null for a taken slug and keeps the original', () => {
  const s = createStore(tmp());
  s.create({ url: 'https://a.test', slug: 'abc' });
  assert.equal(s.create({ url: 'https://b.test', slug: 'abc' }), null);
  assert.equal(s.get('abc').url, 'https://a.test');
  assert.notEqual(s.create({ url: 'https://b.test', slug: 'ABC' }), null);
});

test('list returns newest first', () => {
  const s = createStore(tmp());
  s.create({ url: 'https://a.test', slug: 'one' });
  s.create({ url: 'https://a.test', slug: 'two' });
  assert.deepEqual(s.list().map((l) => l.slug), ['two', 'one']);
});

test('click counts, persists and survives a reload', () => {
  const file = tmp();
  const s = createStore(file);
  s.create({ url: 'https://a.test', slug: 'abc' });
  assert.equal(s.click('abc').link.clicks, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].clicks, 1);
  assert.equal(createStore(file).get('abc').clicks, 1);
  assert.equal(s.click('nope'), null);
});

test('expired links are flagged, not counted, but still readable and removable', () => {
  let t = Date.parse('2030-01-01T00:00:00Z');
  const s = createStore(tmp(), () => t);
  s.create({ url: 'https://a.test', slug: 'abc', expiresAt: '2030-01-01T01:00:00Z' });
  assert.equal(s.get('abc').expired, false);
  t += 3600e3;
  assert.equal(s.get('abc').expired, true);
  assert.deepEqual(s.click('abc'), { expired: true });
  assert.equal(s.get('abc').clicks, 0);
  assert.equal(s.list().length, 1);
  assert.equal(s.remove('abc'), true);
});

test('remove deletes and persists, returns false for unknown', () => {
  const file = tmp();
  const s = createStore(file);
  s.create({ url: 'https://a.test', slug: 'abc' });
  assert.equal(s.remove('abc'), true);
  assert.equal(s.remove('abc'), false);
  assert.equal(s.get('abc'), null);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), []);
});

test('a missing, empty or corrupt data file yields an empty store', () => {
  const file = tmp();
  assert.deepEqual(createStore(file).list(), []);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  assert.deepEqual(createStore(file).list(), []);
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(createStore(file).list(), []);
});

test('a damaged data file is moved aside instead of being treated as empty and overwritten', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { createStore } = require('../src/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-corrupt-'));
  const file = path.join(dir, 'links.json');
  fs.writeFileSync(file, '[{"slug": "abc", ');
  const store = createStore(file, () => 111);
  assert.deepEqual(store.list(), []);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readFileSync(`${file}.corrupt-111`, 'utf8'), '[{"slug": "abc", ');
});

test('entries with an unsafe or missing url are dropped when loading', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { createStore } = require('../src/store');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'store-load-')), 'links.json');
  const ok = { slug: 'good', url: 'https://a.test', clicks: 0, createdAt: 'x', expiresAt: null };
  fs.writeFileSync(file, JSON.stringify([ok, { ...ok, slug: 'evil', url: 'javascript:alert(1)' }, { ...ok, slug: 'nourl', url: 5 }, null, { ...ok, slug: 7 }, { ...ok, slug: 'badclicks', clicks: 'x' }]));
  assert.deepEqual(createStore(file).list().map((l) => l.slug), ['good']);
});

test('memory is rolled back when the write fails, for create, remove and click', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { createStore } = require('../src/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-fail-'));
  const file = path.join(dir, 'links.json');
  const store = createStore(file);
  store.create({ url: 'https://a.test', slug: 'keep' });
  fs.rmSync(dir, { recursive: true });
  fs.writeFileSync(dir, 'now a file, so every write fails');
  assert.throws(() => store.create({ url: 'https://b.test', slug: 'fail' }));
  assert.equal(store.get('fail'), null);
  assert.throws(() => store.click('keep'));
  assert.equal(store.get('keep').clicks, 0);
  assert.throws(() => store.remove('keep'));
  assert.equal(store.get('keep').slug, 'keep');
});
