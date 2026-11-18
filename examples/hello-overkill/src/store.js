'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { CATALOGUE } = require('./greetings');

const MAX_CERTS = 10000;
const ID_RE = /^[a-f0-9]{16}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isInt = (n) => Number.isInteger(n) && n >= 1;
const str = (v) => typeof v === 'string';
const visitorKey = (name) => name.normalize('NFC').trim().toLowerCase();

const validVisitor = (v) => v && str(v.key) && str(v.displayName) && isInt(v.visits) && isInt(v.streak) && str(v.firstDay) && DAY_RE.test(v.firstDay) && str(v.lastDay) && DAY_RE.test(v.lastDay);
const validCert = (c) => c && ID_RE.test(c.id) && str(c.name) && str(c.greeting) && str(c.language) && str(c.date) && DAY_RE.test(c.date) && str(c.signature) && /^[0-9a-f]{64}$/.test(c.signature);

function createStore(file, now = Date.now, log = (m) => process.stderr.write(`${m}\n`)) {
  let visitors = new Map();
  let certificates = new Map();
  let votes = new Map();

  const today = () => new Date(now()).toISOString().slice(0, 10);
  const yesterday = () => new Date(now() - 86400000).toISOString().slice(0, 10);

  function load() {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
      if (e.code === 'ENOENT') return;
      return corrupt(e);
    }
    let data;
    try { data = JSON.parse(raw); } catch (e) { return corrupt(e); }
    if (!data || data.version !== 1 || !Array.isArray(data.visitors) || !Array.isArray(data.certificates) || !Array.isArray(data.votes)) return corrupt(new Error('bad shape'));
    for (const v of data.visitors) if (validVisitor(v)) visitors.set(v.key, { key: v.key, displayName: v.displayName, visits: v.visits, streak: v.streak, firstDay: v.firstDay, lastDay: v.lastDay });
    for (const c of data.certificates) if (validCert(c)) certificates.set(c.id, { id: c.id, name: c.name, greeting: c.greeting, language: c.language, date: c.date, signature: c.signature });
    for (const r of data.votes) if (Array.isArray(r) && CATALOGUE.has(r[0]) && isInt(r[1])) votes.set(r[0], r[1]);
    while (certificates.size > MAX_CERTS) certificates.delete(certificates.keys().next().value);
  }
  function corrupt() {
    const target = `${file}.corrupt-${now()}`;
    try { fs.renameSync(file, target); } catch { /* ignore */ }
    log(`data file unreadable, moved to ${target}; starting empty`);
    visitors = new Map(); certificates = new Map(); votes = new Map();
  }

  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    const data = { version: 1, visitors: [...visitors.values()], certificates: [...certificates.values()], votes: [...votes.entries()] };
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  }

  // Runs mutate(), persists, and restores the previous state if persisting throws.
  function transact(mutate) {
    const snap = { visitors: new Map(visitors), certificates: new Map(certificates), votes: new Map(votes) };
    try {
      const result = mutate();
      persist();
      return result;
    } catch (e) {
      ({ visitors, certificates, votes } = snap);
      log('could not save data file');
      throw e;
    }
  }

  load();

  return {
    // Records a visit + certificate in one persisted step. Returns { visit, streak }. Throws (after rollback) on persist failure.
    recordHello(name, cert) {
      return transact(() => {
        const key = visitorKey(name);
        const prev = visitors.get(key);
        const t = today();
        let streak = 1;
        if (prev) streak = prev.lastDay === t ? prev.streak : prev.lastDay === yesterday() ? prev.streak + 1 : 1;
        const rec = { key, displayName: name, visits: prev ? prev.visits + 1 : 1, streak, firstDay: prev ? prev.firstDay : t, lastDay: t };
        visitors.set(key, rec);
        certificates.set(cert.id, { id: cert.id, name: cert.name, greeting: cert.greeting, language: cert.language, date: cert.date, signature: cert.signature });
        while (certificates.size > MAX_CERTS) certificates.delete(certificates.keys().next().value);
        return { visit: rec.visits, streak: rec.streak };
      });
    },
    // Returns the certificate record or null (also for malformed ids).
    getCertificate(id) { return typeof id === 'string' && ID_RE.test(id) ? certificates.get(id) || null : null; },
    // Increments votes for id and persists; returns the new count. Throws after rollback on persist failure.
    vote(id) { return transact(() => { const n = (votes.get(id) || 0) + 1; votes.set(id, n); return n; }); },
    votes: () => new Map(votes),
    stats: () => ({ visitors: visitors.size, certificates: certificates.size }),
  };
}

module.exports = { createStore, MAX_CERTS };
