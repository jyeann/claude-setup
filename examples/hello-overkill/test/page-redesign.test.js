'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { html, styleHash, scriptHash } = require('../src/page');
const { securityHeaders } = require('../src/security');

const V1 = ['nav-hello', 'nav-battle', 'nav-verify', 'status', 'name-input', 'language-select', 'tone-select', 'chaos-toggle', 'say-hello', 'name-error', 'result-empty', 'result-loading', 'greeting-text', 'visit-count', 'streak-count', 'cert-link', 'error-message', 'retry-btn', 'rate-limit-message', 'cert-name', 'cert-greeting', 'cert-date', 'cert-signature', 'cert-text', 'cert-copy', 'cert-verify-link', 'verify-input', 'verify-btn', 'verify-result', 'verify-verdict', 'battle-option-a', 'battle-option-b', 'battle-next', 'leaderboard', 'leaderboard-row', 'lb-greeting', 'lb-votes', 'view-title'];
const V2 = [
  'nav-weather', 'weather-place-input', 'weather-date-input', 'weather-name-input', 'weather-go', 'weather-forecast', 'weather-greeting', 'weather-chance', 'weather-error',
  'nav-wall', 'wall-list', 'wall-item', 'wall-status', 'wall-count', 'wall-empty',
  'nav-sla', 'sla-uptime', 'sla-total-count', 'sla-error-rate', 'sla-p50', 'sla-p95', 'sla-p99', 'sla-hello-rate', 'sla-table', 'sla-row', 'sla-route', 'sla-count', 'sla-row-p95', 'sla-error',
  'nav-time-machine', 'tm-date-input', 'tm-name-input', 'tm-go', 'tm-era', 'tm-greeting', 'tm-streak', 'tm-error',
  'nav-haiku', 'haiku-name-input', 'haiku-theme-select', 'haiku-syllables-input', 'haiku-go', 'haiku-line', 'haiku-counts', 'haiku-error',
  'nav-federation', 'fed-notice', 'fed-health-btn', 'fed-summary', 'fed-peer-row', 'fed-peer-origin', 'fed-peer-status', 'fed-name-input', 'fed-hello-btn', 'fed-result', 'fed-result-greeting', 'fed-result-error', 'fed-empty',
];
const HOOKS = ['theme-system', 'theme-light', 'theme-dark', 'greeting-ref', 'greeting-stamp', 'cert-sheet', 'cert-guilloche', 'cert-seal', 'cert-serial', 'cert-print', 'weather-meter', 'wall-lamp', 'sla-spark', 'tm-postmark', 'tm-rail', 'haiku-card', 'haiku-seal', 'fed-map'];
const COPY = ['Hello Weather', "Pick a place to see today's greeting forecast.", 'Connected', 'Reconnecting...', 'Wall is full, try later', 'Your name is sent to the listed peers.', 'No peers configured. Set HELLO_PEERS.', '5-7-5 verified'];

const hasTestId = (id) => new RegExp(`data-testid\\s*=\\s*["']${id}["']|['"\`]${id}['"\`]`).test(html);
const bodies = (tag) => [...html.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => m[1]);
const STYLE = bodies('style')[0] || '';
const SCRIPT = bodies('script')[0] || '';
const MARKUP = html.replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi, '').replace(/<style(?:\s[^>]*)?>[\s\S]*?<\/style>/gi, '');
const tagOf = (id) => {
  const at = html.search(new RegExp(`data-testid\\s*=\\s*"${id}"`));
  if (at < 0) return '';
  const start = html.lastIndexOf('<', at);
  return html.slice(start, html.indexOf('>', at) + 1);
};
const posOf = (id) => html.search(new RegExp(`data-testid\\s*=\\s*"${id}"`));

test('exposes one inline style and one inline script', () => {
  assert.equal((html.match(/<style\b/gi) || []).length, 1);
  assert.equal((html.match(/<script\b/gi) || []).length, 1);
  assert.ok(STYLE.length > 0 && SCRIPT.length > 0);
});

