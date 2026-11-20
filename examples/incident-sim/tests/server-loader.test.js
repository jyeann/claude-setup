import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadScenarios, formatScenarioError, MAX_FILE_BYTES, NAME_RE } from '../src/scenarios-load.js';

// Stand-ins for core/safe-json.js and engine/validate.js (built by other slices).
const deps = {
  parseSafe: (text, { maxBytes }) => {
    if (Buffer.byteLength(text) > maxBytes) return { ok: false, reason: 'too big' };
    try {
      const v = JSON.parse(text);
      return text.includes('__proto__') ? { ok: false, reason: 'the file contains the key "__proto__", which is not allowed.' } : { ok: true, value: v };
    } catch { return { ok: false, reason: 'the file is not valid JSON.' }; }
  },
  validate: (obj, file) => (obj.id === file.slice(0, -5) ? { ok: true, scenario: obj } : { ok: false, errors: [{ file, field: 'id', message: 'must match the file name. Expected: the file name without .json.' }] }),
};

function dirWith(files) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'is-ld-')));
  const dir = path.join(base, 's');
  fs.mkdirSync(dir);
  for (const [n, v] of Object.entries(files)) {
    if (v && v.symlink) fs.symlinkSync(v.symlink, path.join(dir, n));
    else if (v && v.dir) fs.mkdirSync(path.join(dir, n));
    else fs.writeFileSync(path.join(dir, n), v);
  }
  return { dir, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}
const ok = (id) => JSON.stringify({ id });

test('an empty folder loads nothing, needs no other module and gives an empty index', async () => {
  const d = dirWith({});
  try {
    const r = await loadScenarios(d.dir);
    assert.deepEqual(r.scenarios, []);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.index, { valid: [], errors: [] });
  } finally { d.cleanup(); }
});

test('valid files keep their exact bytes and the index lists sorted ids', async () => {
  const d = dirWith({ 'b.json': ok('b'), 'a.json': `${ok('a')}\n` });
  try {
    const r = await loadScenarios(d.dir, deps);
    assert.deepEqual(r.scenarios.map((s) => s.id), ['a', 'b']);
    assert.ok(r.scenarios[0].bytes.equals(Buffer.from(`${ok('a')}\n`)));
    assert.deepEqual(r.index.valid, ['a', 'b']);
  } finally { d.cleanup(); }
});

test('name rule: non-matching .json names are (file) errors and other extensions are ignored', async () => {
  const d = dirWith({ 'Bad.json': ok('Bad'), 'a_b.json': ok('a_b'), '.h.json': '{}', [`${'x'.repeat(41)}.json`]: '{}', [`${'x'.repeat(40)}.json`]: ok('x'.repeat(40)), 'n.txt': 'x', 'c.json.bak': 'x' });
  try {
    const r = await loadScenarios(d.dir, deps);
    assert.deepEqual(r.index.valid, ['x'.repeat(40)]);
    assert.deepEqual(r.errors.map((e) => e.file), ['.h.json', 'Bad.json', 'a_b.json', `${'x'.repeat(41)}.json`]);
    assert.ok(r.errors.every((e) => e.field === '(file)'));
    assert.ok(NAME_RE.test('a.json') && !NAME_RE.test('.json'));
  } finally { d.cleanup(); }
});

test('symlinks and folders are rejected', async () => {
  const d = dirWith({ 'real.json': ok('real'), 'link.json': { symlink: '/etc/hostname' }, 'dir.json': { dir: true } });
  try {
    const r = await loadScenarios(d.dir, deps);
    assert.deepEqual(r.index.valid, ['real']);
    assert.deepEqual(r.errors.map((e) => e.file), ['dir.json', 'link.json']);
  } finally { d.cleanup(); }
});

test('size limit is 65,536 bytes inclusive', async () => {
  const body = Buffer.from(ok('x'));
  const pad = (n) => Buffer.concat([body, Buffer.alloc(n - body.length, 0x20)]);
  const d = dirWith({ 'x.json': pad(MAX_FILE_BYTES), 'y.json': pad(MAX_FILE_BYTES + 1) });
  try {
    const r = await loadScenarios(d.dir, deps);
    assert.deepEqual(r.index.valid, ['x']);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].file, 'y.json');
    assert.match(r.errors[0].message, /65537 bytes/);
  } finally { d.cleanup(); }
});

test('invalid UTF-8, parse failures, forbidden keys and non-object roots are (file) errors', async () => {
  const d = dirWith({ 'a.json': Buffer.from([0x7b, 0xff, 0x7d]), 'b.json': '{nope', 'c.json': '{"__proto__":{}}', 'd.json': 'null', 'e.json': '[]', 'f.json': '' });
  try {
    const r = await loadScenarios(d.dir, deps);
    assert.deepEqual(r.index.valid, []);
    assert.equal(r.errors.length, 6);
    const by = Object.fromEntries(r.errors.map((e) => [e.file, e]));
    assert.match(by['a.json'].message, /UTF-8/);
    assert.match(by['c.json'].message, /__proto__/);
    assert.equal(by['d.json'].message, 'is not a JSON object. Expected: an object with the scenario fields.');
    assert.equal(by['e.json'].message, by['d.json'].message);
    assert.ok(r.errors.every((e) => e.field === '(file)'));
  } finally { d.cleanup(); }
});

test('validator errors pass through with their own field and the file is not served', async () => {
  const d = dirWith({ 'a.json': ok('other') });
  try {
    const r = await loadScenarios(d.dir, deps);
    assert.deepEqual(r.scenarios, []);
    assert.equal(r.errors[0].field, 'id');
    assert.deepEqual(r.index.errors, r.errors);
  } finally { d.cleanup(); }
});

test('formatScenarioError matches the printed server line', () => {
  assert.equal(formatScenarioError({ file: 'a.json', field: 'x', message: 'bad.' }), 'scenarios/a.json: field "x": bad.');
});
