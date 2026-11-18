'use strict';
const { createHash } = require('node:crypto');

const hashOf = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

function hashesFor(page, tag) {
  const out = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  let m;
  while ((m = re.exec(page)) !== null) out.push(hashOf(m[1]));
  return out;
}

// Headers for every response; `page` (HTML string) is used to hash inline script/style for the CSP.
function securityHeaders(page = '') {
  const scripts = hashesFor(String(page), 'script');
  const styles = hashesFor(String(page), 'style');
  const csp = [
    "default-src 'none'",
    `script-src ${scripts.length ? scripts.join(' ') : "'none'"}`,
    `style-src ${styles.length ? styles.join(' ') : "'none'"}`,
    "connect-src 'self'",
    "img-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  return {
    'content-security-policy': csp,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  };
}

module.exports = { securityHeaders };
