// Project layout, package.json and token-file checks that need only the file system (spec.md "Layout", "Static design checks").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, PUBLIC_DIR, JS_DIR, walkFiles } from './helpers.js';

const names = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, '')).sort();

test('package.json: name incident-sim, ESM, node >= 22, start and test scripts, no dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'incident-sim');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.node, '>=22');
  assert.equal(pkg.scripts.start, 'node src/server.js');
  assert.ok(pkg.scripts.test.includes('acceptance/*.test.js') && pkg.scripts.test.includes('tests/*.test.js'));
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0);
  assert.ok(!pkg.devDependencies || Object.keys(pkg.devDependencies).length === 0);
});

test('src holds the five server modules and nothing in public/js/engine or core imports from src', () => {
  for (const n of ['server', 'config', 'http', 'router', 'scenarios-load']) assert.ok(fs.existsSync(path.join(APP_DIR, 'src', `${n}.js`)), `src/${n}.js`);
  for (const f of walkFiles(path.join(JS_DIR, 'engine')).concat(walkFiles(path.join(JS_DIR, 'core')))) {
    assert.ok(!/from\s+['"][^'"]*src\//.test(fs.readFileSync(f, 'utf8')), `${f} must not import server code`);
  }
});

test('public/js/engine holds exactly the 14 pinned modules', () => {
  assert.deepEqual(names(path.join(JS_DIR, 'engine')), ['catalogue', 'classify', 'conditions', 'engine', 'fingerprint', 'guides', 'hash', 'model', 'prng', 'replay', 'score', 'solver', 'template', 'validate']);
});

test('public/js/core holds the 15 pinned modules and public/js/dom the 15 DOM glue modules', () => {
  assert.deepEqual(names(path.join(JS_DIR, 'core')), ['announcer', 'daily', 'debrief-model', 'format', 'keys', 'layout', 'particles', 'progress', 'routes', 'safe-json', 'scheduler-math', 'settings', 'share', 'testmode', 'viewmodel']);
  assert.deepEqual(names(path.join(JS_DIR, 'dom')), ['about', 'board', 'data-page', 'debrief', 'dialogs', 'live', 'main', 'map-canvas', 'map-svg', 'panels', 'play', 'scheduler', 'shell', 'storage', 'text-view']);
});

test('public has index.html, tokens.css, app.css and favicon.svg', () => {
  for (const f of ['index.html', 'tokens.css', 'app.css', 'favicon.svg']) assert.ok(fs.existsSync(path.join(PUBLIC_DIR, f)), f);
});

test('tokens.css defines the dark :root plus light, contrast, reduced-motion and forced-colors blocks', () => {
  const css = fs.readFileSync(path.join(PUBLIC_DIR, 'tokens.css'), 'utf8');
  assert.match(css, /:root\s*\{/);
  assert.match(css, /@media\s*\(\s*prefers-color-scheme:\s*light\s*\)/);
  assert.match(css, /@media\s*\(\s*prefers-contrast:\s*(?:more|high|custom)\s*\)/);
  assert.match(css, /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
  assert.match(css, /@media\s*\(\s*forced-colors:\s*active\s*\)/);
  assert.ok((css.match(/--[a-z0-9-]+\s*:/g) ?? []).length >= 40, 'at least 40 custom properties');
});

test('app.css and tokens.css only use tokens that tokens.css defines', () => {
  const tokens = fs.readFileSync(path.join(PUBLIC_DIR, 'tokens.css'), 'utf8');
  const defined = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...fs.readFileSync(path.join(PUBLIC_DIR, 'app.css'), 'utf8').matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]));
  const undefinedTokens = [...used].filter((t) => !defined.has(t) && !t.startsWith('--_'));
  assert.deepEqual(undefinedTokens, []);
});

test('no token colour has a hue between 250 and 330 degrees (hex values in tokens.css)', () => {
  const css = fs.readFileSync(path.join(PUBLIC_DIR, 'tokens.css'), 'utf8');
  const bad = [];
  for (const m of css.matchAll(/#([0-9a-f]{6})\b/gi)) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
    if (d < 0.08) continue; // greys have no meaningful hue
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    if (h >= 250 && h <= 330) bad.push(`#${m[1]} hue ${Math.round(h)}`);
  }
  assert.deepEqual(bad, []);
});
