'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, writeAtomic } = require('../src/store');
const L = require('../src/lists');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
const id = (c) => c.repeat(22);
const quiet = () => {};
const open = (file, opts = {}) => { const s = createStore(file, { log: quiet, ...opts }); s.load(); return s; };

test('writeAtomic creates missing directories and leaves no temp file', () => {
  const dir = tmp();
  const file = path.join(dir, 'a', 'b', 'lists.json');
  writeAtomic(file, '{"x":1}');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"x":1}');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['lists.json']);
});

test('writeAtomic replaces the old content as a whole', () => {
  const dir = tmp();
  const file = path.join(dir, 'f.json');
  writeAtomic(file, 'old old old old');
  writeAtomic(file, 'new');
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
});

test('writeAtomic writes to <file>.tmp-<pid> first and renames it over the file', () => {
  const dir = tmp();
  const file = path.join(dir, 'f.json');
  const realRename = fs.renameSync;
  const calls = [];
  fs.renameSync = (from, to) => { calls.push([from, to, fs.readFileSync(from, 'utf8')]); return realRename(from, to); };
  try { writeAtomic(file, 'payload'); } finally { fs.renameSync = realRename; }
  assert.deepEqual(calls, [[`${file}.tmp-${process.pid}`, file, 'payload']]);
});

test('writeAtomic failure keeps the old file and removes its temp file', () => {
  const dir = tmp();
  const file = path.join(dir, 'f.json');
  writeAtomic(file, 'keep');
  const realRename = fs.renameSync;
  fs.renameSync = () => { throw Object.assign(new Error('boom'), { code: 'EIO' }); };
  try { assert.throws(() => writeAtomic(file, 'lost'), /boom/); } finally { fs.renameSync = realRename; }
  assert.equal(fs.readFileSync(file, 'utf8'), 'keep');
  assert.deepEqual(fs.readdirSync(dir), ['f.json']);
});

test('a missing data file gives an empty store and creates nothing until the first write', () => {
  const dir = tmp();
  const file = path.join(dir, 'lists.json');
  const store = open(file);
  assert.equal(store.size(), 0);
  assert.equal(fs.existsSync(file), false);
  store.create(L.createList(id('A'), 'Trip', 0));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).schema, 1);
});

test('create persists pretty-printed JSON, and a new store reads it back', () => {
  const dir = tmp();
  const file = path.join(dir, 'lists.json');
  const store = open(file);
  store.create(L.createList(id('A'), 'Trip', 0));
  store.update(id('A'), (l) => L.addItem(l, 'Passport'));
  store.update(id('A'), (l) => L.setTicked(l, '1', true));
  assert.match(fs.readFileSync(file, 'utf8'), /\n  "schema": 1/);
  const again = open(file);
  assert.equal(again.size(), 1);
  assert.deepEqual(again.get(id('A')).items, [{ id: '1', text: 'Passport', ticked: true }]);
  assert.equal(again.get(id('A')).nextItemId, 2);
});

