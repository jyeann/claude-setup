'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const e = require('../src/export');

const card = (id, column, text, voters = []) => ({ id: String(id), column, text, voters });
const bd = (title, cards) => ({ title, cards });

test('toMarkdown orders by votes then age and uses the checklist for Actions', () => {
  const md = e.toMarkdown(bd('Sprint 12', [
    card(1, 'went-well', 'old', []), card(2, 'went-well', 'top', ['a', 'b']),
    card(3, 'went-well', 'new', []), card(4, 'actions', 'do it', ['a']),
  ]), '2026-03-04');
  assert.equal(md, [
    '# Sprint 12', '', 'Date: 2026-03-04', '',
    '## Went well', '', '- top (2 votes)', '- old (0 votes)', '- new (0 votes)', '',
    '## To improve', '', '- _No cards._', '',
    '## Actions', '', '- [ ] do it (1 vote)', '',
  ].join('\n'));
});

test('toMarkdown sorts ids numerically so card 10 comes after card 9', () => {
  const md = e.toMarkdown(bd('T', [card(10, 'actions', 'ten'), card(9, 'actions', 'nine')]), 'D');
  assert.ok(md.indexOf('nine') < md.indexOf('ten'));
});

test('escapeLine flattens newlines and tabs and escapes leading markers only', () => {
  assert.equal(e.escapeLine('a\n\tb\r\nc'), 'a b c');
  for (const m of ['#', '-', '*', '>', '[', '+']) assert.equal(e.escapeLine(`${m} x`), `\\${m} x`);
  assert.equal(e.escapeLine('12. step'), '12\\. step');
  assert.equal(e.escapeLine('a - b # c'), 'a - b # c');
  assert.equal(e.escapeLine('<b>hi</b>'), '<b>hi</b>');
});

test('toMarkdown escapes a leading marker in the title and in card text', () => {
  const md = e.toMarkdown(bd('# Big', [card(1, 'went-well', '- nested')]), 'D');
  assert.ok(md.startsWith('# \\# Big\n'));
  assert.ok(md.includes('- \\- nested (0 votes)'));
});

test('filename slugifies, strips accents and falls back to retro.md', () => {
  assert.equal(e.filename('Sprint 12'), 'sprint-12.md');
  assert.equal(e.filename('  Café: Q&A!! '), 'cafe-q-a.md');
  assert.equal(e.filename('\u{1F600}'), 'retro.md');
  assert.ok(e.filename('a'.repeat(200)).length <= 63);
});

test('localIsoDate formats the local date with zero padding', () => {
  assert.equal(e.localIsoDate(new Date(2026, 0, 5)), '2026-01-05');
  assert.match(e.localIsoDate(), /^\d{4}-\d{2}-\d{2}$/);
});
