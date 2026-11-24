'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createSheet } = require(path.join(__dirname, '..', 'src', 'index.js'));

const err = (code) => ({ error: code });
const PROBE = 'Z1';

// Evaluate one formula in a fresh sheet after setting the given cells (in order).
function ev(cells, formula) {
  const s = createSheet();
  for (const [addr, raw] of Object.entries(cells)) s.set(addr, raw);
  s.set(PROBE, formula);
  return s.get(PROBE);
}
function table(cases, cells = {}) {
  for (const [formula, expected] of cases) {
    assert.deepEqual(ev(cells, formula), expected, formula);
  }
}

test('operator precedence and associativity follow spreadsheet rules, not JavaScript', () => {
  table([
    ['=1+2*3', 7], ['=(1+2)*3', 9], ['=10-4-3', 3], ['=100/10/5', 2],
    ['=2^3^2', 64],      // ^ is left-associative: (2^3)^2
    ['=-2^2', 4],        // unary minus binds tighter than ^
    ['=2^-1', 0.5], ['=-(2+3)', -5], ['=+5', 5], ['=--3', 3], ['=2*-3', -6], ['=7/2', 3.5], ['=.5+.5', 1],
    ['=1+2&3', '33'],    // & binds looser than +
    ['=1+1=2', true],    // comparison binds loosest
  ]);
});

test('numbers are rounded to 15 significant digits when stored, and cell references see the stored value', () => {
  table([['=0.1+0.2', 0.3], ['=1/3', 0.333333333333333], ['=1/3*3', 1], ['=0.1*3', 0.3]]);
  const s = createSheet();
  s.set('A1', '=1/3');
  s.set('B1', '=A1*3');
  assert.equal(s.get('B1'), 0.999999999999999);
});

test('arithmetic errors and bad syntax produce the right error codes', () => {
  table([
    ['=1/0', err('#DIV/0!')], ['=0^-1', err('#DIV/0!')], ['=(-8)^0.5', err('#NUM!')],
    ['=NOSUCH(1)', err('#NAME?')], ['=AAA1+1', err('#NAME?')], ['=foo', err('#NAME?')],
    ['=A0', err('#REF!')], ['=A10000+1', err('#REF!')],
    ['=1+', err('#ERROR!')], ['=(1+2', err('#ERROR!')], ['=1 2', err('#ERROR!')], ['=', err('#ERROR!')], ['=)', err('#ERROR!')], ['="open', err('#ERROR!')],
    ['=A1:B2+1', err('#VALUE!')], ['=A1:B2', err('#VALUE!')],
  ]);
});

test('errors propagate leftmost-first through operators and functions', () => {
  table([
    ['=1/0+1', err('#DIV/0!')], ['=1+1/0', err('#DIV/0!')], ['=SUM(1/0,5)', err('#DIV/0!')],
    ['=("a"+1)+(1/0)', err('#VALUE!')], ['=(1/0)+("a"+1)', err('#DIV/0!')],
    ['=ABS(1/0)', err('#DIV/0!')], ['=UPPER(1/0)', err('#DIV/0!')], ['="x"&(1/0)', err('#DIV/0!')],
  ]);
});

test('operands are coerced: numeric text and booleans become numbers, empty is 0 or empty text, other text is #VALUE!', () => {
  table([
    ['="3"+4', 7], ['="a"+1', err('#VALUE!')], ['=TRUE+1', 2], ['=FALSE*5', 0], ['=" 3 "*2', 6], ['=""+1', err('#VALUE!')],
    ['=A1+1', 1], ['=A1&"x"', 'x'], ['=A1*5', 0],
    ['=1&2', '12'], ['=0.5&""', '0.5'], ['=1/3&""', '0.333333333333333'], ['="a"&TRUE', 'aTRUE'], ['=-"4"', -4],
  ]);
});

test('comparisons: case-insensitive text, mixed types ordered number < text < boolean, empty equals 0 and ""', () => {
  table([
    ['=1<2', true], ['=2<=2', true], ['=3>4', false], ['=1<>2', true], ['=2>=3', false],
    ['="a"="A"', true], ['="a"<"B"', true], ['="b"<"A"', false],
    ['=1="1"', false], ['=1<"a"', true], ['="a"<TRUE', true], ['=TRUE>5', true], ['=TRUE=1', false],
    ['=A1=0', true], ['=A1=""', true], ['=A1<1', true],
  ]);
});

