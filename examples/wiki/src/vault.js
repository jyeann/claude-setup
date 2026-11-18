// The only module that touches the vault folder.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { validateTitle } from '../public/js/titles.js';
import { StorageError, ExistsError } from './errors.js';

export const MAX_INDEXED_BYTES = 8 * 1024 * 1024;

const LOCK_NAME = '.wiki.lock';
const TMP_RE = /^\.wiki-.*\.tmp$/;
const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

export class VaultError extends Error {}

// Create (mkdir -p), realpath and open the vault. Throws VaultError("Cannot write to VAULT_DIR <path>").
export function openVault(dir) {
  const unusable = () => new VaultError(`Cannot write to VAULT_DIR ${dir}`);
  let root;
  try {
    fs.mkdirSync(dir, { recursive: true });
    root = fs.realpathSync(dir);
    if (!fs.statSync(root).isDirectory()) throw new Error('not a directory');
    fs.accessSync(root, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
  } catch {
    throw unusable();
  }
  return new Vault(root);
}

export class Vault {
  constructor(root) {
    this.root = root;
    this.lockPath = path.join(root, LOCK_NAME);
  }

  // Absolute path of a file directly inside the vault; refuses anything else.
  pathFor(filename) {
    const p = path.join(this.root, filename);
    if (path.dirname(p) !== this.root || path.basename(p) !== filename || filename === '' || filename === '.' || filename === '..') {
      throw new Error(`path escapes the vault: ${filename}`);
    }
    return p;
  }

  // Validated title to absolute path; the filename is always `<normalised title>.md`.
  titleToPath(title) {
    const v = validateTitle(title);
    if (!v.ok) throw new Error(`invalid title: ${v.code}`);
    return this.pathFor(`${v.title}.md`);
  }

  // ---- lock and boot ----
  acquireLock() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        fs.writeFileSync(this.lockPath, String(process.pid), { flag: 'wx' });
        return;
      } catch (e) {
        if (e.code !== 'EEXIST') throw new VaultError(`Cannot write to VAULT_DIR ${this.root}`);
      }
      const pid = Number.parseInt(this.readLockPid(), 10);
      if (pid !== process.pid && Number.isInteger(pid) && pid > 0 && isAlive(pid)) {
        throw new VaultError(`Another wiki server is using ${this.root}`);
      }
      try { fs.unlinkSync(this.lockPath); } catch { /* raced; retry */ }
    }
    throw new VaultError(`Another wiki server is using ${this.root}`);
  }

  readLockPid() {
    try { return fs.readFileSync(this.lockPath, 'utf8').trim(); } catch { return ''; }
  }

  releaseLock() {
    if (this.readLockPid() === String(process.pid)) {
      try { fs.unlinkSync(this.lockPath); } catch { /* already gone */ }
    }
  }

  removeStaleTmp() {
    for (const name of fs.readdirSync(this.root)) {
      if (TMP_RE.test(name)) {
        try { fs.unlinkSync(path.join(this.root, name)); } catch { /* ignore */ }
      }
    }
  }

  // ---- reading ----
  // Regular files directly in the vault whose names end in ".md" (not dotfiles, not symlinks).
  listFiles() {
    const out = [];
    for (const d of fs.readdirSync(this.root, { withFileTypes: true })) {
      const name = d.name;
      if (!d.isFile() || !name.endsWith('.md') || name.startsWith('.')) continue;
      try {
        const st = fs.lstatSync(path.join(this.root, name));
        if (st.isFile()) out.push({ filename: name, ino: st.ino, mtimeMs: st.mtimeMs, size: st.size });
      } catch { /* vanished */ }
    }
    return out;
  }

  // Fresh read of one file: {buf, ino, mtimeMs, size} or null when it is missing or not a regular file.
  readFile(filename) {
    let fd;
    try {
      fd = fs.openSync(this.pathFor(filename), fs.constants.O_RDONLY | O_NOFOLLOW);
      const st = fs.fstatSync(fd);
      if (!st.isFile()) return null;
      const buf = fs.readFileSync(fd);
      return { buf, ino: st.ino, mtimeMs: st.mtimeMs, size: buf.length };
    } catch (e) {
      if (['ENOENT', 'ELOOP', 'EISDIR', 'ENOTDIR'].includes(e.code)) return null;
      throw e;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  statFile(filename) {
    try {
      const st = fs.lstatSync(this.pathFor(filename));
      return st.isFile() ? { ino: st.ino, mtimeMs: st.mtimeMs, size: st.size } : null;
    } catch {
      return null;
    }
  }

  // Anything at all (file, folder, symlink) with this name?
  occupied(filename) {
    try {
      fs.lstatSync(this.pathFor(filename));
      return true;
    } catch {
      return false;
    }
  }

  // ---- writing ----
  tmpPath() {
    return path.join(this.root, `.wiki-${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
  }

  writeTmp(buf) {
    const tmp = this.tmpPath();
    let fd;
    try {
      fd = fs.openSync(tmp, 'wx', 0o644);
      fs.fchmodSync(fd, 0o644);
      fs.writeSync(fd, buf, 0, buf.length);
      fs.fsyncSync(fd);
    } catch (e) {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      throw new StorageError('Could not write the file.', e);
    }
    fs.closeSync(fd);
    return tmp;
  }

  syncDir() {
    try {
      const fd = fs.openSync(this.root, 'r');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    } catch { /* best effort */ }
  }

  // Atomic replace of an existing note file: tmp, fsync, rename. The old file survives a failure.
  writeAtomic(filename, buf) {
    const target = this.pathFor(filename);
    const tmp = this.writeTmp(buf);
    try {
      fs.renameSync(tmp, target);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      throw new StorageError('Could not write the file.', e);
    }
    this.syncDir();
  }

  // Create a new file without ever overwriting: tmp, hard link, unlink tmp. Throws ExistsError if the name is taken.
  createFile(filename, buf) {
    const target = this.pathFor(filename);
    const tmp = this.writeTmp(buf);
    try {
      try {
        fs.linkSync(tmp, target);
      } catch (e) {
        if (e.code === 'EEXIST') throw new ExistsError(filename);
        if (this.occupied(filename)) throw new ExistsError(filename);
        // No hard links on this filesystem: exists-check plus rename.
        fs.renameSync(tmp, target);
      }
    } catch (e) {
      if (e instanceof ExistsError) throw e;
      throw new StorageError('Could not create the file.', e);
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* renamed or gone */ }
    }
    this.syncDir();
  }

  // Remove one regular note file. Returns false when it is not there.
  deleteFile(filename) {
    const p = this.pathFor(filename);
    try {
      if (!fs.lstatSync(p).isFile()) return false;
      fs.unlinkSync(p);
      return true;
    } catch (e) {
      if (e.code === 'ENOENT') return false;
      throw new StorageError('Could not delete the file.', e);
    }
  }

  // Move without clobbering: hard link then unlink. Throws ExistsError if newName is taken.
  moveFile(oldName, newName) {
    const from = this.pathFor(oldName);
    const to = this.pathFor(newName);
    try {
      try {
        fs.linkSync(from, to);
      } catch (e) {
        if (e.code === 'EEXIST') throw new ExistsError(newName);
        if (this.occupied(newName)) throw new ExistsError(newName);
        fs.renameSync(from, to);
        return;
      }
      try {
        fs.unlinkSync(from);
      } catch (e) {
        try { fs.unlinkSync(to); } catch { /* ignore */ }
        throw e;
      }
    } catch (e) {
      if (e instanceof ExistsError) throw e;
      throw new StorageError('Could not move the file.', e);
    }
    this.syncDir();
  }

  // Case-only rename through a temporary name.
  moveCaseOnly(oldName, newName) {
    const from = this.pathFor(oldName);
    const to = this.pathFor(newName);
    const tmp = this.tmpPath();
    try {
      fs.renameSync(from, tmp);
    } catch (e) {
      throw new StorageError('Could not move the file.', e);
    }
    try {
      fs.renameSync(tmp, to);
    } catch (e) {
      try { fs.renameSync(tmp, from); } catch { /* ignore */ }
      throw new StorageError('Could not move the file.', e);
    }
    this.syncDir();
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== 'ESRCH';
  }
}
