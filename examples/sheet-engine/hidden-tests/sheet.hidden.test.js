'use strict';
// HELD-OUT tests: the agent never sees this file. They check the same rules as the visible acceptance tests on
// inputs the agent has not seen. Every expected value follows from the spec, the visible tests, or spreadsheet convention.
// Run with HARNESS_HIDDEN_DIR pointing at the directory containing this file; the project is the current directory.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createSheet } = require(path.resolve('src/index.js'));
const err = (code) => ({ error: code });

function ev(cells, formula) {
  const s = createSheet();
  for (const [addr, raw] of Object.entries(cells)) s.set(addr, raw);
  s.set('Z1', formula);
  return s.get('Z1');
}
function table(cases, cells = {}) {
  for (const [formula, expected] of cases) assert.deepEqual(ev(cells, formula), expected, formula);
}

test('held-out: operator edge cases', () => {
  table([
    ['=-2^-2', 0.25], ['=2^0.5^2', 2], ['=1<2<3', false], ['=1=1=TRUE', true], ['=0.1+0.7', 0.8], ['=1 +  - 1', 0],
    ['=2^3^0', 1], ['=-2*-2', 4], ['=10-2-3-1', 4], ['=2*3^2', 18], ['=(2*3)^2', 36], ['=8/4/2', 1],
  ]);
});

test('held-out: negative zero never escapes', () => {
  table([['=0*-1', 0], ['=-0', 0], ['=ROUND(-2.5,-1)', 0], ['=ABS(-0)', 0], ['=-A1', 0], ['=0/-5', 0], ['=ROUND(-0.4,0)', 0]]);
});

test('held-out: 15 significant digits apply to literals and to very small and very large results', () => {
  table([['=123456789012345678', 123456789012346000], ['=0.000001234567890123456', 1.23456789012346e-6], ['=1/7', 0.142857142857143], ['=2/3', 0.666666666666667],
    ['=1/3+1/3+1/3', 1], ['=10/3*3', 10]]);
});

test('held-out: whitespace is insignificant in formulas but preserved in raw()', () => {
  table([['= 1 + 2 ', 3], ['=SUM( 1 , 2 )', 3], ['=IF( 1 , "a" , "b" )', 'a'], ['="1+1"', '1+1'], ['=  A1  +  1  ', 1], ['=( 1 + 2 ) * 3', 9]]);
  const s = createSheet();
  s.set('B1', '= 1 + 2 ');
  assert.equal(s.raw('B1'), '= 1 + 2 ');
  assert.equal(s.get('B1'), 3);
});

test('held-out: a lone reference returns the referenced value with its type', () => {
  assert.equal(ev({ A1: 'hi' }, '=A1'), 'hi');
  assert.equal(ev({ A1: 'TRUE' }, '=A1'), true);
  assert.equal(ev({ A1: '7' }, '=A1'), 7);
  assert.deepEqual(ev({ A1: '=1/0' }, '=A1'), err('#DIV/0!'));
  assert.equal(ev({}, '=A1'), 0);
  assert.equal(ev({ A1: 'hi' }, '=(A1)'), 'hi');
  assert.equal(ev({ A1: 'x', B1: '=A1' }, '=B1'), 'x');
});

test('held-out: functions over mixed literals and cells', () => {
  table([
    ['=AVERAGE(1,"3",TRUE)', 1.66666666666667], ['=MIN("5",3)', 3], ['=MAX("5",3)', 5], ['=LEN(TRUE)', 4], ['=UPPER(TRUE)', 'TRUE'],
    ['=CONCAT(1/4)', '0.25'], ['=CONCAT(1/3)', '0.333333333333333'], ['=SUM(1,SUM(2,3),4)', 10], ['=MAX(SUM(1,2),2)', 3], ['=ABS(SUM(-5,2))', 3],
    ['=IF(SUM(A1:A3)>5,"big","small")', 'big'],
  ], { A1: '1', A2: '2', A3: '3' });
  assert.equal(ev({ A1: '1', A2: '2', A3: '2' }, '=IF(SUM(A1:A3)>5,"big","small")'), 'small');
});

test('held-out: ROUND works in decimal for many inputs', () => {
  table([
    ['=ROUND(-1.005,2)', -1.01], ['=ROUND(1.5,0)', 2], ['=ROUND(2.5,-1)', 0], ['=ROUND(15,-1)', 20], ['=ROUND(0.285,2)', 0.29], ['=ROUND(1.45,1)', 1.5],
    ['=ROUND(1.255,2)', 1.26], ['=ROUND(8.345,2)', 8.35], ['=ROUND(-0.285,2)', -0.29], ['=ROUND(123.456,0)', 123], ['=ROUND(0,3)', 0], ['=ROUND(99.995,2)', 100],
  ]);
});

