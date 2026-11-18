'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, writeFileAtomic, validShape, BootError } = require('../src/store');
const { createBoard, addCard } = require('../src/board');

const H = 'a'.repeat(64);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
const quiet = { log: () => {} };
const open = (dir, extra = {}) => { const s = createStore({ dir, ...quiet, ...extra }); s.open(); return s; };
const boardsDir = (dir) => path.join(dir, 'boards');

test('create writes the board file before it is visible and update persists a bumped version', () => {
  const dir = tmp();
  const s = open(dir);
  s.create(H, createBoard('T', 'f'));
  assert.ok(fs.existsSync(path.join(boardsDir(dir), `${H}.json`)));
  const updated = s.update(H, (b) => addCard(b, 'actions', 'x', 'me'));
  assert.equal(updated.version, 2);
  const onDisk = JSON.parse(fs.readFileSync(path.join(boardsDir(dir), `${H}.json`), 'utf8'));
  assert.equal(onDisk.version, 2);
  assert.equal(onDisk.cards.length, 1);
  s.close();
});

test('version and cards survive closing and reopening the store', () => {
  const dir = tmp();
  const s = open(dir);
  s.create(H, createBoard('T', 'f'));
  s.update(H, (b) => addCard(b, 'actions', 'x', 'me'));
  s.close();
  const again = open(dir);
  assert.equal(again.get(H).version, 2);
  assert.equal(again.get(H).cards[0].text, 'x');
  assert.equal(again.size(), 1);
  again.close();
});

test('an update that returns false changes nothing and writes nothing', () => {
  const dir = tmp();
  const s = open(dir);
  s.create(H, createBoard('T', 'f'));
  const before = fs.statSync(path.join(boardsDir(dir), `${H}.json`)).mtimeMs;
  assert.equal(s.update(H, () => false).version, 1);
  assert.equal(fs.statSync(path.join(boardsDir(dir), `${H}.json`)).mtimeMs, before);
  s.close();
});

test('update on an unknown board throws board_not_found', () => {
  const s = open(tmp());
  assert.throws(() => s.update(H, () => {}), { code: 'board_not_found', status: 404 });
  s.close();
});

test('an fs error during rename rolls back: old board stays, no tmp file left, 503', () => {
  const dir = tmp();
  const bad = { ...fs, renameSync: () => { throw Object.assign(new Error('disk'), { code: 'EIO' }); } };
  const good = open(dir);
  good.create(H, createBoard('T', 'f'));
  good.close();
  const s = createStore({ dir, fs: { ...fs }, ...quiet });
  s.open();
  s.update(H, (b) => addCard(b, 'actions', 'kept', 'me'));
  s.close();
  const flaky = createStore({ dir, fs: bad, ...quiet });
  flaky.open();
  assert.throws(() => flaky.update(H, (b) => addCard(b, 'actions', 'lost', 'me')), { code: 'storage_error', status: 503 });
  assert.equal(flaky.get(H).cards.length, 1);
  assert.equal(flaky.get(H).version, 2);
  assert.deepEqual(fs.readdirSync(boardsDir(dir)).filter((n) => n.includes('.tmp-')), []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(boardsDir(dir), `${H}.json`), 'utf8')).cards.length, 1);
  assert.throws(() => flaky.create('b'.repeat(64), createBoard('N', 'f')), { code: 'storage_error' });
  assert.equal(flaky.get('b'.repeat(64)), undefined);
  flaky.close();
});

test('create refuses past maxBoards with storage_full', () => {
  const s = open(tmp(), { maxBoards: 1 });
  s.create(H, createBoard('T', 'f'));
  assert.throws(() => s.create('b'.repeat(64), createBoard('U', 'f')), { code: 'storage_full', status: 503 });
  s.close();
});

test('a corrupt, mis-shaped or oddly named file is moved aside and logged', () => {
  const dir = tmp();
  fs.mkdirSync(boardsDir(dir), { recursive: true });
  fs.writeFileSync(path.join(boardsDir(dir), `${H}.json`), '{not json');
  fs.writeFileSync(path.join(boardsDir(dir), `${'b'.repeat(64)}.json`), JSON.stringify({ schema: 1 }));
  fs.writeFileSync(path.join(boardsDir(dir), 'short.json'), JSON.stringify(createBoard('T', 'f')));
  const logs = [];
  const s = createStore({ dir, now: () => 1234, log: (m) => logs.push(m) });
  s.open();
  assert.equal(s.size(), 0);
  const names = fs.readdirSync(boardsDir(dir));
  assert.ok(names.includes(`${H}.json.corrupt-1234`));
  assert.ok(names.includes('short.json.corrupt-1234'));
  assert.equal(names.filter((n) => n.endsWith('.json')).length, 0);
  assert.equal(logs.length, 3);
  s.close();
});

