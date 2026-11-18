'use strict';
const nodeFs = require('node:fs');
const path = require('node:path');
const { DomainError, COLUMNS } = require('./validation');

const HASH_FILE = /^[0-9a-f]{64}\.json$/;

class BootError extends Error {}

// Write `<file>.tmp-<pid>`, fsync, rename over the target, fsync the directory (best effort).
function writeFileAtomic(fs, file, data, pid = process.pid) {
  const tmp = `${file}.tmp-${pid}`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);
  } catch (err) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
  try {
    const dfd = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
  } catch { /* best effort */ }
}

function validShape(b) {
  const isStr = (v) => typeof v === 'string';
  if (!b || typeof b !== 'object' || b.schema !== 1) return false;
  if (!isStr(b.facHash) || !isStr(b.title) || !isStr(b.createdAt) || typeof b.closed !== 'boolean') return false;
  if (!Number.isInteger(b.version) || b.version < 0 || !Number.isInteger(b.nextId) || b.nextId < 1) return false;
  if (!Array.isArray(b.cards)) return false;
  return b.cards.every((c) => c && /^\d+$/.test(c.id) && COLUMNS.includes(c.column) && isStr(c.text)
    && isStr(c.createdAt) && isStr(c.author) && Array.isArray(c.voters) && c.voters.every(isStr));
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function createStore({ dir, maxBoards = 1000, fs = nodeFs, pid = process.pid, now = Date.now, log = (m) => process.stderr.write(`${m}\n`) }) {
  const boardsDir = path.join(dir, 'boards');
  const lockFile = path.join(dir, '.lock');
  const boards = new Map();
  let locked = false;

  function takeLock() {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.writeFileSync(lockFile, String(pid), { flag: 'wx' });
        locked = true;
        return;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        const other = Number.parseInt(String(fs.readFileSync(lockFile, 'utf8')).trim(), 10);
        if (Number.isInteger(other) && other > 0 && pidAlive(other)) {
          throw new BootError(`Another retro board is using ${dir} (pid ${other})`);
        }
        fs.unlinkSync(lockFile); // stale
      }
    }
    throw new BootError(`Cannot take the lock in ${dir}`);
  }

  function open() {
    try {
      fs.mkdirSync(boardsDir, { recursive: true });
      const probe = path.join(dir, `.probe-${pid}`);
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
    } catch {
      throw new BootError(`Cannot write to DATA_DIR ${dir}`);
    }
    takeLock();
    for (const name of fs.readdirSync(boardsDir)) {
      if (name.includes('.tmp-')) fs.unlinkSync(path.join(boardsDir, name));
    }
    for (const name of fs.readdirSync(boardsDir)) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(boardsDir, name);
      let board = null;
      if (HASH_FILE.test(name)) {
        try { board = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { board = null; }
      }
      if (validShape(board)) {
        boards.set(name.slice(0, -5), board);
      } else {
        const aside = `${file}.corrupt-${now()}`;
        fs.renameSync(file, aside);
        log(`Corrupt board file moved aside: ${path.basename(aside)}`);
      }
    }
  }

  function persist(hash, board) {
    try {
      writeFileAtomic(fs, path.join(boardsDir, `${hash}.json`), JSON.stringify(board, null, 2), pid);
    } catch (e) {
      log(`Storage error: ${e.code || e.message}`);
      throw new DomainError('storage_error', 503, 'Could not save. Nothing changed.');
    }
  }

  return {
    open,
    get: (hash) => boards.get(hash),
    size: () => boards.size,
    create(hash, board) {
      if (boards.size >= maxBoards) throw new DomainError('storage_full', 503, 'No room for more boards.');
      persist(hash, board);
      boards.set(hash, board);
      return board;
    },
    // fn mutates a clone. Returning false means "no change": no version bump, no write.
    update(hash, fn) {
      const current = boards.get(hash);
      if (!current) throw new DomainError('board_not_found', 404, 'Board not found.');
      const draft = structuredClone(current);
      if (fn(draft) === false) return current;
      draft.version = current.version + 1;
      persist(hash, draft);
      boards.set(hash, draft);
      return draft;
    },
    close() {
      if (!locked) return;
      locked = false;
      try { fs.unlinkSync(lockFile); } catch { /* already gone */ }
    },
  };
}

module.exports = { createStore, writeFileAtomic, validShape, BootError };
