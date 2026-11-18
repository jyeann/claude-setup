import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openVault, VaultError } from '../src/vault.js';
import { StorageError, ExistsError } from '../src/errors.js';

function tmpVault(fn) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-unit-')));
  try {
    return fn(openVault(path.join(base, 'v')), base);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}
const dots = (v) => fs.readdirSync(v.root).filter((n) => n.startsWith('.wiki-'));

test('openVault creates and realpaths the folder, and refuses a path under a file', () => tmpVault((v, base) => {
  assert.equal(v.root, path.join(base, 'v'));
  assert.equal(fs.statSync(v.root).isDirectory(), true);
  fs.writeFileSync(path.join(base, 'f'), 'x');
  assert.throws(() => openVault(path.join(base, 'f', 'v')), (e) => e instanceof VaultError && e.message.startsWith('Cannot write to VAULT_DIR'));
}));

test('titleToPath validates and keeps the file directly in the vault', () => tmpVault((v) => {
  assert.equal(v.titleToPath('  Hello '), path.join(v.root, 'Hello.md'));
  for (const bad of ['../x', 'a/b', '..', '', '.hidden', 'a\\b']) assert.throws(() => v.titleToPath(bad), bad);
  assert.throws(() => v.pathFor('../x.md'));
  assert.throws(() => v.pathFor('sub/x.md'));
  assert.throws(() => v.pathFor('..'));
}));

test('writeAtomic replaces content, leaves no tmp file and uses mode 0644', () => tmpVault((v) => {
  v.createFile('A.md', Buffer.from('one'));
  v.writeAtomic('A.md', Buffer.from('two'));
  assert.equal(fs.readFileSync(path.join(v.root, 'A.md'), 'utf8'), 'two');
  assert.equal(fs.statSync(path.join(v.root, 'A.md')).mode & 0o777, 0o644);
  assert.deepEqual(dots(v), []);
}));

test('a failed atomic write keeps the old file and cleans its tmp file', () => tmpVault((v) => {
  v.createFile('A.md', Buffer.from('keep'));
  fs.rmSync(path.join(v.root, 'A.md'));
  fs.mkdirSync(path.join(v.root, 'A.md'));
  assert.throws(() => v.writeAtomic('A.md', Buffer.from('new')), StorageError);
  assert.equal(fs.statSync(path.join(v.root, 'A.md')).isDirectory(), true);
  assert.deepEqual(dots(v), []);
}));

test('createFile never overwrites a file, symlink, dangling symlink or folder', () => tmpVault((v) => {
  v.createFile('A.md', Buffer.from('one'));
  fs.symlinkSync('A.md', path.join(v.root, 'L.md'));
  fs.symlinkSync('/nonexistent/x', path.join(v.root, 'D.md'));
  fs.mkdirSync(path.join(v.root, 'F.md'));
  for (const name of ['A.md', 'L.md', 'D.md', 'F.md']) assert.throws(() => v.createFile(name, Buffer.from('bad')), ExistsError, name);
  assert.equal(fs.readFileSync(path.join(v.root, 'A.md'), 'utf8'), 'one');
  assert.equal(fs.readlinkSync(path.join(v.root, 'D.md')), '/nonexistent/x');
  assert.deepEqual(dots(v), []);
}));

test('readFile reads regular files fresh and refuses symlinks, folders and missing files', () => tmpVault((v) => {
  v.createFile('A.md', Buffer.from('abc'));
  fs.symlinkSync('A.md', path.join(v.root, 'L.md'));
  fs.mkdirSync(path.join(v.root, 'F.md'));
  const r = v.readFile('A.md');
  assert.equal(r.buf.toString(), 'abc');
  assert.equal(r.size, 3);
  assert.equal(v.readFile('L.md'), null);
  assert.equal(v.readFile('F.md'), null);
  assert.equal(v.readFile('nope.md'), null);
  assert.equal(v.statFile('L.md'), null);
  assert.equal(v.statFile('A.md').size, 3);
  assert.equal(v.occupied('L.md'), true);
  assert.equal(v.occupied('nope.md'), false);
}));

test('listFiles returns only regular lowercase .md files that are not dotfiles', () => tmpVault((v) => {
  v.createFile('A.md', Buffer.from(''));
  fs.writeFileSync(path.join(v.root, 'B.MD'), '');
  fs.writeFileSync(path.join(v.root, 'c.txt'), '');
  fs.writeFileSync(path.join(v.root, '.d.md'), '');
  fs.symlinkSync('A.md', path.join(v.root, 'L.md'));
  fs.mkdirSync(path.join(v.root, 'F.md'));
  assert.deepEqual(v.listFiles().map((f) => f.filename), ['A.md']);
}));

test('deleteFile removes only a regular file and reports a miss', () => tmpVault((v) => {
  v.createFile('A.md', Buffer.from('x'));
  fs.symlinkSync('A.md', path.join(v.root, 'L.md'));
  assert.equal(v.deleteFile('L.md'), false);
  assert.equal(fs.lstatSync(path.join(v.root, 'L.md')).isSymbolicLink(), true);
  assert.equal(v.deleteFile('A.md'), true);
  assert.equal(v.deleteFile('A.md'), false);
}));

test('moveFile does not clobber and moveCaseOnly changes only the case', () => tmpVault((v) => {
  v.createFile('A.md', Buffer.from('a'));
  v.createFile('B.md', Buffer.from('b'));
  assert.throws(() => v.moveFile('A.md', 'B.md'), ExistsError);
  assert.equal(fs.readFileSync(path.join(v.root, 'B.md'), 'utf8'), 'b');
  v.moveFile('A.md', 'C.md');
  assert.deepEqual(fs.readdirSync(v.root).filter((n) => n.endsWith('.md')).sort(), ['B.md', 'C.md']);
  v.moveCaseOnly('C.md', 'c.md');
  assert.deepEqual(fs.readdirSync(v.root).filter((n) => n.endsWith('.md')).sort(), ['B.md', 'c.md']);
  assert.equal(fs.readFileSync(path.join(v.root, 'c.md'), 'utf8'), 'a');
}));

test('the lock is taken, refused while a live pid holds it, and taken over when stale', () => tmpVault((v) => {
  v.acquireLock();
  assert.equal(fs.readFileSync(v.lockPath, 'utf8'), String(process.pid));
  v.acquireLock(); // our own pid: taken over
  fs.writeFileSync(v.lockPath, String(process.ppid));
  assert.throws(() => v.acquireLock(), (e) => e.message === `Another wiki server is using ${v.root}`);
  fs.writeFileSync(v.lockPath, '2147483000');
  v.acquireLock();
  assert.equal(fs.readFileSync(v.lockPath, 'utf8'), String(process.pid));
  fs.writeFileSync(v.lockPath, 'garbage');
  v.acquireLock();
  v.releaseLock();
  assert.equal(fs.existsSync(v.lockPath), false);
  fs.writeFileSync(v.lockPath, String(process.ppid));
  v.releaseLock();
  assert.equal(fs.existsSync(v.lockPath), true, 'a lock held by another pid is not removed');
}));

test('removeStaleTmp deletes .wiki-*.tmp only', () => tmpVault((v) => {
  for (const n of ['.wiki-1-ab.tmp', '.wiki-2-cd.tmp', '.wiki-keep.txt', '.other.tmp', 'A.md']) fs.writeFileSync(path.join(v.root, n), '');
  v.removeStaleTmp();
  assert.deepEqual(fs.readdirSync(v.root).sort(), ['.other.tmp', '.wiki-keep.txt', 'A.md']);
}));
