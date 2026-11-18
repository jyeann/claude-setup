'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { html, styleHash, scriptHash } = require('../src/page');

const V2 = {
  weather: ['nav-weather', 'weather-place-input', 'weather-date-input', 'weather-name-input', 'weather-go', 'weather-forecast', 'weather-greeting', 'weather-chance', 'weather-error'],
  wall: ['nav-wall', 'wall-list', 'wall-item', 'wall-status', 'wall-count', 'wall-empty'],
  sla: ['nav-sla', 'sla-uptime', 'sla-total-count', 'sla-error-rate', 'sla-p50', 'sla-p95', 'sla-p99', 'sla-hello-rate', 'sla-table', 'sla-row', 'sla-route', 'sla-count', 'sla-row-p95', 'sla-error'],
  'time-machine': ['nav-time-machine', 'tm-date-input', 'tm-name-input', 'tm-go', 'tm-era', 'tm-greeting', 'tm-streak', 'tm-error'],
  haiku: ['nav-haiku', 'haiku-name-input', 'haiku-theme-select', 'haiku-syllables-input', 'haiku-go', 'haiku-line', 'haiku-counts', 'haiku-error'],
  federation: ['nav-federation', 'fed-notice', 'fed-health-btn', 'fed-summary', 'fed-peer-row', 'fed-peer-origin', 'fed-peer-status', 'fed-name-input', 'fed-hello-btn', 'fed-result', 'fed-result-greeting', 'fed-result-error', 'fed-empty'],
};
const ALL = Object.values(V2).flat();
const has = (id) => new RegExp(`data-testid="${id}"|'${id}'`).test(html);
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const sha = (b) => `'sha256-${crypto.createHash('sha256').update(b, 'utf8').digest('base64')}'`;

test('v2 testid list has 58 unique entries', () => {
  assert.equal(ALL.length, 58);
  assert.equal(new Set(ALL).size, 58);
});

for (const [view, ids] of Object.entries(V2)) {
  test(`${view}: every spec data-testid exists in the page`, () => {
    assert.deepEqual(ids.filter((id) => !has(id)), []);
  });
}

test('nav links point at their hash routes and are real anchors', () => {
  for (const key of Object.keys(V2)) {
    assert.match(html, new RegExp(`<a href="#/${key}" data-testid="nav-${key}" id="nav-${key}">[^<]+</a>`), key);
    assert.match(html, new RegExp(`id="v-${key}"`), `section for ${key}`);
  }
});

