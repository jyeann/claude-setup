'use strict';
const { createHmac, timingSafeEqual } = require('node:crypto');

const ID_RE = /^[a-f0-9]{16}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SIG_RE = /^[0-9a-f]{64}$/;

function createSigner(secret) {
  const sign = ({ id, name, greeting, date }) =>
    createHmac('sha256', secret).update(JSON.stringify(['hello-overkill/v1', id, name, greeting, date])).digest('hex');

  // Compact JSON in fixed key order.
  const toText = ({ id, name, greeting, date, signature }) => JSON.stringify({ id, name, greeting, date, signature });

  // Returns { verdict: 'Authentic' } or { verdict: 'Forged', reason: 'mismatch'|'unreadable' }.
  function verifyText(text) {
    const unreadable = { verdict: 'Forged', reason: 'unreadable' };
    let o;
    try { o = JSON.parse(text); } catch { return unreadable; }
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return unreadable;
    const keys = ['id', 'name', 'greeting', 'date', 'signature'];
    for (const k of keys) if (typeof o[k] !== 'string') return unreadable;
    if (!DATE_RE.test(o.date) || !ID_RE.test(o.id) || !SIG_RE.test(o.signature)) return unreadable;
    const expected = Buffer.from(sign(o), 'hex');
    const given = Buffer.from(o.signature, 'hex');
    if (!timingSafeEqual(expected, given)) return { verdict: 'Forged', reason: 'mismatch' };
    // Reject texts that differ from the canonical rendering (extra keys, whitespace).
    if (toText(o) !== text) return { verdict: 'Forged', reason: 'mismatch' };
    return { verdict: 'Authentic' };
  }
  return { sign, toText, verifyText };
}

module.exports = { createSigner };
