// Contrast table (design-direction section 5, rows 1-26), token coverage and reduced-motion coverage.
// Reads public/tokens.css and public/app.css only. WCAG 2.x relative luminance is implemented here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const tokensCss = fs.readFileSync(path.join(PUBLIC, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// ---- minimal CSS block parser: returns [{ prelude, body, children }] (children for at-rules that nest rules)
function parseBlocks(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    let depth = 1; let j = open + 1;
    while (j < css.length && depth > 0) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    const body = css.slice(open + 1, j - 1);
    out.push({ prelude, body, children: prelude.startsWith('@') && body.includes('{') ? parseBlocks(body) : [] });
    i = j;
  }
  return out;
}
const decls = (body) => {
  const o = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) o[m[1]] = m[2].trim();
  return o;
};
const blocks = parseBlocks(tokensCss);
const rootBlock = blocks.find((b) => b.prelude.startsWith(':root'));
const dark = decls(rootBlock.body);
const lightMedia = blocks.find((b) => /prefers-color-scheme:\s*light\)\s*$/.test(b.prelude)).children[0];
const light = { ...dark, ...decls(lightMedia.body) };
const lightWrapper = decls(blocks.find((b) => b.prelude === '[data-theme="light"]').body);
const contrastMore = blocks.find((b) => /^@media\s*\(prefers-contrast:\s*more\)\s*$/.test(b.prelude)).children[0];
const contrastMoreLight = blocks.find((b) => /prefers-contrast:\s*more\)\s*and\s*\(prefers-color-scheme:\s*light/.test(b.prelude)).children[0];