test('v1 links stay in the primary nav, ahead of the v2 links in tab order', () => {
  const order = ['nav-hello', 'nav-battle', 'nav-verify', 'name-input', 'nav-weather'].map((id) => html.indexOf(`data-testid="${id}"`));
  assert.ok(order.every((n) => n > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order.slice(0, 4).concat(order[4]).sort((a, b) => a - b));
  assert.ok(html.indexOf('data-testid="say-hello"') < html.indexOf('data-testid="nav-weather"'));
});

test('unknown routes fall back to hello and every view key is routed', () => {
  assert.match(script, /location\.replace\('#\/hello'\)/);
  for (const key of Object.keys(V2)) assert.ok(script.includes(`'${key}'`), key);
});

test('fixed spec copy is present', () => {
  for (const t of ['Hello Weather', "Pick a place to see today's greeting forecast.", 'Connected', 'Reconnecting...', 'Wall is full, try later', 'Your name is sent to the listed peers.', 'No peers configured. Set HELLO_PEERS.', '5-7-5 verified']) assert.ok(html.includes(t), t);
  assert.match(html, /peer records a visit/);
});

test('federation warning, empty state and wall empty state are visible text, not hidden away', () => {
  assert.match(html, /<p id="fed-notice"[^>]*>[^<]*Your name is sent to the listed peers/);
  assert.match(html, /<p id="fed-empty"[^>]*hidden>/);
});

test('wall: EventSource on /api/stream, closed on leave and pagehide, capped at 50 rows', () => {
  assert.match(script, /new EventSource\('\/api\/stream'\)/);
  assert.match(script, /\.close\(\)/);
  assert.match(script, /addEventListener\('pagehide'/);
  assert.match(script, /onLeave\(stopWall\)/);
  assert.match(script, /children\.length > 50/);
  assert.match(script, /readyState === 2/);
  assert.match(script, /'Reconnecting\.\.\.'/);
});

test('wall never reads a name: only language, tone and milestone are used from events', () => {
  const fn = script.slice(script.indexOf('function wallAdd'), script.indexOf('function stopWall'));
  assert.ok(!/\.name\b|\.greeting\b|certificate/.test(fn));
  assert.match(fn, /d\.language/);
  assert.match(fn, /d\.tone/);
  assert.match(fn, /d\.milestone/);
});

test('sla: polls every 5000 ms, only while visible, and stops on leave', () => {
  assert.match(script, /setInterval\(function \(\) \{ if \(!document\.hidden && isCur\('sla'\)\) loadSla\(\); \}, 5000\)/);
  assert.match(script, /function stopSla\(\) \{ if \(slaTimer\) \{ clearInterval\(slaTimer\)/);
  assert.match(script, /onLeave\(stopSla\)/);
  assert.match(script, /'\/api\/sla'/);
  assert.match(script, /locked/);
});

test('route change runs the cleanup hooks before the next view starts', () => {
  const r = script.slice(script.indexOf('function route()'), script.indexOf('/* ---------- hello'));
  assert.ok(r.indexOf('runLeave()') > 0 && r.indexOf('runLeave()') < r.indexOf('startWall()'));
  assert.ok(r.indexOf('runLeave()') < r.indexOf('startSla()'));
});

test('every view calls its API', () => {
  for (const p of ['/api/weather', '/api/time-machine', '/api/haiku', '/api/federation', '/api/federation/hello']) assert.ok(script.includes(p), p);
  assert.match(html, /<input type="date" id="tm-date" data-testid="tm-date-input" min="1900-01-01"/);
  assert.match(script, /setAttribute\('max'/);
});

test('submit buttons of the new forms use aria-disabled and are guarded', () => {
  for (const b of ['wBtn', 'tmBtn', 'hBtn', 'fBtn']) assert.ok(script.includes(`isBusyBtn(${b})`), b);
  assert.ok(!/\.disabled\s*=/.test(html));
  assert.match(script, /function showErr\(/);
  assert.match(script, /setAttribute\('aria-invalid', 'true'\)/);
  assert.match(script, /setAttribute\('aria-busy', 'true'\)/);
});

test('announcements go through the shared say() and shared error helpers', () => {
  assert.equal(script.match(/statusEl\.textContent = (?!'')/g).length, 1, 'only say() writes the live region');
  assert.match(script, /function apiMsg\(res, generic\) \{[\s\S]*errorText\(res, generic\)/);
  assert.ok(!script.includes('retrySeconds(res) {') || script.match(/function retrySeconds/g).length === 1);
  assert.equal(script.match(/function errorText/g).length, 1);
});

test('untrusted data: textContent only, no unsafe sinks, no inline handlers or style attributes', () => {
  assert.ok(script.includes('textContent'));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|\.href\s*=|\.src\s*=/.test(html));
  assert.ok(!/<[^>]+\son\w+\s*=/i.test(html));
  assert.ok(!/\sstyle\s*=\s*["']/i.test(html));
  assert.ok(!/setAttribute\(\s*['"](?:href|src)['"]\s*,\s+(?!['"]#)\S/.test(script), 'href only set to hash routes');
  assert.ok(!/<(?:a|link|img|iframe)\b[^>]*\b(?:href|src)\s*=\s*["']https?:/i.test(html));
});

test('federation never links: no .href assignment, every setAttribute href starts with #/', () => {
  assert.ok(!/\.href\s*=(?!=)/.test(script), 'no .href = assignment');
  assert.ok(!/\[\s*['"]href['"]\s*\]\s*=/.test(script), 'no ["href"] = assignment');
  const calls = [...script.matchAll(/setAttribute\(\s*(['"])href\1\s*,\s*([^;]*)\)/g)];
  for (const m of calls) assert.match(m[2].trim(), /^(['"])#\//, `href argument: ${m[2]}`);
});

test('peer data goes through cleanText and is never used as a link', () => {
  const fed = script.slice(script.indexOf('/* ---------- federation'), script.indexOf("window.addEventListener('hashchange'"));
  assert.match(fed, /cleanText\(p\.origin/);
  assert.match(fed, /cleanText\(r\.greeting, 300\)/);
  assert.ok(!/createElement\('a'\)|el\('a'/.test(fed));
});

test('exactly one script and one style, hashes match the exports', () => {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  assert.equal(scripts.length, 1);
  assert.equal(styles.length, 1);
  assert.equal(sha(scripts[0]), scriptHash);
  assert.equal(sha(styles[0]), styleHash);
  assert.doesNotThrow(() => new Function(script));
});

test('styles: 44px targets, ctl-line borders, reflow, dark mode and print rules cover the new views', () => {
  assert.match(html, /input\[type=text\],input\[type=date\],input\[type=number\],select,textarea\{[^}]*min-height:44px[^}]*border:1px solid var\(--ctl-line\)/);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(html, /\.pre\{white-space:pre-line\}/);
  assert.match(html, /\.more\{/);
  assert.match(html, /@media \(max-width:480px\)/);
});

test('the 38 v1 testids are still there', () => {
  const v1 = ['nav-hello', 'nav-battle', 'nav-verify', 'status', 'name-input', 'language-select', 'tone-select', 'chaos-toggle', 'say-hello', 'name-error', 'result-empty', 'result-loading', 'greeting-text', 'visit-count', 'streak-count', 'cert-link', 'error-message', 'retry-btn', 'rate-limit-message', 'cert-name', 'cert-greeting', 'cert-date', 'cert-signature', 'cert-text', 'cert-copy', 'cert-verify-link', 'verify-input', 'verify-btn', 'verify-result', 'verify-verdict', 'battle-option-a', 'battle-option-b', 'battle-next', 'leaderboard', 'leaderboard-row', 'lb-greeting', 'lb-votes', 'view-title'];
  assert.equal(v1.length, 38);
  assert.deepEqual(v1.filter((id) => !has(id.replace(/-[ab]$/, (m) => m))), []);
});
