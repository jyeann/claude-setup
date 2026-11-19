'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DomainError, MESSAGES, MAX_ITEMS } = require('./lists');
const { LIST_ID_RE, ITEM_ID_RE } = require('./ids');
const { validateName, validateItemText } = require('./validation');

const DEFAULT_MAX_LISTS = 10000;

// mkdir -p, write <file>.tmp-<pid>, fsync, close, rename over the file.
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
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
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function passes(fn, value) {
  try { fn(value); return true; } catch { return false; }
}

// Returns a normalised list or throws Error('shape') when the stored list is not acceptable.
function checkStoredList(key, list) {
  const bad = (why) => { throw new Error(`invalid list: ${why}`); };
  if (!isPlainObject(list)) bad('not an object');
  if (!LIST_ID_RE.test(key) || list.id !== key) bad('id');
  if (!passes(validateName, list.name)) bad('name');
  if (typeof list.createdAt !== 'string' && !Number.isFinite(list.createdAt)) bad('createdAt');
  if (!Number.isInteger(list.nextItemId) || list.nextItemId < 1) bad('nextItemId');
  if (!Array.isArray(list.items) || list.items.length > MAX_ITEMS) bad('items');
  const seen = new Set();
  let maxId = 0;
  for (const item of list.items) {
    if (!isPlainObject(item) || typeof item.id !== 'string' || !ITEM_ID_RE.test(item.id)) bad('item id');
    if (seen.has(item.id)) bad('duplicate item id');
    seen.add(item.id);
    if (!passes(validateItemText, item.text)) bad('item text');
    if (typeof item.ticked !== 'boolean') bad('ticked');
    maxId = Math.max(maxId, Number(item.id));
  }
  const items = list.items.map((i) => ({ id: i.id, text: i.text, ticked: i.ticked }));
  return {
    id: list.id, name: list.name, createdAt: list.createdAt,
    nextItemId: Math.max(list.nextItemId, maxId + 1), items,
  };
}

function parseStored(text) {
  const data = JSON.parse(text);
  if (!isPlainObject(data) || data.schema !== 1 || !isPlainObject(data.lists)) throw new Error('invalid shape');
  const lists = new Map();
  for (const [key, list] of Object.entries(data.lists)) lists.set(key, checkStoredList(key, list));
  return lists;
}

function createStore(file, { maxLists = DEFAULT_MAX_LISTS, log = (m) => process.stderr.write(`${m}\n`) } = {}) {
  let lists = new Map();

  function removeLeftoverTmp() {
    const dir = path.dirname(file);
    const prefix = `${path.basename(file)}.tmp-`;
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (name.startsWith(prefix)) { try { fs.unlinkSync(path.join(dir, name)); } catch { /* ignore */ } }
    }
  }

  function load() {
    removeLeftoverTmp();
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') { lists = new Map(); return; }
      return moveAside(`unreadable (${err.code || err.message})`);
    }
    try {
      lists = parseStored(text);
    } catch (err) {
      moveAside(err.message);
    }
  }

  function moveAside(reason) {
    lists = new Map();
    const target = `${file}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(file, target);
      log(`Data file was not valid (${reason}); moved to ${target}. Starting with no lists.`);
    } catch (err) {
      log(`Data file was not valid (${reason}) and could not be moved aside (${err.code || err.message}). Starting with no lists.`);
    }
  }

  function serialise(extra) {
    const out = {};
    for (const [id, list] of lists) out[id] = list;
    if (extra) out[extra.id] = extra;
    return JSON.stringify({ schema: 1, lists: out }, null, 2);
  }

  function persist(extra) {
    try {
      writeAtomic(file, serialise(extra));
    } catch (err) {
      throw new DomainError('storage_error', 503, MESSAGES.storage_error);
    }
  }

  return {
    load,
    get: (id) => lists.get(id),
    size: () => lists.size,
    create(list) {
      if (lists.size >= maxLists) throw new DomainError('storage_full', 503, MESSAGES.storage_full);
      if (lists.has(list.id)) throw new DomainError('storage_error', 503, MESSAGES.storage_error);
      const copy = structuredClone(list);
      persist(copy);
      lists.set(copy.id, copy);
      return copy;
    },
    // fn(copy) mutates a deep copy; it may throw. The copy replaces the stored list only after the write succeeded.
    update(id, fn) {
      const current = lists.get(id);
      if (!current) throw new DomainError('list_not_found', 404, MESSAGES.list_not_found);
      const copy = structuredClone(current);
      const result = fn(copy);
      persist(copy);
      lists.set(id, copy);
      return { list: copy, result };
    },
  };
}

module.exports = { createStore, writeAtomic, DEFAULT_MAX_LISTS };
