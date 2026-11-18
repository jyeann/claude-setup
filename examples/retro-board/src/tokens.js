'use strict';
const crypto = require('node:crypto');

const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{22}$/;

// 128 bits, URL safe, 22 characters.
const newToken = () => crypto.randomBytes(16).toString('base64url');
const sha256Hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const sha256B64 = (s) => crypto.createHash('sha256').update(String(s)).digest('base64url');

// Compare two strings in constant time by comparing their 32-byte digests.
function safeEqual(a, b) {
  const da = crypto.createHash('sha256').update(String(a)).digest();
  const db = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(da, db);
}

const isToken = (s) => typeof s === 'string' && TOKEN_RE.test(s);
const isClientId = (s) => typeof s === 'string' && CLIENT_ID_RE.test(s);

module.exports = { TOKEN_RE, CLIENT_ID_RE, newToken, sha256Hex, sha256B64, safeEqual, isToken, isClientId };
