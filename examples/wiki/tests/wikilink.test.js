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

// The previous quadratic algorithm, kept as the reference for the differential test.
function oldInlineSpans(line, base, out) {
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') { i += 1; continue; }
    let n = 0;
    while (line[i + n] === '`') n += 1;
    let j = i + n;
    let close = -1;
    while (j < line.length) {
      if (line[j] !== '`') { j += 1; continue; }
      let m = 0;
      while (line[j + m] === '`') m += 1;
      if (m === n) { close = j + m; break; }
      j += m;
    }
    if (close === -1) { i += n; continue; }
    out.push({ start: base + i, end: base + close });
    i = close;
  }
}
function oldScanCode(text) {
  const out = [];
  let fence = null;
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const line = { start, end, text: text.slice(start, end) };
    start = end + 1;
    if (fence) {
      const m = /^ {0,3}(`+|~+)\s*$/.exec(line.text);
      if (m && m[1][0] === fence.char && m[1].length >= fence.count) { out.push({ start: fence.start, end: line.end }); fence = null; }
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
    if (open) { fence = { char: open[1][0], count: open[1].length, start: line.start }; continue; }
    oldInlineSpans(line.text, line.start, out);
  }
  if (fence) out.push({ start: fence.start, end: text.length });
  return out;
}

test('scanCode matches the old algorithm on random inputs', () => {
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const alphabet = ['`', '`', '`', '`', 'a', ' ', '\n', '~', '[[A]]', '\r', ' ', '``'];
  for (let t = 0; t < 3000; t += 1) {
    let s = '';
    const len = rnd(60);
    for (let k = 0; k < len; k += 1) s += alphabet[rnd(alphabet.length)];
    assert.deepEqual(scanCode(s), oldScanCode(s), JSON.stringify(s));
  }
});

test('scanCode is linear on ascending unclosed backtick runs (2 MiB in well under 1 s)', () => {
  let s = '';
  for (let n = 1; s.length < 2 * 1024 * 1024; n += 1) s += `${'`'.repeat(n)} `;
  const t0 = performance.now();
  assert.deepEqual(scanCode(s), []);
  parseWikilinks(`${s}[[A]]`);
  assert.ok(performance.now() - t0 < 1000, `took ${performance.now() - t0} ms`);
  // many short unclosed runs of one length on one line, then a late close
  const wide = `${'` '.repeat(500000)}\`\``;
  const t1 = performance.now();
  scanCode(wide);
  assert.ok(performance.now() - t1 < 1000);
});
