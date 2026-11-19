'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, MAX_CERTS } = require('../src/store');

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
const DAY = 86400000;
const T0 = Date.UTC(2026, 0, 10, 12);
const cert = (i, name = 'Ada') => ({ id: i.toString(16).padStart(16, '0'), name, greeting: `g${i}`, language: 'en', date: '2026-01-10', signature: 'a'.repeat(64) });
const quiet = () => {};

test('streak: same day unchanged, next day +1, gap resets, visits always +1', () => {
  let t = T0;
  const s = createStore(path.join(dir(), 'd.json'), () => t, quiet);
  assert.deepEqual(s.recordHello('Ada', cert(1)), { visit: 1, streak: 1 });
  assert.deepEqual(s.recordHello('ada ', cert(2)), { visit: 2, streak: 1 });
  t += DAY;
  assert.deepEqual(s.recordHello('Ada', cert(3)), { visit: 3, streak: 2 });
  t += 2 * DAY;
  assert.deepEqual(s.recordHello('ADA', cert(4)), { visit: 4, streak: 1 });
  assert.deepEqual(s.recordHello('Bob', cert(5)), { visit: 1, streak: 1 });
});

test('persists across instances and serves certificates', () => {
  const f = path.join(dir(), 'sub', 'd.json');
  const a = createStore(f, () => T0, quiet);
  a.recordHello('Ada', cert(7));
  a.vote('en.formal');
  a.vote('en.formal');
  const b = createStore(f, () => T0, quiet);
  assert.equal(b.getCertificate(cert(7).id).name, 'Ada');
  assert.equal(b.votes().get('en.formal'), 2);
  assert.deepEqual(b.recordHello('ada', cert(8)), { visit: 2, streak: 1 });
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).version, 1);
});

test('getCertificate returns null for unknown or malformed ids', () => {
  const s = createStore(path.join(dir(), 'd.json'), () => T0, quiet);
  assert.equal(s.getCertificate('0'.repeat(16)), null);
  assert.equal(s.getCertificate('../etc'), null);
  assert.equal(s.getCertificate('__proto__'), null);
  assert.equal(s.getCertificate(undefined), null);
});

test('corrupt file is moved aside and store starts empty', () => {
  const d = dir();
  const f = path.join(d, 'd.json');
  fs.writeFileSync(f, '{not json');
  const logs = [];
  const s = createStore(f, () => 123, (m) => logs.push(m));
  assert.deepEqual(s.stats(), { visitors: 0, certificates: 0 });
  assert.equal(fs.existsSync(`${f}.corrupt-123`), true);
  assert.equal(fs.existsSync(f), false);
  assert.equal(logs.length, 1);
});

test('wrong version is treated as corrupt; invalid rows are skipped individually', () => {
  const d = dir();
  const f = path.join(d, 'd.json');
  fs.writeFileSync(f, JSON.stringify({ version: 2 }));
  createStore(f, () => 5, quiet);
  assert.equal(fs.existsSync(`${f}.corrupt-5`), true);
  fs.writeFileSync(f, JSON.stringify({ version: 1, visitors: [{ key: 'a' }, null], certificates: [cert(1), { id: 'bad' }], votes: [['en.formal', 3], ['nope', 1], ['en.pirate', 0], 'x'] }));
  const s = createStore(f, () => 5, quiet);
  assert.deepEqual(s.stats(), { visitors: 0, certificates: 1 });
  assert.deepEqual([...s.votes()], [['en.formal', 3]]);
});

test('persist failure rolls back memory and throws', () => {
  const d = dir();
  const blocker = path.join(d, 'file');
  fs.writeFileSync(blocker, 'x');
  const logs = [];
  const s = createStore(path.join(blocker, 'd.json'), () => T0, (m) => logs.push(m));
  assert.throws(() => s.recordHello('Ada', cert(1)));
  assert.deepEqual(s.stats(), { visitors: 0, certificates: 0 });
  assert.equal(s.getCertificate(cert(1).id), null);
  assert.throws(() => s.vote('en.formal'));
  assert.equal(s.votes().size, 0);
  assert.ok(logs.length >= 2);
});

test('certificate cap evicts the oldest', () => {
  const s = createStore(path.join(dir(), 'd.json'), () => T0, quiet);
  const f = s;
  // fill directly via file to keep the test fast
  assert.equal(MAX_CERTS, 10000);
  assert.equal(f.stats().certificates, 0);
  const d = dir();
  const file = path.join(d, 'big.json');
  const rows = [];
  for (let i = 0; i < MAX_CERTS; i += 1) rows.push(cert(i));
  fs.writeFileSync(file, JSON.stringify({ version: 1, visitors: [], certificates: rows, votes: [] }));
  const big = createStore(file, () => T0, quiet);
  assert.equal(big.stats().certificates, MAX_CERTS);
  big.recordHello('Ada', cert(MAX_CERTS));
  assert.equal(big.stats().certificates, MAX_CERTS);
  assert.equal(big.getCertificate(cert(0).id), null);
  assert.notEqual(big.getCertificate(cert(MAX_CERTS).id), null);
});

test('prototype-like names are ordinary visitors', () => {
  const s = createStore(path.join(dir(), 'd.json'), () => T0, quiet);
  assert.deepEqual(s.recordHello('__proto__', cert(1)), { visit: 1, streak: 1 });
  assert.deepEqual(s.recordHello('constructor', cert(2)), { visit: 1, streak: 1 });
  assert.deepEqual(s.recordHello('__PROTO__', cert(3)), { visit: 2, streak: 1 });
});