test('content-security-policy contains both the style hash and the script hash', () => {
  const csp = securityHeaders(html)['content-security-policy'];
  assert.match(styleHash, /^'sha256-[A-Za-z0-9+/=]+'$/);
  assert.match(scriptHash, /^'sha256-[A-Za-z0-9+/=]+'$/);
  assert.ok(csp.includes(styleHash), 'style hash');
  assert.ok(csp.includes(scriptHash), 'script hash');
});

test('has no style attributes and no inline event handler attributes', () => {
  assert.ok(!/<[^>]+\sstyle\s*=/i.test(MARKUP), 'style=');
  assert.ok(!/<[^>]+\son\w+\s*=/i.test(MARKUP), 'on*=');
});

test('stylesheet has no data: URIs, no url() and no @import', () => {
  assert.ok(!/data:/i.test(STYLE), 'data:');
  assert.ok(!/url\(/i.test(STYLE), 'url(');
  assert.ok(!/@import/i.test(html), '@import');
});

test('markup only uses url( for local gradient references', () => {
  const uses = MARKUP.match(/url\([^)]*\)/gi) || [];
  assert.deepEqual(uses.filter((u) => !/^url\(#/.test(u)), []);
});

test('no href or src points at an http or https URL', () => {
  assert.ok(!/\s(?:href|src)\s*=\s*["']?https?:/i.test(html));
});

test('script uses none of the banned DOM sinks', () => {
  for (const banned of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'xlink:href']) {
    assert.ok(!SCRIPT.includes(banned), banned);
  }
  assert.ok(!/\.href\s*=/.test(SCRIPT), '.href =');
  assert.ok(!SCRIPT.includes('.style.'), '.style.');
});

test('page has no use, textPath, link or img elements', () => {
  assert.ok(!/<use[\s>/]/i.test(html), '<use');
  assert.ok(!/<textPath[\s>/]/i.test(html), '<textPath');
  assert.ok(!/<link[\s>/]/i.test(html), '<link');
  assert.ok(!/<img[\s>/]/i.test(html), '<img');
});

test('script never uses template literal interpolation', () => {
  assert.ok(!SCRIPT.includes('${'));
});

test('every one of the 38 v1 and 58 v2 testids is present', () => {
  assert.equal(new Set(V1).size, 38);
  assert.equal(new Set(V2).size, 58);
  assert.deepEqual([...V1, ...V2].filter((id) => !hasTestId(id)), []);
});

test('every redesign hook testid is present', () => {
  assert.equal(HOOKS.length, 18);
  assert.deepEqual(HOOKS.filter((id) => !hasTestId(id)), []);
});

test('appearance fieldset holds three radios named theme', () => {
  const sets = [...html.matchAll(/<fieldset\b[^>]*>([\s\S]*?)<\/fieldset>/gi)].map((m) => m[1]);
  const appearance = sets.find((s) => /<legend\b[^>]*>\s*Appearance\s*<\/legend>/i.test(s));
  assert.ok(appearance, 'fieldset with legend Appearance');
  const radios = (appearance.match(/<input\b[^>]*>/gi) || []).filter((t) => /type\s*=\s*"radio"/i.test(t) && /name\s*=\s*"theme"/i.test(t));
  assert.equal(radios.length, 3);
  for (const id of ['theme-system', 'theme-light', 'theme-dark']) {
    const tag = tagOf(id);
    assert.match(tag, /type\s*=\s*"radio"/i, id);
    assert.match(tag, /name\s*=\s*"theme"/i, id);
  }
});

test('theme radios come after say-hello and after nav-federation in DOM order', () => {
  for (const id of ['theme-system', 'theme-light', 'theme-dark']) {
    assert.ok(posOf(id) > posOf('say-hello'), `${id} after say-hello`);
    assert.ok(posOf(id) > posOf('nav-federation'), `${id} after nav-federation`);
  }
});

test('nothing focusable appears before nav-hello', () => {
  const bodyAt = html.search(/<body\b/i);
  assert.ok(bodyAt >= 0, 'body element');
  const navAt = html.lastIndexOf('<', posOf('nav-hello'));
  assert.ok(navAt > bodyAt, 'nav-hello inside body');
  const before = html.slice(bodyAt, navAt);
  assert.ok(!/<(?:a|button|input|select|textarea)[\s>/]/i.test(before), 'focusable element before nav-hello');
  assert.ok(!/tabindex\s*=\s*["']?0/i.test(before), 'tabindex=0 before nav-hello');
});

test('declares light and dark colour schemes in a meta tag', () => {
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  assert.ok(metas.some((m) => /name\s*=\s*"color-scheme"/i.test(m) && /content\s*=\s*"light dark"/i.test(m)));
});

test('first script statement reads ho-theme inside try and accepts only light or dark', () => {
  const tryAt = SCRIPT.search(/\btry\s*\{/);
  assert.ok(tryAt >= 0, 'try block');
  assert.match(SCRIPT.slice(0, tryAt), /^\s*(?:\(\s*function\s*\(\s*\)\s*\{|\(\s*\(\s*\)\s*=>\s*\{|!\s*function\s*\(\s*\)\s*\{)?\s*(?:['"]use strict['"]\s*;?)?\s*$/, 'only an IIFE wrapper and use strict precede try');
  const readAt = SCRIPT.search(/localStorage\.getItem\(\s*['"]ho-theme['"]\s*\)/);
  assert.ok(readAt > tryAt, 'ho-theme read follows try');
  const guard = SCRIPT.match(/(\w+)\s*===\s*['"]light['"]\s*\|\|\s*\1\s*===\s*['"]dark['"]/);
  assert.ok(guard, 'accepts exactly light or dark');
  const guardAt = guard.index;
  assert.ok(guardAt > readAt);
  assert.ok(/\bcatch\b/.test(SCRIPT.slice(guardAt, guardAt + 300)), 'catch closes the try');
  const firstDom = SCRIPT.search(/getElementById|querySelector|createElement|addEventListener|document\.body/);
  assert.ok(firstDom < 0 || guardAt < firstDom, 'theme bootstrap precedes any DOM lookup');
});

test('stylesheet handles reduced motion, system dark, manual dark and print', () => {
  assert.ok(STYLE.includes('prefers-reduced-motion'));
  assert.match(STYLE, /prefers-color-scheme:\s*dark/);
  assert.match(STYLE, /@media\s+print/);
  assert.match(STYLE, /\[data-theme=["']?dark["']?\]/);
});

test('certificate guilloche svg carries at least 13 paths, each with pathLength 1', () => {
  const m = html.match(/<svg\b[^>]*data-testid\s*=\s*"cert-guilloche"[^>]*>([\s\S]*?)<\/svg>/i);
  assert.ok(m, 'cert-guilloche svg in markup');
  const paths = m[1].match(/<path\b[^>]*>/gi) || [];
  assert.ok(paths.length >= 13, `found ${paths.length} paths`);
  assert.deepEqual(paths.filter((p) => !/pathLength\s*=\s*"1"/.test(p)), []);
});

test('certificate seal carries its ring text glyphs in markup', () => {
  const m = html.match(/<svg\b[^>]*data-testid\s*=\s*"cert-seal"[^>]*>([\s\S]*?)<\/svg>/i);
  assert.ok(m, 'cert-seal svg in markup');
  assert.ok((m[1].match(/<text\b/gi) || []).length >= 26);
});

test('total html stays under 160000 characters', () => {
  assert.ok(html.length < 160000, `html is ${html.length} characters`);
});

test('shows Other departments as the secondary navigation label', () => {
  assert.ok(html.includes('Other departments'));
  assert.ok(!html.includes('More views'));
});

test('fixed v2 copy strings are present', () => {
  assert.equal(COPY.length, 8);
  assert.deepEqual(COPY.filter((c) => !html.includes(c)), []);
});