test('SUM, AVERAGE, MIN, MAX and COUNT: ranges ignore non-numbers, literals are coerced, errors propagate', () => {
  const cells = { A1: '1', A2: 'x', A3: '3', B1: 'TRUE', B2: '4', B3: '' };
  table([
    ['=SUM(1,2,3)', 6], ['=SUM(A1:A3)', 4], ['=SUM(A1:B3)', 8], ['=SUM(B3:A1)', 8], ['=SUM(A1,A2,A3)', 4],
    ['=SUM("3",4)', 7], ['=SUM("x",4)', err('#VALUE!')], ['=SUM(TRUE,1)', 2], ['=SUM(B1)', 0], ['=SUM(A1:A3,10)', 14],
    ['=AVERAGE(1,2,3,4)', 2.5], ['=AVERAGE(A1:A3)', 2], ['=AVERAGE(A2:A2)', err('#DIV/0!')], ['=AVERAGE(B3:B3)', err('#DIV/0!')],
    ['=MIN(A1:B3)', 1], ['=MAX(A1:B3)', 4], ['=MIN(5,2,9)', 2], ['=MAX(-1,-5)', -1], ['=MIN(B3:B3)', 0], ['=MAX(A2:A2)', 0],
    ['=COUNT(A1:B3)', 3], ['=COUNT(1,2)', 2], ['=COUNT(B3:B3)', 0],
    ['=sum(1,2)', 3], ['=Sum(A1:A3)', 4],
  ], cells);
  table([['=SUM(A1:A2)', err('#DIV/0!')]], { A1: '=1/0', A2: '5' });
});

test('IF is lazy, coerces its condition, and defaults the else branch to FALSE', () => {
  table([
    ['=IF(1,"y","n")', 'y'], ['=IF(0,"y","n")', 'n'], ['=IF(0,"y")', false], ['=IF(TRUE,1,1/0)', 1], ['=IF(FALSE,1/0,2)', 2],
    ['=IF("TRUE",1,2)', 1], ['=IF("false",1,2)', 2], ['=IF("maybe",1,2)', err('#VALUE!')], ['=IF(1/0,1,2)', err('#DIV/0!')],
    ['=IF(2>1,IF(1>2,"a","b"),"c")', 'b'], ['=IF(A1,"set","empty")', 'empty'],
  ]);
});

test('AND, OR and NOT; wrong argument counts are #VALUE!', () => {
  const cells = { A1: 'TRUE', A2: 'x', B1: '0' };
  table([
    ['=AND(TRUE,1,1)', true], ['=AND(1,0)', false], ['=OR(0,0,1)', true], ['=OR(0,0)', false], ['=NOT(0)', true], ['=NOT(TRUE)', false],
    ['=NOT("x")', err('#VALUE!')], ['=AND(A1:A2)', true], ['=OR(B1:B1)', false],
    ['=ROUND(5)', err('#VALUE!')], ['=IF()', err('#VALUE!')], ['=ABS(1,2)', err('#VALUE!')], ['=NOT(1,2)', err('#VALUE!')], ['=LEN()', err('#VALUE!')],
  ], cells);
});

test('ROUND rounds half away from zero in decimal, not binary, and supports negative digits', () => {
  table([
    ['=ROUND(2.5,0)', 3], ['=ROUND(-2.5,0)', -3], ['=ROUND(0.5,0)', 1], ['=ROUND(-0.5,0)', -1],
    ['=ROUND(1.005,2)', 1.01], ['=ROUND(2.675,2)', 2.68], ['=ROUND(3.14159,3)', 3.142], ['=ROUND(1234.567,-2)', 1200],
    ['=ROUND(1250,-2)', 1300], ['=ROUND(-1250,-2)', -1300], ['=ROUND("2.5",0)', 3], ['=ROUND(2.5,"x")', err('#VALUE!')],
  ]);
});

test('ABS, LEN, UPPER, CONCAT and string literals', () => {
  table([
    ['=ABS(-3)', 3], ['=ABS("-3")', 3], ['=LEN("héllo")', 5], ['=LEN(12345)', 5], ['=LEN(A1)', 0], ['=UPPER("abc")', 'ABC'], ['=UPPER(1)', '1'],
    ['=CONCAT("a",1,TRUE)', 'a1TRUE'], ['=CONCAT()', ''], ['=CONCAT(A1,"x")', 'x'],
    ['="he said ""hi"""', 'he said "hi"'], ['=""', ''], ['=LEN("a""b")', 3],
  ]);
});

