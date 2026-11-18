'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { CATALOGUE } = require('./greetings');

const MAX_CERTS = 10000;
const MAX_VISITORS = 10000;
const ID_RE = /^[a-f0-9]{16}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isInt = (n) => Number.isInteger(n) && n >= 1;
const str = (v) => typeof v === 'string';
const visitorKey = (name) => name.normalize('NFC').trim().toLowerCase();

const validVisitor = (v) => v && str(v.key) && str(v.displayName) && isInt(v.visits) && isInt(v.streak) && str(v.firstDay) && DAY_RE.test(v.firstDay) && str(v.lastDay) && DAY_RE.test(v.lastDay);
const validCert = (c) => c && ID_RE.test(c.id) && str(c.name) && str(c.greeting) && str(c.language) && str(c.date) && DAY_RE.test(c.date) && str(c.signature) && /^[0-9a-f]{64}$/.test(c.signature);

class PersistError extends Error {
  constructor(cause) { super('could not save data file'); this.name = 'PersistError'; this.cause = cause; }
}

// Throws on a read error other than ENOENT (the caller should exit 1); quarantines only unparseable / wrong-shape files.
function createStore(file, now = Date.now, log = (m) => process.stderr.write(`${m}\n`)) {
  let visitors = new Map();
  let certificates = new Map();
  let votes = new Map();

  const today = () => new Date(now()).toISOString().slice(0, 10);
  const yesterday = () => new Date(now() - 86400000).toISOString().slice(0, 10);

  // Evicts oldest entries beyond max; returns the evicted [key, value] pairs.
  function evict(map, max) {
    const out = [];
    while (map.size > max) { const k = map.keys().next().value; out.push([k, map.get(k)]); map.delete(k); }
    return out;
  }

  function load() {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return;
      throw e;
    }
    let data;
    try { data = JSON.parse(raw); } catch { return quarantine(); }
    if (!data || data.version !== 1 || !Array.isArray(data.visitors) || !Array.isArray(data.certificates) || !Array.isArray(data.votes)) return quarantine();
    for (const v of data.visitors) if (validVisitor(v)) visitors.set(v.key, { key: v.key, displayName: v.displayName, visits: v.visits, streak: v.streak, firstDay: v.firstDay, lastDay: v.lastDay });
    for (const c of data.certificates) if (validCert(c)) certificates.set(c.id, { id: c.id, name: c.name, greeting: c.greeting, language: c.language, date: c.date, signature: c.signature });
    for (const r of data.votes) if (Array.isArray(r) && CATALOGUE.has(r[0]) && isInt(r[1])) votes.set(r[0], r[1]);
    evict(certificates, MAX_CERTS);
    evict(visitors, MAX_VISITORS);
  }
  function quarantine() {
    const target = `${file}.corrupt-${now()}`;
    try {
      fs.renameSync(file, target);
      log(`data file unreadable, moved to ${target}; starting empty`);
    } catch (e) {
      log(`data file unreadable and could not be moved aside (${e.code || 'error'}); starting empty`);
    }
    visitors = new Map(); certificates = new Map(); votes = new Map();
  }

  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    const data = { version: 1, visitors: [...visitors.values()], certificates: [...certificates.values()], votes: [...votes.entries()] };
    try {
      fs.rmSync(tmp, { force: true });
      fs.writeFileSync(tmp, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      throw e;
    }
  }

  // Runs mutate(undo), persists, and replays the undo record (newest first) if mutating or persisting throws.
  // Only the touched entries are recorded, so cost does not grow with store size.
  function transact(mutate) {
    const undo = [];
    try {
      const result = mutate(undo);
      persist();
      return result;
    } catch (e) {
      for (let i = undo.length - 1; i >= 0; i -= 1) undo[i]();
      log('could not save data file');
      throw new PersistError(e);
    }
  }
  // Sets map[key] and records how to restore it.
  function put(undo, map, key, value) {
    const had = map.has(key);
    const old = map.get(key);
    map.set(key, value);
    undo.push(() => { if (had) map.set(key, old); else map.delete(key); });
  }
  // Evicts oldest beyond max and records a restore that keeps the original order.
  function capped(undo, map, max) {
    const gone = evict(map, max);
    if (gone.length) undo.push(() => { const rest = [...map]; map.clear(); for (const [k, v] of [...gone, ...rest]) map.set(k, v); });
  }

  load();

  return {
    // Records a visit + certificate in one persisted step. Returns { visit, streak }. Throws PersistError (after rollback) on persist failure.
    recordHello(name, cert) {
      return transact((undo) => {
        const key = visitorKey(name);
        const prev = visitors.get(key);
        const t = today();
        let streak = 1;
        if (prev) streak = prev.lastDay === t ? prev.streak : prev.lastDay === yesterday() ? prev.streak + 1 : 1;
        const rec = { key, displayName: name, visits: prev ? prev.visits + 1 : 1, streak, firstDay: prev ? prev.firstDay : t, lastDay: t };
        put(undo, visitors, key, rec);
        put(undo, certificates, cert.id, { id: cert.id, name: cert.name, greeting: cert.greeting, language: cert.language, date: cert.date, signature: cert.signature });
        capped(undo, certificates, MAX_CERTS);
        capped(undo, visitors, MAX_VISITORS);
        return { visit: rec.visits, streak: rec.streak };
      });
    },
    // Returns the certificate record or null (also for malformed ids).
    getCertificate(id) { return typeof id === 'string' && ID_RE.test(id) ? certificates.get(id) || null : null; },
    // Increments votes for id and persists; returns the new count. Throws PersistError after rollback on persist failure.
    vote(id) { return transact((undo) => { const n = (votes.get(id) || 0) + 1; put(undo, votes, id, n); return n; }); },
    // Read-only lookup: a copy of the visitor record or null. Never mutates or persists.
    peekVisitor(name) {
      if (typeof name !== 'string') return null;
      const v = visitors.get(visitorKey(name));
      return v ? { displayName: v.displayName, visits: v.visits, streak: v.streak, firstDay: v.firstDay, lastDay: v.lastDay } : null;
    },
    votes: () => new Map(votes),
    stats: () => ({ visitors: visitors.size, certificates: certificates.size }),
  };
}

module.exports = { createStore, PersistError, MAX_CERTS, MAX_VISITORS };
