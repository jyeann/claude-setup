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

test('writeAtomic replaces content and leaves no tmp file', () => tmpVault((v) => {
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

test('writeAtomic keeps the existing mode and createFile uses 0644', () => tmpVault((v) => {
  v.createFile('A.md', Buffer.from('one'));
  assert.equal(fs.statSync(path.join(v.root, 'A.md')).mode & 0o777, 0o644);
  fs.chmodSync(path.join(v.root, 'A.md'), 0o600);
  v.writeAtomic('A.md', Buffer.from('two'));
  assert.equal(fs.statSync(path.join(v.root, 'A.md')).mode & 0o777, 0o600);
  fs.chmodSync(path.join(v.root, 'A.md'), 0o664);
  v.writeAtomic('A.md', Buffer.from('three'));
  assert.equal(fs.statSync(path.join(v.root, 'A.md')).mode & 0o777, 0o664);
}));

test('the lock file is never visible empty: it is linked into place from a tmp file that already holds the pid', () => tmpVault((v) => {
  const seen = [];
  const realLink = fs.linkSync;
  fs.linkSync = (from, to) => {
    if (to === v.lockPath) seen.push({ content: fs.readFileSync(from, 'utf8'), lockExists: fs.existsSync(v.lockPath) });
    return realLink(from, to);
  };
  try { v.acquireLock(); } finally { fs.linkSync = realLink; }
  assert.deepEqual(seen, [{ content: String(process.pid), lockExists: false }]);
  assert.equal(fs.readFileSync(v.lockPath, 'utf8'), String(process.pid));
  assert.deepEqual(dots(v).filter((n) => n.endsWith('.tmp')), []);
}));

test('an empty or unparsable lock is retried after 50 ms, not taken over at once', () => tmpVault((v) => {
  for (const initial of ['', 'garbage']) {
    fs.writeFileSync(v.lockPath, initial);
    const sleeps = [];
    v.sleepMs = (ms) => { sleeps.push(ms); fs.writeFileSync(v.lockPath, String(process.ppid)); }; // the real owner finishes writing
    assert.throws(() => v.acquireLock(), (e) => e.message === `Another wiki server is using ${v.root}`, JSON.stringify(initial));
    assert.deepEqual(sleeps, [50]);
    assert.equal(fs.readFileSync(v.lockPath, 'utf8'), String(process.ppid));
  }
}));

test('a lock that stays empty is taken over after a bounded number of retries', () => tmpVault((v) => {
  fs.writeFileSync(v.lockPath, '');
  const sleeps = [];
  v.sleepMs = (ms) => sleeps.push(ms);
  v.acquireLock();
  assert.ok(sleeps.length >= 1 && sleeps.length <= 10 && sleeps.every((ms) => ms === 50), String(sleeps));
  assert.equal(fs.readFileSync(v.lockPath, 'utf8'), String(process.pid));
}));

test('removeStaleTmp only deletes names this server makes: .wiki-<pid>-<8 hex>.tmp', () => tmpVault((v) => {
  const mine = ['.wiki-1-deadbeef.tmp', '.wiki-12345-0badf00d.tmp'];
  const others = ['.wiki-1-ab.tmp', '.wiki-x-deadbeef.tmp', '.wiki-1-DEADBEEF.tmp', '.wiki-1-deadbeef.tmp.bak', '.wiki-1-deadbeefff.tmp', '.wiki-keep.txt', '.other.tmp', 'A.md', '.wiki--deadbeef.tmp'];
  for (const n of [...mine, ...others]) fs.writeFileSync(path.join(v.root, n), '');
  v.removeStaleTmp();
  assert.deepEqual(fs.readdirSync(v.root).sort(), [...others].sort());
}));

test('readFile returns null for a FIFO without blocking', async () => {
  const { spawnSync } = await import('node:child_process');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-fifo-')));
  try {
    const v = openVault(path.join(base, 'v'));
    const mk = spawnSync('mkfifo', [path.join(v.root, 'P.md')]);
    if (mk.status !== 0) return;
    const script = `import { openVault } from ${JSON.stringify(new URL('../src/vault.js', import.meta.url).href)};
      console.log(String(openVault(${JSON.stringify(v.root)}).readFile('P.md')));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 5000, encoding: 'utf8' });
    assert.equal(r.status, 0, `timed out or failed: ${r.error || r.stderr}`);
    assert.equal(r.stdout.trim(), 'null');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
