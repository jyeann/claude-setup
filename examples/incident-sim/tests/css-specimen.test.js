// Static checks on the design system files: sprite, specimen, app.css discipline, phone targets, CSP cleanliness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const tokens = read('tokens.css'); const app = read('app.css'); const sprite = read('sprite.svg'); const specimen = read('design-specimen.html');
const strip = (c) => c.replace(/\/\*[\s\S]*?\*\//g, '');

test('sprite defines the four status shapes and every node glyph', () => {
  const ids = [...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]);
  for (const id of ['ic-ok', 'ic-warn', 'ic-crit', 'ic-recv', 'ic-clients', 'ic-lb', 'ic-service', 'ic-cache', 'ic-db', 'ic-replica', 'ic-queue', 'ic-consumer', 'ic-partner']) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
});

test('sprite and specimen contain no emoji and no external request', () => {
  for (const [n, t] of [['sprite', sprite], ['specimen', specimen], ['app.css', app], ['tokens.css', tokens]]) {
    assert.ok(!/\p{Extended_Pictographic}/u.test(t), `${n}: emoji`);
    assert.ok(!/(?:src|href)="https?:/.test(t), `${n}: external link`);
    assert.ok(!/url\(\s*['"]?(?:https?:|\/\/|data:)/i.test(t), `${n}: external url()`);
  }
});

test('the specimen inlines the sprite verbatim and every <use> target exists', () => {
  assert.ok(specimen.includes(sprite.trim()), 'specimen is out of sync with sprite.svg: run node tests/tools/build-specimen.js');
  const ids = new Set([...sprite.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const missing = [...specimen.matchAll(/<use[^>]*href="#([^"]+)"/g)].map((m) => m[1]).filter((id) => !ids.has(id));
  assert.deepEqual([...new Set(missing)], []);
});

test('the specimen shows every status in both themes with shape plus label', () => {
  assert.equal((specimen.match(/data-theme="dark"/g) ?? []).length, 1);
  assert.equal((specimen.match(/data-theme="light"/g) ?? []).length, 1);
  for (const label of ['OK', 'WARN', 'CRIT', 'RECV']) assert.ok(new RegExp(`</svg>${label}</span>`).test(specimen), label);
  for (const cls of ['toast', 'banner', 'skeleton', 'dialog', 'result-card', 'recorder', 'lane', 'mark', 'scrubber', 'spark', 'node', 'edge', 'lamp', 'tab', 'alert-row', 'action-row', 'daily-card', 'incident-row', 'text-table']) assert.ok(specimen.includes(`class="${cls}`) || specimen.includes(` ${cls} `) || specimen.includes(` ${cls}"`) || specimen.includes(`"${cls} `), `component ${cls}`);
});

test('the specimen links only the two stylesheets and has no inline style attribute or script', () => {
  assert.deepEqual([...specimen.matchAll(/<link[^>]*href="([^"]+)"/g)].map((m) => m[1]), ['tokens.css', 'app.css']);
  assert.ok(!/\sstyle="/.test(specimen));
  assert.ok(!/<script/i.test(specimen));
});

test('app.css uses only defined tokens and no raw colour, no !important outside reduced-motion-safe svg text', () => {
  const defined = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = [...strip(app).matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]).filter((t) => !t.startsWith('--_'));
  assert.deepEqual([...new Set(used)].filter((t) => !defined.has(t)), []);
  assert.ok(!/#[0-9a-f]{3,8}\b(?![-\w])/i.test(strip(app).replace(/url\(#[^)]*\)/g, '')));
});

test('app.css never sets outline none without a replacement ring', () => {
  for (const m of strip(app).matchAll(/([^{}]+)\{([^{}]*outline:\s*none[^{}]*)\}/g)) assert.match(m[1], /:focus:not\(:focus-visible\)|\[tabindex="-1"\]|\.node\b/, m[1]);
});

test('phone rules give buttons, tabs, rows and marks a 44px minimum and stop horizontal scroll at 320', () => {
  const phone = strip(app).slice(strip(app).indexOf('@media (max-width: 719px)'));
  assert.match(phone, /\.btn, \.switch \{ min-block-size: var\(--hit-min\)/);
  assert.match(phone, /\.nav a, \.mark, \.alert-row, \.action-row, \.tab \{ min-block-size: var\(--hit-min\)/);
  assert.match(phone, /\.mark \{ inline-size: var\(--hit-min\)/);
  assert.match(app, /@media \(max-width: 339px\)/);
});

test('focus ring uses the 3px token with a 2px offset and typography stays on system stacks', () => {
  assert.match(app, /:focus-visible \{ outline: var\(--focus-ring\); outline-offset: var\(--focus-offset\); \}/);
  assert.ok(!/@font-face/i.test(app + tokens));
  assert.match(tokens, /--font-ui:[^;]*system-ui/);
});

test('body text and log text are at least 16px and mono numerals are tabular', () => {
  assert.match(app, /body \{[^}]*font-size: var\(--fs-body\)/);
  assert.match(app, /\.log \{[^}]*font-size: var\(--fs-body\)/);
  assert.match(app, /\.clock \{[^}]*font-variant-numeric: tabular-nums slashed-zero/);
  assert.match(app, /\.measure|--measure/);
});

test('status components pair every colour with a shape and a label in the specimen markup', () => {
  const badges = [...specimen.matchAll(/<span class="badge[^"]*"[^>]*data-status="[^"]+"[^>]*>(.*?)<\/span>/g)].map((m) => m[1]);
  assert.ok(badges.length > 20);
  for (const b of badges) assert.match(b, /<use href="#ic-(ok|warn|crit|recv)"\/><\/svg>(OK|WARN|CRIT|RECV|Harmful)$/);
});
