import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openVault } from '../src/vault.js';
import { Index } from '../src/index.js';
import { renameNote } from '../src/rename.js';

function withCtx(files, fn) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-rn-')));
  try {
    const vault = openVault(path.join(base, 'v'));
    for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(vault.root, n), c);
    const index = new Index(vault, () => {});
    index.scan();
    return fn({ index, vault }, vault.root);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test('rename reads only the renamed note and the notes whose indexed links include the old key', () => withCtx({
  'Old.md': 'self [[old]]', 'Zed.md': '[[Old]]', 'Amy.md': '[[old|x]]', 'U1.md': 'nothing', 'U2.md': '[[Other]]',
}, (ctx) => {
  const reads = [];
  const real = ctx.vault.readFile.bind(ctx.vault);
  ctx.vault.readFile = (name) => { reads.push(name); return real(name); };
  const res = renameNote(ctx, 'old', 'New');
  assert.deepEqual(res.updated, ['Amy', 'Zed']);
  assert.deepEqual(res.failed, []);
  assert.equal(reads.includes('U1.md'), false);
  assert.equal(reads.includes('U2.md'), false);
  // Each file is read at most twice: the fresh pre-rewrite read and the index reload of the changed file.
  for (const n of ['New.md', 'Zed.md', 'Amy.md']) assert.ok(reads.filter((r) => r === n).length <= 2, `${n} read ${reads.filter((r) => r === n).length} times`);
}));

test('rename rewrites self-links and does not list the renamed note in updated', () => withCtx({ 'Old.md': 'self [[old]] and [[OLD|me]]' }, (ctx, root) => {
  const res = renameNote(ctx, 'old', 'New');
  assert.deepEqual(res.updated, []);
  assert.equal(fs.readFileSync(path.join(root, 'New.md'), 'utf8'), 'self [[New]] and [[New|me]]');
}));

test('rename of a case-only change still rewrites links in other notes', () => withCtx({ 'Old.md': 'x', 'A.md': '[[old]]' }, (ctx, root) => {
  const res = renameNote(ctx, 'old', 'OLD');
  assert.deepEqual(res.updated, ['A']);
  assert.equal(fs.readFileSync(path.join(root, 'A.md'), 'utf8'), '[[OLD]]');
}));

test('rename leaves a linking note with invalid UTF-8 untouched and reports write_failed', () => withCtx({ 'Old.md': 'x', 'Good.md': '[[Old]]' }, (ctx, root) => {
  const bad = Buffer.concat([Buffer.from('[[Old]] '), Buffer.from([0xff, 0xfe, 0x80]), Buffer.from(' tail')]);
  fs.writeFileSync(path.join(root, 'Bad.md'), bad);
  ctx.index.scan();
  const res = renameNote(ctx, 'old', 'New');
  assert.deepEqual(res.failed, [{ title: 'Bad', reason: 'write_failed' }]);
  assert.deepEqual(res.updated, ['Good']);
  assert.deepEqual(fs.readFileSync(path.join(root, 'Bad.md')), bad);
  assert.equal(fs.readFileSync(path.join(root, 'Good.md'), 'utf8'), '[[New]]');
}));

test('rename keeps a UTF-8 BOM and CRLF in rewritten notes', () => withCtx({ 'Old.md': 'x', 'B.md': '﻿[[Old]]\r\n' }, (ctx, root) => {
  renameNote(ctx, 'old', 'New');
  assert.deepEqual(fs.readFileSync(path.join(root, 'B.md')), Buffer.from('﻿[[New]]\r\n'));
}));

test('a read error inside the loop goes to failed and the loop continues', () => withCtx({ 'Old.md': 'x', 'A.md': '[[Old]]', 'B.md': '[[Old]]' }, (ctx, root) => {
  const real = ctx.vault.readFile.bind(ctx.vault);
  let armed = false;
  ctx.vault.readFile = (name) => {
    if (armed && name === 'A.md') throw Object.assign(new Error('EIO'), { code: 'EIO' });
    return real(name);
  };
  const realMove = ctx.vault.moveFile.bind(ctx.vault);
  ctx.vault.moveFile = (a, b) => { realMove(a, b); armed = true; };
  const res = renameNote(ctx, 'old', 'New');
  assert.deepEqual(res.failed, [{ title: 'A', reason: 'write_failed' }]);
  assert.deepEqual(res.updated, ['B']);
  assert.equal(fs.readFileSync(path.join(root, 'A.md'), 'utf8'), '[[Old]]');
  assert.equal(fs.readFileSync(path.join(root, 'B.md'), 'utf8'), '[[New]]');
  assert.equal(res.title, 'New');
}));