test('update runs on a copy: a throwing mutation changes neither memory nor disk', () => {
  const dir = tmp();
  const file = path.join(dir, 'lists.json');
  const store = open(file);
  store.create(L.createList(id('A'), 'Trip', 0));
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => store.update(id('A'), (l) => { L.addItem(l, 'x'); throw new L.DomainError('list_full', 409, 'no'); }), (e) => e.code === 'list_full');
  assert.equal(store.get(id('A')).items.length, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('update of an unknown list gives list_not_found', () => {
  const store = open(path.join(tmp(), 'lists.json'));
  assert.throws(() => store.update(id('Z'), () => {}), (e) => e.code === 'list_not_found' && e.status === 404);
});

test('write failure gives 503 storage_error and leaves memory and disk unchanged', () => {
  const dir = tmp();
  const file = path.join(dir, 'lists.json');
  const store = open(file);
  store.create(L.createList(id('A'), 'Trip', 0));
  const before = fs.readFileSync(file, 'utf8');
  const realRename = fs.renameSync;
  fs.renameSync = () => { throw new Error('disk full'); };
  try {
    assert.throws(() => store.update(id('A'), (l) => L.addItem(l, 'x')), (e) => e.code === 'storage_error' && e.status === 503 && e.message === 'Could not save that change. Try again.');
    assert.throws(() => store.create(L.createList(id('B'), 'Other', 0)), (e) => e.code === 'storage_error');
  } finally { fs.renameSync = realRename; }
  assert.equal(store.get(id('A')).items.length, 0);
  assert.equal(store.get(id('B')), undefined);
  assert.equal(store.size(), 1);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  store.update(id('A'), (l) => L.addItem(l, 'x'));
  assert.equal(store.get(id('A')).items.length, 1);
});

test('create beyond maxLists gives storage_full 503', () => {
  const store = open(path.join(tmp(), 'lists.json'), { maxLists: 2 });
  store.create(L.createList(id('A'), 'a', 0));
  store.create(L.createList(id('B'), 'b', 0));
  assert.throws(() => store.create(L.createList(id('C'), 'c', 0)), (e) => e.code === 'storage_full' && e.status === 503 && e.message === 'Too many lists are stored.');
  assert.equal(store.size(), 2);
});

test('create with an id that already exists is refused', () => {
  const store = open(path.join(tmp(), 'lists.json'));
  store.create(L.createList(id('A'), 'a', 0));
  assert.throws(() => store.create(L.createList(id('A'), 'again', 0)), (e) => e.code === 'storage_error');
  assert.equal(store.get(id('A')).name, 'a');
});

test('get returns a stored list and undefined for unknown ids', () => {
  const store = open(path.join(tmp(), 'lists.json'));
  store.create(L.createList(id('A'), 'a', 0));
  assert.equal(store.get(id('A')).name, 'a');
  assert.equal(store.get(id('B')), undefined);
  assert.equal(store.get('__proto__'), undefined);
});

const corruptCases = {
  'not JSON': '{nope',
  'wrong schema': JSON.stringify({ schema: 2, lists: {} }),
  'lists is an array': JSON.stringify({ schema: 1, lists: [] }),
  'list id mismatch': JSON.stringify({ schema: 1, lists: { [id('A')]: { id: id('B'), name: 'x', createdAt: 'now', nextItemId: 1, items: [] } } }),
  'bad list id key': JSON.stringify({ schema: 1, lists: { short: { id: 'short', name: 'x', createdAt: 'now', nextItemId: 1, items: [] } } }),
  'empty name': JSON.stringify({ schema: 1, lists: { [id('A')]: { id: id('A'), name: ' ', createdAt: 'now', nextItemId: 1, items: [] } } }),
  'bad item id': JSON.stringify({ schema: 1, lists: { [id('A')]: { id: id('A'), name: 'x', createdAt: 'now', nextItemId: 2, items: [{ id: '01', text: 'a', ticked: false }] } } }),
  'item ticked not boolean': JSON.stringify({ schema: 1, lists: { [id('A')]: { id: id('A'), name: 'x', createdAt: 'now', nextItemId: 2, items: [{ id: '1', text: 'a', ticked: 1 }] } } }),
  'item text with control char': JSON.stringify({ schema: 1, lists: { [id('A')]: { id: id('A'), name: 'x', createdAt: 'now', nextItemId: 2, items: [{ id: '1', text: 'a\u0001', ticked: false }] } } }),
  'duplicate item ids': JSON.stringify({ schema: 1, lists: { [id('A')]: { id: id('A'), name: 'x', createdAt: 'now', nextItemId: 3, items: [{ id: '1', text: 'a', ticked: false }, { id: '1', text: 'b', ticked: false }] } } }),
  'items not an array': JSON.stringify({ schema: 1, lists: { [id('A')]: { id: id('A'), name: 'x', createdAt: 'now', nextItemId: 1, items: {} } } }),
  'too many items': JSON.stringify({ schema: 1, lists: { [id('A')]: { id: id('A'), name: 'x', createdAt: 'now', nextItemId: 202, items: Array.from({ length: 201 }, (_, i) => ({ id: String(i + 1), text: 't', ticked: false })) } } }),
  'nextItemId 0': JSON.stringify({ schema: 1, lists: { [id('A')]: { id: id('A'), name: 'x', createdAt: 'now', nextItemId: 0, items: [] } } }),
  'array at top': '[]',
};

for (const [label, content] of Object.entries(corruptCases)) {
  test(`corrupt file (${label}) is moved aside as <file>.corrupt-<epochms> and the store starts empty`, () => {
    const dir = tmp();
    const file = path.join(dir, 'lists.json');
    fs.writeFileSync(file, content);
    const logs = [];
    const before = Date.now();
    const store = createStore(file, { log: (m) => logs.push(m) });
    store.load();
    assert.equal(store.size(), 0);
    assert.equal(fs.existsSync(file), false);
    const moved = fs.readdirSync(dir).filter((n) => n.startsWith('lists.json.corrupt-'));
    assert.equal(moved.length, 1);
    assert.ok(Number(moved[0].slice('lists.json.corrupt-'.length)) >= before);
    assert.equal(fs.readFileSync(path.join(dir, moved[0]), 'utf8'), content);
    assert.equal(logs.length, 1);
    store.create(L.createList(id('A'), 'fresh', 0));
    assert.equal(fs.readFileSync(path.join(dir, moved[0]), 'utf8'), content);
  });
}

test('a repairable nextItemId is raised above the highest stored item id', () => {
  const dir = tmp();
  const file = path.join(dir, 'lists.json');
  fs.writeFileSync(file, JSON.stringify({ schema: 1, lists: { [id('A')]: { id: id('A'), name: 'x', createdAt: 5, nextItemId: 1, items: [{ id: '7', text: 'a', ticked: true }] } } }));
  const store = open(file);
  assert.equal(store.get(id('A')).nextItemId, 8);
});

test('leftover <file>.tmp-* files are deleted at boot, other files stay', () => {
  const dir = tmp();
  const file = path.join(dir, 'lists.json');
  fs.writeFileSync(`${file}.tmp-123`, 'half');
  fs.writeFileSync(`${file}.tmp-9`, 'half');
  fs.writeFileSync(path.join(dir, 'other.tmp-1'), 'mine');
  open(file);
  assert.deepEqual(fs.readdirSync(dir), ['other.tmp-1']);
});

test('an unreadable data path (a directory) starts empty without crashing', () => {
  const dir = tmp();
  const file = path.join(dir, 'lists.json');
  fs.mkdirSync(file);
  const logs = [];
  const store = createStore(file, { log: (m) => logs.push(m) });
  store.load();
  assert.equal(store.size(), 0);
  assert.equal(logs.length, 1);
});