test('references: case-insensitive, absolute markers are ignored, ranges normalise their corners', () => {
  const cells = { A1: '10', B2: '5' };
  table([['=a1+1', 11], ['=$A$1+A$1+$A1', 30], ['=sum($A$1:b2)', 15], ['=SUM(B2:A1)', 15], ['=aa1', 0]], cells);
  const s = createSheet();
  s.set('a1', '7');
  s.set('zz9999', 'edge');
  assert.deepEqual(s.cells(), ['A1', 'ZZ9999']);
  assert.equal(s.get('A1'), 7);
  assert.equal(s.get('zz9999'), 'edge');
});

test('raw input is parsed as number, boolean, text or formula, and raw() returns what was set', () => {
  const s = createSheet();
  const cases = [['A1', '42', 42], ['A2', '  42 ', 42], ['A3', '-3.5', -3.5], ['A4', '.5', 0.5], ['A5', '1e3', '1e3'], ['A6', 'TRUE', true], ['A7', 'false', false],
    ['A8', 'hello', 'hello'], ['A9', '1,5', '1,5'], ['B1', '+7', 7], ['B2', '12abc', '12abc'], ['B3', '0x10', '0x10']];
  for (const [addr, raw, value] of cases) {
    s.set(addr, raw);
    assert.deepEqual(s.get(addr), value, `${addr} <- ${JSON.stringify(raw)}`);
    assert.equal(s.raw(addr), raw);
  }
  assert.equal(s.get('C1'), null);
  assert.equal(s.raw('C1'), '');
  s.set('A1', '');
  assert.equal(s.get('A1'), null);
  assert.equal(s.raw('A1'), '');
  assert.ok(!s.cells().includes('A1'));
});

test('set() returns the addresses whose value changed, sorted by column (shorter names first) then row', () => {
  const s = createSheet();
  assert.deepEqual(s.set('A1', '1'), ['A1']);
  assert.deepEqual(s.set('B1', '=A1*2'), ['B1']);
  assert.deepEqual(s.set('A1', '5'), ['A1', 'B1']);
  assert.deepEqual(s.set('A1', '5'), [], 'setting the same value changes nothing');
  assert.deepEqual(s.set('A1', '5.0'), [], 'a different text with the same value changes nothing');
  assert.deepEqual(s.set('A1', '=2+3'), [], 'a formula with the same value changes nothing');
  assert.deepEqual(s.set('Z9', '1'), ['Z9']);
  assert.deepEqual(s.set('AA1', '=Z9'), ['AA1']);
  assert.deepEqual(s.set('Z9', '2'), ['Z9', 'AA1']);
  assert.deepEqual(s.set('Q5', ''), [], 'clearing an empty cell changes nothing');
  assert.deepEqual(s.set('A2', '=A1'), ['A2']);
  assert.deepEqual(s.set('B2', '=A2'), ['B2']);
  assert.deepEqual(s.set('A1', '6'), ['A1', 'A2', 'B1', 'B2']);
});

test('recalculation reaches indirect dependents and stops where values stop changing', () => {
  const s = createSheet();
  s.set('A1', '1');
  s.set('B1', '=A1+1');
  s.set('C1', '=B1+1');
  s.set('D1', '=A1+C1');
  assert.equal(s.get('D1'), 4);
  assert.deepEqual(s.set('A1', '10'), ['A1', 'B1', 'C1', 'D1']);
  assert.equal(s.get('D1'), 22);
  s.set('E1', '=A1>0');
  assert.deepEqual(s.set('A1', '11'), ['A1', 'B1', 'C1', 'D1'], 'E1 stays TRUE so it is not reported');
});

test('dependencies on empty cells, ranges and cleared cells are tracked, and rewriting a cell drops its old dependencies', () => {
  const s = createSheet();
  s.set('B1', '=A1+1');
  assert.equal(s.get('B1'), 1);
  assert.deepEqual(s.set('A1', '10'), ['A1', 'B1']);
  assert.equal(s.get('B1'), 11);
  assert.deepEqual(s.set('A1', ''), ['A1', 'B1']);
  assert.equal(s.get('B1'), 1);
  s.set('C1', '=SUM(A1:A3)');
  assert.deepEqual(s.set('A3', '4'), ['A3', 'C1']);
  assert.deepEqual(s.set('B1', '7'), ['B1'], 'B1 no longer depends on A1');
  assert.deepEqual(s.set('A1', '99'), ['A1', 'C1'], 'only C1 still depends on A1');
  s.set('D1', '=IF(A1>0,B1,0)');
  s.set('D1', 'plain text');
  assert.deepEqual(s.set('A1', '100'), ['A1', 'C1']);
});

