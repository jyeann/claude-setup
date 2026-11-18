'use strict';
const crypto = require('node:crypto');

const sha = (text) => `'sha256-${crypto.createHash('sha256').update(text).digest('base64')}'`;
const inline = (html, tag) => [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => sha(m[1]));

// Headers for every response. The page's inline script and style are allowed by hash, nothing else is.
function securityHeaders(html) {
  const csp = [
    "default-src 'none'",
    `script-src ${inline(html, 'script').join(' ') || "'none'"}`,
    `style-src ${inline(html, 'style').join(' ') || "'none'"}`,
    "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
  ].join('; ');
  return { 'content-security-policy': csp, 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' };
}

module.exports = { securityHeaders };