test('leftover tmp files are removed at boot', () => {
  const dir = tmp();
  fs.mkdirSync(boardsDir(dir), { recursive: true });
  fs.writeFileSync(path.join(boardsDir(dir), `${H}.json.tmp-42`), 'half');
  const s = open(dir);
  assert.deepEqual(fs.readdirSync(boardsDir(dir)), []);
  s.close();
});

test('a second store on the same dir fails while the first lives and works after close', () => {
  const dir = tmp();
  const a = open(dir);
  const b = createStore({ dir, ...quiet });
  assert.throws(() => b.open(), BootError);
  a.close();
  assert.equal(fs.existsSync(path.join(dir, '.lock')), false);
  b.open();
  assert.equal(fs.readFileSync(path.join(dir, '.lock'), 'utf8'), String(process.pid));
  b.close();
});

test('a lock left by a dead pid is taken over', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.lock'), '2147483646');
  const s = open(dir);
  assert.equal(fs.readFileSync(path.join(dir, '.lock'), 'utf8'), String(process.pid));
  s.close();
});

test('open fails with a clear BootError when DATA_DIR is not writable', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'boards'), 'a file, not a dir');
  const s = createStore({ dir, ...quiet });
  assert.throws(() => s.open(), /Cannot write to DATA_DIR/);
});

test('writeFileAtomic replaces the target and leaves no tmp file', () => {
  const dir = tmp();
  const file = path.join(dir, 'x.json');
  writeFileAtomic(fs, file, 'one');
  writeFileAtomic(fs, file, 'two');
  assert.equal(fs.readFileSync(file, 'utf8'), 'two');
  assert.deepEqual(fs.readdirSync(dir), ['x.json']);
});

test('validShape accepts a real board and rejects broken cards', () => {
  const ok = createBoard('T', 'f');
  assert.equal(validShape(ok), true);
  assert.equal(validShape({ ...ok, cards: [{ id: 'x' }] }), false);
  assert.equal(validShape({ ...ok, closed: 'no' }), false);
  assert.equal(validShape(null), false);
});

test('a lock holding this process own pid from a previous run is stale and taken over', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.lock'), String(process.pid));
  const s = open(dir);
  assert.equal(fs.readFileSync(path.join(dir, '.lock'), 'utf8'), String(process.pid));
  s.close();
  assert.equal(fs.existsSync(path.join(dir, '.lock')), false);
});

test('board files and the lock are 0600, the boards dir and DATA_DIR are 0700', () => {
  const dir = path.join(tmp(), 'data');
  const s = open(dir);
  s.create(H, createBoard('T', 'f'));
  const mode = (p) => fs.statSync(p).mode & 0o777;
  assert.equal(mode(path.join(boardsDir(dir), `${H}.json`)), 0o600);
  assert.equal(mode(path.join(dir, '.lock')), 0o600);
  assert.equal(mode(boardsDir(dir)), 0o700);
  assert.equal(mode(dir), 0o700);
  s.close();
});

test('an existing DATA_DIR with loose permissions is tightened to 0700', () => {
  const dir = tmp();
  fs.chmodSync(dir, 0o755);
  const s = open(dir);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  s.close();
});

test('a failed write logs the system error code, or the message when there is no code', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-log-'));
  const logs = [];
  const withErr = (err) => createStore({ dir, fs: { ...fs, renameSync: () => { throw err; } }, log: (m) => logs.push(m) });
  const a = withErr(Object.assign(new Error('boom'), { code: 'ENOSPC' }));
  a.open();
  assert.throws(() => a.create(H, createBoard('T', 'f')), { code: 'storage_error' });
  a.close();
  const b = withErr(new Error('no code here'));
  b.open();
  assert.throws(() => b.create(H, createBoard('T', 'f')), { code: 'storage_error' });
  b.close();
  assert.ok(logs.some((l) => l.includes('ENOSPC') && !l.includes('boom')));
  assert.ok(logs.some((l) => l.includes('no code here')));
});
