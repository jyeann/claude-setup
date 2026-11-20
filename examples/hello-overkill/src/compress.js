'use strict';
// Content negotiation for the static page: a gzip variant computed once at startup, a strong ETag,
// and parsing of Accept-Encoding / If-None-Match. Pure functions, no I/O.
const zlib = require('node:zlib');
const crypto = require('node:crypto');

// Returns the q value (0..1) for each coding named in an Accept-Encoding header.
function codings(header) {
  const out = new Map();
  for (const part of String(header || '').split(',')) {
    const [name, ...params] = part.split(';').map((s) => s.trim());
    if (!name) continue;
    let q = 1;
    for (const p of params) {
      const m = /^q\s*=\s*(.*)$/i.exec(p);
      if (m) q = /^(0(\.\d{0,3})?|1(\.0{0,3})?)$/.test(m[1]) ? Number(m[1]) : 0;
    }
    out.set(name.toLowerCase(), q);
  }
  return out;
}

function acceptsGzip(header) {
  const c = codings(header);
  for (const name of ['gzip', 'x-gzip']) if (c.has(name)) return c.get(name) > 0;
  return c.has('*') && c.get('*') > 0;
}

function prepareAsset(text) {
  const identity = Buffer.from(String(text), 'utf8');
  const gzip = zlib.gzipSync(identity, { level: 9 });
  const etag = `"${crypto.createHash('sha256').update(identity).digest('base64url').slice(0, 27)}"`;
  return { identity, gzip, etag };
}

function etagMatches(ifNoneMatch, etag) {
  if (!ifNoneMatch) return false;
  return String(ifNoneMatch).split(',').map((t) => t.trim().replace(/^W\//, '')).some((t) => t === '*' || t === etag);
}

module.exports = { acceptsGzip, prepareAsset, etagMatches };
