# Spec: sheet-engine

## Goal
A spreadsheet calculation engine as a pure Node library (Node 22, CommonJS, no dependencies, no I/O). Cells hold
constants or formulas; changing a cell recalculates everything that depends on it.

**This document is deliberately incomplete.** It names the surface; the acceptance tests in
`acceptance/sheet.acceptance.test.js` are the authoritative specification of every edge case. Read them first. Where this
document is silent, the tests decide. Several behaviours differ from what you would write by default.

**Held-out tests.** A second test suite that you cannot see also runs as part of the verify command. It checks the same
rules on inputs you have not seen, so implement the general rule, not the visible examples. When it fails, the verify
output shows the failing assertion; use that. Reading or listing the held-out suite is blocked during a run.

## API (`src/index.js`)
```js
const { createSheet } = require('./src/index.js');
const sheet = createSheet();
sheet.set('A1', '=B1+1')  // -> string[]: addresses whose computed value changed (see tests for ordering)
sheet.get('A1')           // -> number | string | boolean | null (empty) | { error: '#DIV/0!' }
sheet.raw('A1')           // -> the text last set ('' if empty)
sheet.cells()             // -> sorted addresses of non-empty cells
```
Addresses are 1-2 letters (A..ZZ, case-insensitive, stored upper-case) and a row 1..9999. Invalid addresses given to the
API throw `RangeError`. Nothing else ever throws: any formula text, however malformed or deeply nested, yields a value or an
error value.

## Features
- Raw input: numbers, `TRUE`/`FALSE`, text, empty (clears the cell), and formulas starting with `=`.
- Formula syntax: numbers, `"strings"`, booleans, cell references (`A1`, `$A$1`), ranges (`A1:B3`), parentheses, unary
  `+`/`-`, binary `+ - * / ^ &`, comparisons `= <> < <= > >=`.
- Functions: `SUM AVERAGE MIN MAX COUNT IF ROUND ABS AND OR NOT LEN UPPER CONCAT` (case-insensitive).
- Error values: `#DIV/0! #VALUE! #NAME? #REF! #NUM! #ERROR! #CYCLE!`, propagating through formulas.
- Numbers are stored rounded to 15 significant digits.
- Circular references are detected.

## Out of scope
Dates, percent literals, scientific notation, array formulas, named ranges, cross-sheet references, formatting, UI.

## Verify command (definition of done)
```
node .claude/harness/bin/verify.js
```
It reads `verify.config.json`: tests pass with none skipped, at least 40 tests ran (visible, held-out and your own), `src/` line coverage at least 85%
(70% per file) across at least 3 source files, the generator's tests in `tests/` reference `src/` and contain real
assertions, and a mutation spot-check kills at least 70% of 10 sampled mutants.

## Constraints
- No dependencies. Keep source files under 400 lines; separate tokenising, parsing, evaluation and dependency tracking.
- Recalculation must not overflow the stack on a dependency chain of several thousand cells.
- Never commit secrets. Work only on the current feature branch; never push.
