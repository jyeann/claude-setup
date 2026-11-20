'use strict';

const LINE = /^(?:#|ℹ)\s+(tests|pass|fail|skipped|todo)\s+(\d+)\s*$/gm;
// Vitest: `      Tests  1 failed | 2 passed | 1 skipped | 1 todo (5)`   Jest: `Tests:       1 failed, 1 skipped, 2 passed, 4 total`
const VITEST_LINE = /^\s*Tests\s+((?:\d+ \w+(?: \| )?)+)\s*\((\d+)\)\s*$/gm;
const JEST_LINE = /^\s*Tests:\s+((?:\d+ \w+, )*\d+ total)\s*$/gm;
const COUNT = { failed: 'fail', passed: 'pass', skipped: 'skipped', todo: 'todo' };

function addCounts(totals, list, total) {
  totals.tests += Number(total);
  for (const [, n, word] of list.matchAll(/(\d+) (\w+)/g)) if (COUNT[word]) totals[COUNT[word]] += Number(n);
}

// Sums every summary block, so `npm test && node --test acceptance` counts both. Reads the totals node:test prints, in either the TAP (`# tests 14`) or spec (`ℹ tests 14`) reporter, and the one-line totals of Vitest and Jest.
function parseTestSummary(output) {
  const totals = { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0 };
  for (const [, key, value] of output.matchAll(LINE)) totals[key] += Number(value);
  for (const [, list, total] of output.matchAll(VITEST_LINE)) addCounts(totals, list, total);
  for (const [, list] of output.matchAll(JEST_LINE)) addCounts(totals, list, list.match(/(\d+) total/)[1]);
  return totals;
}


// Vitest prints ` FAIL  file > suite > test` and Jest prints `  ● suite › test`, each followed by the error and then a
// code frame / stack. Keep the name and the error lines before the frame; drop frames, stacks and diff noise.
function runnerFailures(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i].match(/^ FAIL  (.*?)\s*$/) || lines[i].match(/^\s*● (?!Console\b)(.+)$/);
    if (!head || /^\S+\.\w+$/.test(head[1])) continue; // Jest's `FAIL file` suite line has no test name
    const body = [];
    for (let j = i + 1; j < lines.length && !/^ FAIL  /.test(lines[j]) && !/^\s*● /.test(lines[j]) && !/^⎯{3,}/.test(lines[j]) && body.length < MAX_LINES_PER_FAILURE; j += 1) {
      if (lines[j].trim() === '') { if (body.length > 0 && /^\s*(?:❯|>)/.test(lines[j + 1] ?? '')) break;
        continue; }
      if (/^\s*(?:❯ |at |>?\s*\d+ \|)/.test(lines[j])) break;
      body.push(lines[j].trim().slice(0, MAX_LINE_CHARS));
    }
    out.push([`- ${head[1]}`, ...body.map((l) => `    ${l}`)].join('\n'));
  }
  return out;
}

const DROP_KEYS = new Set(['duration_ms', 'type', 'location', 'failureType', 'code', 'name', 'stack']);
const MAX_LINES_PER_FAILURE = 8;
const MAX_LINE_CHARS = 200;

// The assertion details of each failing test (names, error text, expected/actual), without the TAP noise of
// passing tests or stack traces. This is what an agent needs to fix a failure, and it must survive a tail cut.
function extractFailures(output, { maxFailures = 6, maxChars = 3000 } = {}) {
  const lines = output.split('\n');
  const failures = [...runnerFailures(lines)];
  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i].match(/^\s*not ok \d+ - (.*)$/);
    if (!head) continue;
    const body = [];
    let aggregator = false;
    let keep = true;
    let j = i + 1;
    if (lines[j]?.trim() === '---') {
      for (j += 1; j < lines.length && lines[j].trim() !== '...'; j += 1) {
        const key = lines[j].match(/^\s{2}(\w+):/);
        if (key) {
          keep = !DROP_KEYS.has(key[1]);
          if (key[1] === 'failureType' && /subtestsFailed/.test(lines[j])) aggregator = true;
        }
        if (keep) body.push(lines[j].replace(/^ {2}/, '').slice(0, MAX_LINE_CHARS));
      }
    }
    if (!aggregator) failures.push([`- ${head[1]}`, ...body.slice(0, MAX_LINES_PER_FAILURE).map((l) => `    ${l}`)].join('\n'));
    i = j;
  }
  if (failures.length === 0) return '';
  const shown = failures.slice(0, maxFailures);
  let text = shown.join('\n');
  if (text.length > maxChars) text = `${text.slice(0, maxChars)} ...`;
  const omitted = failures.length - shown.length;
  return omitted > 0 ? `${text}\n... and ${omitted} more failing test(s)` : text;
}

module.exports = { parseTestSummary, extractFailures };