// ---- WCAG
function lum(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const STATUS = ['ok', 'warn', 'crit', 'recv'];
const rows = []; // { id, fg, bg, min }
const add = (id, fg, bg, min) => rows.push({ id, fg, bg, min });
for (const [n, fg, bg] of [[1, 'text', 'bg-0'], [2, 'text', 'bg-1'], [3, 'text', 'bg-2'], [4, 'text-muted', 'bg-0'], [5, 'text-muted', 'bg-1'], [6, 'text-muted', 'bg-2']]) add(n, `--c-${fg}`, `--c-${bg}`, 4.5);
for (const [n, bg] of [[7, 'bg-0'], [11, 'bg-2']]) add(n, '--c-ok', `--c-${bg}`, 4.5);
for (const [n, bg] of [[8, 'bg-0'], [12, 'bg-2']]) add(n, '--c-warn', `--c-${bg}`, 4.5);
for (const [n, bg] of [[9, 'bg-0'], [13, 'bg-2']]) add(n, '--c-crit', `--c-${bg}`, 4.5);
for (const [n, bg] of [[10, 'bg-0'], [14, 'bg-2']]) add(n, '--c-recv', `--c-${bg}`, 4.5);
for (const s of STATUS) {
  add(`15 ${s}`, `--c-${s}`, `--c-${s}-tint`, 4.5);
  add(`16 ${s}`, '--c-text', `--c-${s}-tint`, 4.5);
  add(`17 ${s}`, '--c-text-muted', `--c-${s}-tint`, 4.5);
  add(`18 ${s}`, '--c-on-status', `--c-${s}`, 4.5);
}
add(19, '--c-primary-fg', '--c-primary-bg', 4.5);
add(20, '--c-line-ui', '--c-bg-1', 3);
add(21, '--c-line-ui', '--c-bg-2', 3);
add(22, '--c-edge', '--c-bg-0', 3);
add(23, '--c-edge', '--c-bg-1', 3);
for (const bg of ['bg-0', 'bg-1', 'bg-2']) add(`24 ${bg}`, '--c-focus', `--c-${bg}`, 3);
add(25, '--c-dot', '--c-bg-0', 3);
add(26, '--c-text-disabled', '--c-bg-2', 3);
// Extra rows this build relies on: lamp-on and status borders on panels, and the hatch-bearing tints under crit text.
add('27 lamp', '--c-lamp-on', '--c-bg-1', 3);
for (const s of STATUS) add(`28 ${s} on bg-1`, `--c-${s}`, '--c-bg-1', 4.5);

test('contrast table has 26 numbered rows plus the extras', () => {
  const ids = new Set(rows.map((r) => String(r.id).split(' ')[0]));
  for (let n = 1; n <= 26; n++) assert.ok(ids.has(String(n)), `row ${n}`);
});

for (const [theme, t] of [['dark', dark], ['light', light]]) {
  test(`every contrast pair meets its minimum in the ${theme} theme`, () => {
    const fails = [];
    for (const r of rows) {
      const fg = t[r.fg]; const bg = t[r.bg];
      assert.match(fg ?? '', /^#[0-9a-f]{6}$/i, `${r.fg} is a hex colour`);
      assert.match(bg ?? '', /^#[0-9a-f]{6}$/i, `${r.bg} is a hex colour`);
      const c = ratio(fg, bg);
      if (c < r.min) fails.push(`row ${r.id}: ${r.fg} ${fg} on ${r.bg} ${bg} = ${c.toFixed(2)} (< ${r.min})`);
    }
    assert.deepEqual(fails, []);
  });
}

test('prefers-contrast: more keeps muted text at or above 7:1 on every surface in both themes', () => {
  const dm = { ...dark, ...decls(contrastMore.body) };
  const lm = { ...light, ...decls(contrastMoreLight.body) };
  for (const [name, t] of [['dark', dm], ['light', lm]]) {
    for (const bg of ['bg-0', 'bg-1', 'bg-2']) assert.ok(ratio(t['--c-text-muted'], t[`--c-${bg}`]) >= 7, `${name} muted on ${bg}`);
    assert.ok(ratio(t['--c-edge'], t['--c-bg-0']) >= 3, `${name} edge`);
  }
});

test('forced light wrapper theme equals the prefers-color-scheme light block', () => {
  const media = decls(lightMedia.body);
  assert.deepEqual(Object.keys(lightWrapper).sort(), Object.keys(media).sort());
  for (const k of Object.keys(media)) assert.equal(lightWrapper[k], media[k], k);
});

test('light theme overrides every colour token the dark theme defines', () => {
  const colourTokens = Object.keys(dark).filter((k) => /^#[0-9a-f]{6}$/i.test(dark[k]));
  const media = decls(lightMedia.body);
  // Tokens that are intentionally the same in both themes (none today): list them here if that changes.
  const missing = colourTokens.filter((k) => !(k in media));
  assert.deepEqual(missing, []);
});

// ---- token coverage: every token named in design-direction section 4 exists
const SECTION_4 = `--c-bg-0 --c-bg-1 --c-bg-2 --c-line-soft --c-line-ui --c-edge --c-text --c-text-muted --c-text-disabled --c-focus --c-primary-bg --c-primary-fg --c-lamp-on
--c-ok --c-warn --c-crit --c-recv --c-ok-tint --c-warn-tint --c-crit-tint --c-recv-tint --c-on-status --c-dot --dot-r --dot-r-error --dot-speed --dot-rate-base --dot-rate-max --dot-cap --pile-max --dim-alpha
--glow-ok --glow-warn --glow-crit --glow-recv --glow-lamp --font-ui --font-mono --fw-regular --fw-strong --fw-heavy --fs-label --fs-body --fs-lead --fs-h3 --fs-h2 --fs-h1 --fs-clock --fs-score
--lh-body --lh-tight --track-label --track-head --measure --sp-1 --sp-2 --sp-3 --sp-4 --sp-5 --sp-6 --sp-7 --sp-8 --header-h --rail-w --node-w --node-h --hit-min --hit-min-desktop
--r-1 --r-2 --r-3 --elev-0 --elev-1 --elev-2 --elev-3 --focus-w --focus-offset --focus-ring --dur-fast --dur-base --dur-slow --dur-signal --dur-shake --stagger-clear --ease-out --ease-in --ease-std --metric-step-reduced`.split(/\s+/);

test('every token named in design-direction section 4 is defined in the dark :root', () => {
  assert.deepEqual(SECTION_4.filter((k) => !(k in dark)), []);
});

test('the pinned values of section 4 match', () => {
  const pin = { '--c-bg-0': '#0b0f14', '--c-ok': '#3ddbb0', '--c-warn': '#f5b83d', '--c-crit': '#ff6f59', '--c-recv': '#6cb8ff', '--c-primary-bg': '#f4efe6', '--dot-cap': '500', '--dur-fast': '150ms', '--dur-base': '200ms',
    '--dur-slow': '250ms', '--dur-signal': '600ms', '--dur-shake': '300ms', '--stagger-clear': '300ms', '--header-h': '56px', '--rail-w': '360px', '--measure': '72ch', '--hit-min': '44px', '--focus-w': '3px', '--focus-offset': '2px' };
  for (const [k, v] of Object.entries(pin)) assert.equal(dark[k], v, k);
});

test('JS-read numeric tokens are unitless', () => {
  for (const k of ['--dot-r', '--dot-r-error', '--dot-speed', '--dot-rate-base', '--dot-rate-max', '--dot-cap', '--pile-max', '--dim-alpha', '--metric-step-reduced']) assert.match(dark[k], /^[0-9.]+$/, k);
});

test('tokens.css has no web font, no import and no url()', () => {
  assert.ok(!/@font-face|@import|url\(/i.test(tokensCss));
});

test('the contrast-more block raises the focus ring to 4px', () => {
  assert.equal(decls(contrastMore.body)['--focus-w'], '4px');
});

// ---- app.css: token discipline and reduced motion
const appPath = path.join(PUBLIC, 'app.css');
const hasApp = fs.existsSync(appPath);
const appCss = hasApp ? fs.readFileSync(appPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') : '';

test('app.css exists and uses only var(--token) colours (no hex, no rgb literals, no font-face)', { skip: !hasApp }, () => {
  assert.ok(!/#[0-9a-f]{3,8}\b(?![-\w])/i.test(appCss.replace(/url\(#[^)]*\)/g, '')), 'hex colour');
  assert.ok(!/\brgba?\(|\bhsla?\(/i.test(appCss), 'rgb/hsl literal');
  assert.ok(!/@font-face|@import/i.test(appCss));
});

test('every animation and keyframe is listed in the reduced-motion kill switch or has an explicit static replacement', { skip: !hasApp }, () => {
  const keyframes = [...appCss.matchAll(/@keyframes\s+([a-z0-9-]+)/gi)].map((m) => m[1]);
  assert.ok(keyframes.length >= 3, 'pulse, shake and recovery ring exist');
  for (const k of ['pulse', 'shake', 'recv-ring']) assert.ok(keyframes.includes(k), `@keyframes ${k}`);
  // global kill switch in tokens.css
  assert.match(tokensCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*animation:\s*none\s*!important[\s\S]*transition-duration:\s*0s\s*!important/);
  // static replacements in app.css for each animated signal
  const rm = parseBlocks(appCss).filter((b) => /prefers-reduced-motion:\s*reduce/.test(b.prelude)).map((b) => b.body).join('\n');
  for (const sel of ['data-new', 'data-just-crit', 'data-just-recv', 'toast']) assert.ok(rm.includes(sel), `reduced-motion replacement for ${sel}`);
});

test('transitions use only the 150/200/250ms duration tokens and animations use the signal tokens', { skip: !hasApp }, () => {
  assert.ok(!/transition[^;{}]*\b\d+m?s\b/.test(appCss), 'no literal transition durations');
  for (const m of appCss.matchAll(/animation(?:-duration)?\s*:\s*([^;]+);/g)) assert.match(m[1], /var\(--dur-(signal|shake|base)\)|^none$/, m[1]);
  for (const m of appCss.matchAll(/transition(?:-property)?\s*:\s*([^;]+);/g)) assert.ok(!/\ball\b/.test(m[1]), `no transition: all (${m[1]})`);
});

test('animated properties are transform and opacity only', { skip: !hasApp }, () => {
  for (const m of appCss.matchAll(/@keyframes\s+[a-z0-9-]+\s*\{([\s\S]*?\}\s*)\}/gi)) {
    const props = [...m[1].matchAll(/([a-z-]+)\s*:/g)].map((x) => x[1]);
    for (const p of props) assert.ok(['transform', 'opacity'].includes(p), `keyframe property ${p}`);
  }
});

test('no hue of any token hex lies between 250 and 330 degrees', () => {
  const bad = [];
  for (const [k, v] of Object.entries({ ...dark, ...light })) {
    if (!/^#[0-9a-f]{6}$/i.test(v)) continue;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const d = mx - mn;
    if (d < 0.08) continue;
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    if (h >= 250 && h <= 330) bad.push(`${k} ${v} hue ${Math.round(h)}`);
  }
  assert.deepEqual(bad, []);
});