test('MAX_VISITORS is 10000 and evicts the oldest visitor first', () => {
  const { MAX_VISITORS } = require('../src/store');
  assert.equal(MAX_VISITORS, 10000);
  const file = path.join(dir(), 'v.json');
  const visitors = [];
  for (let i = 0; i < MAX_VISITORS; i += 1) visitors.push({ key: `v${i}`, displayName: `v${i}`, visits: 1, streak: 1, firstDay: '2026-01-10', lastDay: '2026-01-10' });
  fs.writeFileSync(file, JSON.stringify({ version: 1, visitors, certificates: [], votes: [] }));
  const s = createStore(file, () => T0, quiet);
  assert.equal(s.stats().visitors, MAX_VISITORS);
  assert.deepEqual(s.recordHello('v1', cert(1)), { visit: 2, streak: 1 }, 'updating does not evict');
  s.recordHello('newcomer', cert(2));
  assert.equal(s.stats().visitors, MAX_VISITORS);
  assert.deepEqual(s.recordHello('v0', cert(3)), { visit: 1, streak: 1 }, 'v0 was oldest and evicted');
});

test('rollback restores evicted visitors in order and leaves no tmp file', () => {
  const d = dir();
  const file = path.join(d, 'r.json');
  const { MAX_VISITORS } = require('../src/store');
  const visitors = [];
  for (let i = 0; i < MAX_VISITORS; i += 1) visitors.push({ key: `v${i}`, displayName: `v${i}`, visits: 1, streak: 1, firstDay: '2026-01-10', lastDay: '2026-01-10' });
  fs.writeFileSync(file, JSON.stringify({ version: 1, visitors, certificates: [], votes: [] }));
  const s = createStore(file, () => T0, quiet);
  fs.mkdirSync(`${file}.${process.pid}.tmp`); // make the tmp path unusable: rmSync of a dir without recursive fails
  assert.throws(() => s.recordHello('newcomer', cert(1)), (e) => e.name === 'PersistError');
  assert.equal(s.stats().visitors, MAX_VISITORS);
  assert.equal(s.getCertificate(cert(1).id), null);
  fs.rmdirSync(`${file}.${process.pid}.tmp`);
  assert.deepEqual(s.recordHello('v0', cert(2)), { visit: 2, streak: 1 }, 'v0 still present after rollback');
});

test('persist failure throws PersistError and leaves no tmp file behind', () => {
  const d = dir();
  const file = path.join(d, 'p.json');
  const s = createStore(file, () => T0, quiet);
  fs.mkdirSync(file); // rename onto a directory fails
  assert.throws(() => s.vote('en.formal'), (e) => e.name === 'PersistError' && Boolean(e.cause));
  assert.deepEqual(fs.readdirSync(d), ['p.json']);
  assert.equal(s.votes().size, 0);
});

test('stale tmp is replaced and the data file is written with mode 0600', () => {
  const d = dir();
  const file = path.join(d, 'm.json');
  fs.writeFileSync(`${file}.${process.pid}.tmp`, 'stale', { mode: 0o666 });
  const s = createStore(file, () => T0, quiet);
  s.vote('en.formal');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(d), ['m.json']);
});

test('non-parse read errors throw instead of quarantining', () => {
  const d = dir();
  const file = path.join(d, 'dirfile');
  fs.mkdirSync(file); // reading a directory gives EISDIR
  assert.throws(() => createStore(file, () => 1, quiet), (e) => e.code === 'EISDIR');
  assert.deepEqual(fs.readdirSync(d), ['dirfile']);
});

test('logs the real outcome when quarantine rename fails', () => {
  const d = dir();
  const file = path.join(d, 'q.json');
  fs.writeFileSync(file, 'nope');
  const logs = [];
  const real = fs.renameSync;
  fs.renameSync = () => { const e = new Error('x'); e.code = 'EACCES'; throw e; };
  try { createStore(file, () => 9, (m) => logs.push(m)); } finally { fs.renameSync = real; }
  assert.equal(logs.length, 1);
  assert.match(logs[0], /could not be moved/);
  assert.doesNotMatch(logs[0], /moved to/);
});

test('peekVisitor returns a copy, matches case/NFC/trim, and never mutates or persists', () => {
  const file = path.join(dir(), 'd.json');
  const s = createStore(file, () => T0, quiet);
  assert.equal(s.peekVisitor('Ada'), null);
  s.recordHello('Ada', cert(1));
  const before = fs.readFileSync(file);
  const statsBefore = s.stats();
  const v = s.peekVisitor(' ADA ');
  assert.deepEqual(v, { displayName: 'Ada', visits: 1, streak: 1, firstDay: '2026-01-10', lastDay: '2026-01-10' });
  v.visits = 999; v.streak = 999;
  assert.equal(s.peekVisitor('ada').visits, 1);
  assert.deepEqual(s.recordHello('ada', cert(2)), { visit: 2, streak: 1 });
  const mid = fs.readFileSync(file);
  for (let i = 0; i < 5; i += 1) s.peekVisitor('Ada');
  assert.deepEqual(fs.readFileSync(file), mid);
  assert.notDeepEqual(before, mid);
  assert.deepEqual(statsBefore, { visitors: 1, certificates: 1 });
  assert.deepEqual(s.stats(), { visitors: 1, certificates: 2 });
});

test('peekVisitor returns null for unknown names and non-strings', () => {
  const s = createStore(path.join(dir(), 'd.json'), () => T0, quiet);
  s.recordHello('Ada', cert(1));
  for (const bad of ['Bob', '', undefined, null, 5, {}]) assert.equal(s.peekVisitor(bad), null);
  assert.equal(s.peekVisitor('__proto__'), null);
});