test('held-out: more comparison cases', () => {
  table([['="10"<"9"', true], ['=10<9', false], ['=""<"a"', true], ['=FALSE<TRUE', true], ['=TRUE=TRUE', true], ['="B">"a"', true], ['=1<>1', false], ['="a"<>"A"', false]]);
});

test('held-out: values that do not change are not reported, including identical errors', () => {
  const s = createSheet();
  s.set('A1', '=1/0');
  s.set('B1', '=A1+1');
  assert.deepEqual(s.set('A1', '=2/0'), [], 'same error value');
  assert.deepEqual(s.set('A1', '="x"+1'), ['A1', 'B1'], 'a different error is a change');
  assert.deepEqual(s.get('B1'), err('#VALUE!'));
  assert.deepEqual(s.set('A1', '=1/0'), ['A1', 'B1']);
});

test('held-out: dependency tracking is case-insensitive and understands absolute and reversed ranges', () => {
  const s = createSheet();
  s.set('B1', '=a1+1');
  assert.deepEqual(s.set('a1', '5'), ['A1', 'B1']);
  const t = createSheet();
  t.set('C1', '=SUM($A$1:$B$2)');
  t.set('D1', '=SUM(B2:A1)');
  assert.deepEqual(t.set('B2', '3'), ['B2', 'C1', 'D1']);
  assert.deepEqual(t.set('A2', '4'), ['A2', 'C1', 'D1']);
  assert.deepEqual(t.set('A3', '100'), ['A3'], 'A3 is outside both ranges');
});

test('held-out: cells() sorts columns shorter-first, then by row', () => {
  const s = createSheet();
  for (const a of ['AB2', 'Z1', 'A2', 'B1', 'AA1', 'A1']) s.set(a, 'x');
  assert.deepEqual(s.cells(), ['A1', 'A2', 'B1', 'Z1', 'AA1', 'AB2']);
});

test('held-out: cycle lifecycle through a range, and self-overwrite', () => {
  const s = createSheet();
  s.set('A1', '=SUM(B1:B3)');
  assert.deepEqual(s.set('B2', '=A1'), ['A1', 'B2']);
  assert.deepEqual([s.get('A1'), s.get('B2')], [err('#CYCLE!'), err('#CYCLE!')]);
  s.set('C1', '=A1+1');
  assert.deepEqual(s.get('C1'), err('#CYCLE!'));
  assert.deepEqual(s.set('B2', ''), ['A1', 'B2', 'C1']);
  assert.deepEqual([s.get('A1'), s.get('B2'), s.get('C1')], [0, null, 1]);
  const t = createSheet();
  t.set('A1', '=A1');
  assert.deepEqual(t.set('A1', '3'), ['A1']);
  assert.equal(t.get('A1'), 3);
});

test('held-out: deeply nested and very long formulas never throw', () => {
  const s = createSheet();
  assert.doesNotThrow(() => s.set('A1', `=${'('.repeat(500)}1${')'.repeat(500)}`));
  assert.equal(s.get('A1'), 1);
  assert.doesNotThrow(() => s.set('A2', `=${'('.repeat(3000)}1${')'.repeat(3000)}`));
  const v = s.get('A2');
  assert.ok(v === 1 || (v && typeof v === 'object' && typeof v.error === 'string'), 'either evaluates or reports an error value');
  s.set('A3', `=${Array.from({ length: 5000 }, () => '1').join('+')}`);
  assert.equal(s.get('A3'), 5000);
  s.set('A4', `=SUM(${Array.from({ length: 3000 }, () => '2').join(',')})`);
  assert.equal(s.get('A4'), 6000);
});

test('held-out: malformed formulas become error values, never exceptions', () => {
  const s = createSheet();
  const garbage = ['=@', '=#REF!', '=SUM(', '=)(', '=1..2', '=1.2.3', '=A1:', '=:A1', '=A1:B', '="', '=SUM(A1:)', "='a'", '=A1 B1', '=1;2', '=1,2', '=IF(1,2,3,4)', '=SUM(,)', '=((', '=*2', '=2**2', '=<1', '=1<', '=&', '=\t'];
  for (const raw of garbage) {
    assert.doesNotThrow(() => s.set('A1', raw), raw);
    const v = s.get('A1');
    assert.ok(v && typeof v === 'object' && /^#[A-Z/0!?]+$/.test(v.error), `${JSON.stringify(raw)} -> ${JSON.stringify(v)}`);
  }
  assert.deepEqual(ev({}, '=1..2'), err('#ERROR!'));
  assert.deepEqual(ev({}, '=IF(1,2,3,4)'), err('#VALUE!'));
  assert.deepEqual(ev({}, '=2**2'), err('#ERROR!'));
});
