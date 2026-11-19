'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { lintDesign, normHex } = require('../lib/design-lint');

const CLI = path.join(__dirname, '..', 'bin', 'design-lint.js');
function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-lint-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}
const TOKENS = JSON.stringify({ color: { ink: { value: '#111827' }, accent: { value: '#E4572E' }, wash: { value: 'rgb(10, 20, 30)' } } });

test('does nothing when the project has no design record', () => {
  const dir = fixture({ 'a.css': 'a{color:#123456}' });
  assert.deepEqual(lintDesign(dir), { active: false, problems: [] });
  assert.equal(spawnSync('node', [CLI, dir]).status, 0);
});

test('accepts token colors in any case and short form, rejects raw colors with file and line', () => {
  const dir = fixture({
    'docs/design/tokens.json': TOKENS,
    'src/ok.css': 'a{color:#111827;background:#e4572e;border:1px solid rgb(10,20,30)}',
    'src/bad.css': 'a{color:var(--ink)}\nb{color:#ff00aa}\nc{color:rgb(1, 2, 3)}',
  });
  const { problems } = lintDesign(dir);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /src[\\/]bad\.css:2 raw color #ff00aa/);
  assert.match(problems[1], /bad\.css:3 raw color rgb\(1, 2, 3\)/);
  assert.equal(spawnSync('node', [CLI, dir]).status, 1);
});

test('skips docs, node_modules and lines marked design-lint-ignore', () => {
  const dir = fixture({
    'docs/design/tokens.json': TOKENS,
    'docs/x.css': 'a{color:#abcdef}',
    'node_modules/p/x.css': 'a{color:#abcdef}',
    'src/a.tsx': 'const c = "#abcdef"; // design-lint-ignore brand asset',
  });
  assert.deepEqual(lintDesign(dir).problems, []);
});

test('applies banned patterns from slop.rules.json and reports invalid rules', () => {
  const dir = fixture({
    'docs/design/tokens.json': TOKENS,
    'docs/design/slop.rules.json': JSON.stringify([{ id: 'gradient-text', pattern: 'background-clip:\\s*text', message: 'no gradient text' }, { id: 'broken', pattern: '(', message: 'x' }]),
    'src/h.css': 'h1{background-clip: text}',
  });
  const { problems } = lintDesign(dir);
  assert.ok(problems.some((p) => /h\.css:1 slop rule gradient-text/.test(p)));
  assert.ok(problems.some((p) => /rule broken has an invalid pattern/.test(p)));
});

test('normHex expands short hex and drops full alpha', () => {
  assert.equal(normHex('#ABC'), '#aabbcc');
  assert.equal(normHex('#112233FF'), '#112233');
});
