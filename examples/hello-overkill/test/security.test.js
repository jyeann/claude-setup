'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { securityHeaders } = require('../src/security');

const b64 = (s) => createHash('sha256').update(s).digest('base64');

test('CSP contains sha256 of the inline script and style', () => {
  const h = securityHeaders('<html><style>a{b:c}</style><script>var x=1;</script></html>');
  const csp = h['content-security-policy'];
  assert.ok(csp.includes(`script-src 'sha256-${b64('var x=1;')}'`));
  assert.ok(csp.includes(`style-src 'sha256-${b64('a{b:c}')}'`));
});

test('CSP carries the fixed restrictive directives', () => {
  const csp = securityHeaders('<script>1</script><style>a{}</style>')['content-security-policy'];
  for (const d of ["default-src 'none'", "connect-src 'self'", "img-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"]) assert.ok(csp.includes(d), d);
});

test('sets nosniff and no-referrer', () => {
  const h = securityHeaders('');
  assert.equal(h['x-content-type-options'], 'nosniff');
  assert.equal(h['referrer-policy'], 'no-referrer');
});

test('page without inline code gets none sources; multiple scripts all hashed', () => {
  assert.match(securityHeaders('<p>x</p>')['content-security-policy'], /script-src 'none'; style-src 'none'/);
  const csp = securityHeaders('<script>a</script><script type="module">b</script>')['content-security-policy'];
  assert.ok(csp.includes(`'sha256-${b64('a')}' 'sha256-${b64('b')}'`));
});

test('does not add CORS headers', () => {
  assert.equal(Object.keys(securityHeaders('x')).some((k) => k.startsWith('access-control')), false);
});
