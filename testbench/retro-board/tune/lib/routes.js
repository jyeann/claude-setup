'use strict';
// Extract "METHOD /path" pairs from a markdown design doc and normalise path parameters to :x.
// Handles `GET /a/:p`, `PUT` and `DELETE /a/:p/vote`, `GET|POST /x`, `{p}`, `<p>`, `[p]`.
const METHOD = '(?:GET|POST|PUT|PATCH|DELETE)';
const GROUP = new RegExp(`\\b(${METHOD}(?:[\\s\`*]*(?:,|/|\\||&|and|or)?[\\s\`*]*${METHOD})*)\\b[\\s\`*|]+\`?(/[^\\s\`'"()\\[\\],;{}<>]*(?:(?:<[^>\`]*>|\\{[^}\`]*\\}|\\[[^\\]\`]*\\])[^\\s\`'"()\\[\\],;{}<>]*)*)`, 'g');

function normalisePath(raw) {
  const clean = raw.split('?')[0].split('#')[0].replace(/[.:]+$/, (m) => (m.startsWith(':') ? m : ''));
  const segs = clean.split('/').filter((s, i) => i === 0 || s !== '');
  const norm = segs.map((s) => (/^:|^\{.*\}$|^<.*>$|^\[.*\]$|^\*/.test(s) ? ':x' : s)).join('/');
  return norm === '' ? '/' : norm.replace(/\/+$/, '') || '/';
}

function extractRoutes(md) {
  const out = new Set();
  for (const m of md.matchAll(GROUP)) {
    const methods = m[1].match(new RegExp(METHOD, 'g'));
    const p = normalisePath(m[2]);
    for (const method of methods) out.add(`${method} ${p}`);
  }
  return out;
}

module.exports = { extractRoutes, normalisePath };
