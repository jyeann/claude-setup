'use strict';

const LINE = /^(?:#|ℹ)\s+(tests|pass|fail|skipped|todo)\s+(\d+)\s*$/gm;

// Sums every summary block, so `npm test && node --test acceptance` counts both. Reads the totals node:test prints, in either the TAP (`# tests 14`) or spec (`ℹ tests 14`) reporter.
function parseTestSummary(output) {
  const totals = { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0 };
  for (const [, key, value] of output.matchAll(LINE)) totals[key] += Number(value);
  return totals;
}

module.exports = { parseTestSummary };
