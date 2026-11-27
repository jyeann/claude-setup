#!/usr/bin/env node
'use strict';
// Checks the design pipeline catalogue (#157, spec #156): every pipeline has its questions, written criteria,
// outputs, known dependencies and a hand-off to system analysis. Prints the pipelines in dependency order.
// Also checks the suggested starting sets in <pipelines-dir>/sets/starting-sets.json (#158): required for the
// shipped catalogue, checked when present in another folder.
// Usage: check-pipelines.js [pipelines-dir]
const path = require('node:path');
const { PIPELINES_DIR, checkFolder } = require('../lib/pipelines');

const dir = process.argv[2] ? path.resolve(process.argv[2]) : PIPELINES_DIR;

let result;
try {
  result = checkFolder(dir);
} catch (e) {
  console.error(`check-pipelines: cannot read ${dir} (${e.message})`);
  process.exit(1);
}
const { problems, counts, order, sets } = result;
if (problems.length === 0) {
  const summary = order.map((id) => `${id} ${counts[id]}`).join(', ');
  const suggested = sets ? ` Suggested starting sets: ${sets.sets.map((s) => `${s.id} (${s.pipelines.join(', ')})`).join('; ')}.` : '';
  console.log(`check-pipelines: ${order.length} pipeline(s), criteria per pipeline in dependency order: ${summary}.${suggested}`);
} else {
  console.error(`check-pipelines: ${problems.length} problem(s). Fix the pipeline file.\n${problems.join('\n')}`);
  process.exit(1);
}
