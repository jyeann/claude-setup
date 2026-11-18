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
