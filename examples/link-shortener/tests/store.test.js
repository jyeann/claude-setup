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
