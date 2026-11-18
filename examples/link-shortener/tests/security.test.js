'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { securityHeaders } = require('../src/security');
const page = require('../src/page');

const sha = (t) => `'sha256-${crypto.createHash('sha256').update(t).digest('base64')}'`;

test('allows exactly the inline script and style by hash and nothing else', () => {
  const csp = securityHeaders('<style>a{}</style><script>var x=1</script>')['content-security-policy'];
  assert.ok(csp.includes(`script-src ${sha('var x=1')};`));
  assert.ok(csp.includes(`style-src ${sha('a{}')};`));
  assert.ok(csp.includes("default-src 'none'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
});

test('a page with no inline script or style gets script-src none', () => {
  const csp = securityHeaders('<p>hi</p>')['content-security-policy'];
  assert.ok(csp.includes("script-src 'none'"));
  assert.ok(csp.includes("style-src 'none'"));
});

test('sets nosniff, frame and referrer protections', () => {
  const h = securityHeaders(page);
  assert.equal(h['x-content-type-options'], 'nosniff');
  assert.equal(h['x-frame-options'], 'DENY');
  assert.equal(h['referrer-policy'], 'no-referrer');
});

test('the real page hashes match its inline script and style', () => {
  const csp = securityHeaders(page)['content-security-policy'];
  const script = /<script>([\s\S]*?)<\/script>/.exec(page)[1];
  const style = /<style>([\s\S]*?)<\/style>/.exec(page)[1];
  assert.ok(csp.includes(sha(script)));
  assert.ok(csp.includes(sha(style)));
});

test('the page has no inline style attributes or event handlers that the CSP would block', () => {
  assert.doesNotMatch(page, /\sstyle=/);
  assert.doesNotMatch(page, /\son[a-z]+=/);
  assert.doesNotMatch(page, /innerHTML/);
});
