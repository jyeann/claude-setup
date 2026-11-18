'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadAssets } = require('../src/http');

const publicDir = path.join(__dirname, '..', 'public');
const { pages, assets } = loadAssets(publicDir);
// Source text as the server would serve it, falling back to the file for anything not served.
const read = (f) => {
  const served = f.startsWith('js/') ? assets.get(`/assets/${f}`) : null;
  return served ? served.body.toString('utf8') : fs.readFileSync(path.join(publicDir, f), 'utf8');
};
assert.ok(pages && assets.size > 0, 'the server loads the public files');

test('export page shows the unsanitised-HTML notice with the exact text', () => {
  const html = read('export.html');
  assert.match(html, /<p id="export-notice"[^>]*>Card text is exported exactly as typed, including any HTML or links\. Paste it only into a tool that sanitises HTML\.<\/p>/);
});

test('export copy button has an aria-label starting with its visible word', () => {
  assert.match(read('export.html'), /id="copy-markdown"[^>]*aria-label="Copy markdown"/);
});

test('share copy buttons carry aria-labels that start with Copy', () => {
  const js = read('js/board.js');
  assert.match(js, /btnLabel: 'Copy participant link'/);
  assert.match(js, /btnLabel: 'Copy facilitator link'/);
});

test('the offline banner has role status and validation errors are announced assertively', () => {
  const board = read('js/board.js');
  assert.match(board, /id: 'offline-banner'[^\n]*role: 'status'/);
  assert.match(board, /function showError[\s\S]*?announceAssertive\(message\)[\s\S]*?\nfunction clearError/);
  assert.match(read('js/home.js'), /function showFieldError[\s\S]*?announceAssertive\(message\)/);
});

test('a failed load retry focuses the new retry button and poll render errors go to console.error', () => {
  const board = read('js/board.js');
  assert.match(board, /if \(focusRetry\) retry\.focus\(\)/);
  assert.match(board, /catch \(err\) \{\s*console\.error\(err\);/);
});
