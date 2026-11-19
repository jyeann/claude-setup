'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { html, styleHash, scriptHash } = require('../src/page');

const TESTIDS = ['nav-hello', 'nav-battle', 'nav-verify', 'status', 'name-input', 'language-select', 'tone-select', 'chaos-toggle', 'say-hello', 'name-error', 'result-empty', 'result-loading', 'greeting-text', 'visit-count', 'streak-count', 'cert-link', 'error-message', 'retry-btn', 'rate-limit-message', 'cert-name', 'cert-greeting', 'cert-date', 'cert-signature', 'cert-text', 'cert-copy', 'cert-verify-link', 'verify-input', 'verify-btn', 'verify-result', 'verify-verdict', 'battle-option-a', 'battle-option-b', 'battle-next', 'leaderboard', 'leaderboard-row', 'lb-greeting', 'lb-votes', 'view-title'];
const sha = (b) => `'sha256-${crypto.createHash('sha256').update(b, 'utf8').digest('base64')}'`;

test('exports html and quoted sha256 hashes', () => {
  assert.equal(typeof html, 'string');
  assert.match(styleHash, /^'sha256-[A-Za-z0-9+/=]+'$/);
  assert.match(scriptHash, /^'sha256-[A-Za-z0-9+/=]+'$/);
});

test('contains all 38 data-testids', () => {
  assert.equal(new Set(TESTIDS).size, 38);
  const missing = TESTIDS.filter((id) => !new RegExp(`data-testid="${id}"|'${id}'|'${id.replace(/-[ab]$/, '-')}'`).test(html));
  assert.deepEqual(missing, []);
});

test('language and tone options match the design catalogue', () => {
  const vals = (id) => [...html.match(new RegExp(`id="${id}"[^>]*>(.*?)</select>`, 's'))[1].matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(vals('language'), ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'sv', 'ja', 'sw']);
  assert.deepEqual(vals('tone'), ['formal', 'pirate', 'shakespearean', 'corporate']);
});

test('form controls, routes, live region and limits', () => {
  for (const id of ['name', 'language', 'tone', 'chaos', 'cert-input']) assert.match(html, new RegExp(`id="${id}"`));
  for (const r of ['#/hello', '#/battle', '#/verify', '#/certificate/']) assert.ok(html.includes(r), r);
  assert.match(html, /role="status"/);
  assert.match(html, /maxlength="40"/);
  assert.match(html, /<html lang="en"/);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.ok(html.includes('textContent'));
});

test('no unsafe sinks, inline handlers or style attributes', () => {
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(html));
  assert.ok(!/<[^>]+\son\w+\s*=/i.test(html));
  assert.ok(!/\sstyle\s*=\s*["']/i.test(html));
});

test('exactly one script and one style whose sha256 matches the exports', () => {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  assert.equal(scripts.length, 1);
  assert.equal(styles.length, 1);
  assert.equal(sha(scripts[0]), scriptHash);
  assert.equal(sha(styles[0]), styleHash);
});

test('script is syntactically valid', () => {
  const body = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(body));
});

test('control borders use a dedicated high-contrast --ctl-line token in both schemes', () => {
  assert.match(html, /--ctl-line:#767676/);
  assert.match(html, /prefers-color-scheme:dark\)\{:root\{[^}]*--ctl-line:#8a8a8a/);
  assert.match(html, /border:1px solid var\(--ctl-line\)/);
  assert.match(html, /color-scheme:light dark/);
});

test('submit buttons use aria-disabled instead of the disabled attribute', () => {
  assert.match(html, /button\[aria-disabled=true\]/);
  assert.ok(!/\.disabled\s*=/.test(html));
  assert.match(html, /isBusyBtn\(sayBtn\)/);
  assert.match(html, /isBusyBtn\(vBtn\)/);
});

test('shared error helpers, repeated-status re-announce and vote error association', () => {
  assert.match(html, /function errorText\(res/);
  assert.match(html, /function retrySeconds\(res/);
  assert.match(html, /statusEl\.textContent = ''/);
  assert.match(html, /aria-describedby', 'vote-error'/);
  assert.ok(!/result\.setAttribute\('aria-busy'/.test(html));
  assert.match(html, /vIn\.setAttribute\('aria-invalid', 'true'\)/);
});

test('route handler ignores query-only hash changes', () => {
  assert.match(html, /sig === lastSig/);
});

test('hello loading card is marked aria-busy while the greeting is requested', () => {
  const { html } = require('../src/page.js');
  assert.ok(html.includes("loading.setAttribute('aria-busy', 'true')"));
  assert.ok(html.includes("'result-loading'"));
  assert.ok(!html.includes('result.setAttribute(\'aria-busy\''));
});