test('circular references yield #CYCLE! for every cell on or downstream of the cycle, statically, and recover when broken', () => {
  const s = createSheet();
  assert.deepEqual(s.set('A1', '=A1'), ['A1']);
  assert.deepEqual(s.get('A1'), err('#CYCLE!'));
  s.set('B1', '=C1');
  s.set('C1', '=B1');
  assert.deepEqual(s.get('B1'), err('#CYCLE!'));
  assert.deepEqual(s.get('C1'), err('#CYCLE!'));
  s.set('D1', '=B1+1');
  assert.deepEqual(s.get('D1'), err('#CYCLE!'));
  assert.deepEqual(s.set('C1', '5'), ['B1', 'C1', 'D1']);
  assert.equal(s.get('B1'), 5);
  assert.equal(s.get('D1'), 6);
  s.set('E1', '=IF(TRUE,1,E1)');
  assert.deepEqual(s.get('E1'), err('#CYCLE!'), 'a cycle is structural: the untaken branch still counts');
  s.set('F1', '=SUM(F1:F3)');
  assert.deepEqual(s.get('F1'), err('#CYCLE!'));
  s.set('G1', '=H1');
  s.set('H1', '=I1');
  s.set('I1', '=G1');
  for (const a of ['G1', 'H1', 'I1']) assert.deepEqual(s.get(a), err('#CYCLE!'), a);
  s.set('I1', '3');
  assert.deepEqual([s.get('G1'), s.get('H1'), s.get('I1')], [3, 3, 3]);
});

test('errors recover when their cause is fixed', () => {
  const s = createSheet();
  s.set('A1', '=1/0');
  s.set('B1', '=A1+1');
  s.set('C1', '=IF(ISERR,1,2)');
  assert.deepEqual(s.get('B1'), err('#DIV/0!'));
  assert.deepEqual(s.get('C1'), err('#NAME?'));
  assert.deepEqual(s.set('A1', '2'), ['A1', 'B1']);
  assert.equal(s.get('B1'), 3);
});

test('invalid addresses throw RangeError from every API method', () => {
  const s = createSheet();
  for (const bad of ['1A', 'A0', 'AAA1', 'A10000', '', 'A', 'A1B', 'A-1', 'A 1', ' A1', 5]) {
    assert.throws(() => s.set(bad, '1'), RangeError, `set ${bad}`);
    assert.throws(() => s.get(bad), RangeError, `get ${bad}`);
    assert.throws(() => s.raw(bad), RangeError, `raw ${bad}`);
  }
  assert.doesNotThrow(() => s.set('zz9999', '1'));
});

test('a 5000-cell dependency chain recalculates without overflowing the stack, in either build order', () => {
  const N = 5000;
  const forward = createSheet();
  forward.set('A1', '1');
  for (let i = 2; i <= N; i += 1) forward.set(`A${i}`, `=A${i - 1}+1`);
  assert.equal(forward.get(`A${N}`), N);
  const t0 = Date.now();
  const changed = forward.set('A1', '2');
  assert.equal(changed.length, N);
  assert.equal(forward.get(`A${N}`), N + 1);
  assert.ok(Date.now() - t0 < 3000, 'recalculation of the chain must be fast');

  // Building backwards is inherently quadratic (each set changes every cell above it), so keep it modest.
  const M = 1500;
  const backward = createSheet();
  for (let i = M; i >= 2; i -= 1) backward.set(`A${i}`, `=A${i - 1}+1`);
  assert.equal(backward.get(`A${M}`), M - 1, 'A1 is empty, so the chain starts at 0');
  assert.equal(backward.set('A1', '1').length, M);
  assert.equal(backward.get(`A${M}`), M);
});

test('one cell with thousands of dependents, and wide ranges, stay fast and correct', () => {
  const s = createSheet();
  s.set('A1', '1');
  for (let i = 1; i <= 2000; i += 1) s.set(`B${i}`, '=A1*2');
  s.set('C1', '=SUM(B1:B2000)');
  assert.equal(s.get('C1'), 4000);
  const t0 = Date.now();
  const changed = s.set('A1', '2');
  assert.equal(changed.length, 2002);
  assert.equal(s.get('C1'), 8000);
  assert.ok(Date.now() - t0 < 3000);
  s.set('D1000', '=SUM(A1:Z999)');
  assert.equal(s.get('D1000'), 2 + 999 * 4 + 8000, 'A1, B1..B999 and C1 are inside the range');
});
