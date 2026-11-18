'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { withServer, LANGS, TONES } = require('./helpers');

const TESTIDS = ['nav-hello', 'nav-battle', 'nav-verify', 'status', 'name-input', 'language-select', 'tone-select', 'chaos-toggle', 'say-hello', 'name-error', 'result-empty', 'result-loading', 'greeting-text', 'visit-count', 'streak-count', 'cert-link', 'error-message', 'retry-btn', 'rate-limit-message', 'cert-name', 'cert-greeting', 'cert-date', 'cert-signature', 'cert-text', 'cert-copy', 'cert-verify-link', 'verify-input', 'verify-btn', 'verify-result', 'verify-verdict', 'battle-option-a', 'battle-option-b', 'battle-next', 'leaderboard', 'leaderboard-row', 'lb-greeting', 'lb-votes', 'view-title'];

const getPage = (s) => s.call('GET', '/');

test('the selector table in ux.md has 38 entries', () => {
  assert.equal(new Set(TESTIDS).size, 38);
});

test('GET / serves an HTML page with lang=en', () => withServer(async (s) => {
  const r = await getPage(s);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/html/);
  assert.match(r.text, /<html[^>]*\blang="en"/i);
  assert.match(r.text, /Hello Overkill/);
  assert.match(r.text, /Practice app\. We store only your name, visit counts and dates on this server\./);
}));

test('GET / contains every data-testid from the ux.md selector table', () => withServer(async (s) => {
  const { text } = await getPage(s);
  const missing = TESTIDS.filter((id) => !new RegExp(`data-testid\\s*=\\s*["']${id}["']|['"\`]${id}['"\`]`).test(text));
  assert.deepEqual(missing, []);
}));

test('GET / has the form control ids and the hash routes', () => withServer(async (s) => {
  const { text } = await getPage(s);
  for (const id of ['name', 'language', 'tone', 'chaos', 'cert-input']) assert.match(text, new RegExp(`id\\s*=\\s*["']${id}["']`), id);
  for (const route of ['#/hello', '#/battle', '#/verify', '#/certificate/']) assert.ok(text.includes(route), route);
  assert.match(text, /Say hello/);
  assert.match(text, /No greeting yet\. Say hello to someone\./);
  assert.match(text, /role\s*=\s*["']status["']/);
  assert.match(text, /maxlength\s*=\s*["']?40/i);
}));

test('page select options equal /api/catalogue (10 languages, 4 tones)', () => withServer(async (s) => {
  const { text } = await getPage(s);
  const cat = (await s.call('GET', '/api/catalogue')).body;
  for (const code of LANGS) assert.ok(text.includes(`value="${code}"`) || text.includes(`'${code}'`) || text.includes(`"${code}"`), code);
  for (const code of TONES) assert.ok(text.includes(`value="${code}"`) || text.includes(`'${code}'`) || text.includes(`"${code}"`), code);
  for (const l of cat.languages) assert.ok(text.includes(l.label), l.label);
  for (const t of cat.tones) assert.ok(text.includes(t.label), t.label);
}));

test('page writes dynamic text without innerHTML', () => withServer(async (s) => {
  const { text } = await getPage(s);
  assert.ok(text.includes('textContent'));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(text));
}));

test('page CSP locks everything down and hashes every inline script and style', () => withServer(async (s) => {
  const r = await getPage(s);
  const csp = r.headers.get('content-security-policy');
  assert.ok(csp, 'content-security-policy header present');
  for (const d of ["default-src 'none'", "connect-src 'self'", "img-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"]) assert.ok(csp.includes(d), d);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
  assert.match(csp, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.match(csp, /style-src 'sha256-[A-Za-z0-9+/=]+'/);
  const hash = (body) => `'sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}'`;
  const scripts = [...r.text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const styles = [...r.text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  assert.ok(scripts.length >= 1 && styles.length >= 1);
  for (const body of scripts) assert.ok(csp.includes(hash(body)), 'script hash in CSP');
  for (const body of styles) assert.ok(csp.includes(hash(body)), 'style hash in CSP');
  assert.ok(!/<[^>]+\son\w+\s*=/i.test(r.text), 'no inline event handlers');
  assert.ok(!/\sstyle\s*=\s*["']/i.test(r.text), 'no inline style attributes');
}));

test('page response has nosniff, no-referrer and no CORS headers', () => withServer(async (s) => {
  const r = await getPage(s);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(r.headers.get('access-control-allow-origin'), null);
}));
