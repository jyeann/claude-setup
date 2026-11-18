import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanCode, parseWikilinks, rewriteWikilinks } from '../public/js/wikilink.js';

const targets = (t) => parseWikilinks(t).map((l) => l.target);

test('scanCode returns inline spans as half-open ranges', () => {
  assert.deepEqual(scanCode('a `b` c'), [{ start: 2, end: 5 }]);
  assert.deepEqual(scanCode('``a`b`` `c`'), [{ start: 0, end: 7 }, { start: 8, end: 11 }]);
  assert.deepEqual(scanCode('no code'), []);
});

test('scanCode treats unmatched or cross-line backticks as literal', () => {
  assert.deepEqual(scanCode('a ` b'), []);
  assert.deepEqual(scanCode('`a\nb`'), []);
  assert.deepEqual(scanCode('``a` b'), []);
});

test('scanCode fences: open and close rules', () => {
  const t = 'x\n```\n[[A]]\n```\n[[B]]';
  assert.deepEqual(scanCode(t), [{ start: 2, end: 15 }]);
  assert.deepEqual(targets('~~~\n[[A]]\n~~~\n[[B]]'), ['B']);
  assert.deepEqual(targets('```\n[[A]]\n~~~\n[[B]]'), []);
  assert.deepEqual(targets('````\n[[A]]\n```\n[[B]]\n````\n[[C]]'), ['C']);
  assert.deepEqual(targets('```\n[[A]]\n``` x\n[[B]]'), []);
  assert.deepEqual(targets('   ```\n[[A]]\n   ```  \n[[B]]'), ['B']);
  assert.deepEqual(targets('    ```\n[[A]]'), ['A']);
});

test('scanCode: unclosed fence runs to the end', () => {
  const t = 'a\n```\nb';
  assert.deepEqual(scanCode(t), [{ start: 2, end: 7 }]);
});

test('parseWikilinks reports offsets, labels and trimmed lines', () => {
  const links = parseWikilinks('see [[ A ]] and [[B|x y ]] and [[C|]]\n  next [[D]]  ');
  assert.deepEqual(links.map((l) => [l.target, l.label]), [['A', null], ['B', 'x y'], ['C', ''], ['D', null]]);
  assert.deepEqual([links[0].start, links[0].end], [4, 11]);
  assert.equal(links[0].line, 'see [[ A ]] and [[B|x y ]] and [[C|]]');
  assert.equal(links[3].line, 'next [[D]]');
});

test('parseWikilinks drops empty targets, keeps invalid ones and skips code', () => {
  assert.deepEqual(targets('[[ ]] [[../x]] `[[Y]]` [[Z]]'), ['../x', 'Z']);
  assert.deepEqual(targets('[[A\nB]]'), []);
  assert.deepEqual(targets('[[[A]]]'), ['A']);
});

test('parseWikilinks cuts the line to 160 code points', () => {
  const l = parseWikilinks(`[[A]]${'\u{1F600}'.repeat(200)}`)[0].line;
  assert.equal([...l].length, 160);
});

test('rewriteWikilinks rewrites case variants and keeps labels untrimmed', () => {
  const r = rewriteWikilinks('[[Old]] [[ old ]] [[OLD| a b ]] [[Old|]] [[Other]]', 'old', 'New');
  assert.equal(r.text, '[[New]] [[New]] [[New| a b ]] [[New|]] [[Other]]');
  assert.equal(r.count, 4);
});

test('rewriteWikilinks leaves code, invalid targets and other bytes alone', () => {
  const t = '`[[Old]]`\r\n```\n[[Old]]\n```\n[[a:b]] [[Old]]\t ';
  const r = rewriteWikilinks(t, 'old', 'N$&');
  assert.equal(r.text, '`[[Old]]`\r\n```\n[[Old]]\n```\n[[a:b]] [[N$&]]\t ');
  assert.equal(r.count, 1);
  assert.deepEqual(rewriteWikilinks('[[a:b]]', 'a:b', 'X'), { text: '[[a:b]]', count: 0 });
});
