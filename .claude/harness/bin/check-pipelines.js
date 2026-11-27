#!/usr/bin/env node
'use strict';
// Checks the design pipeline catalogue (#157, spec #156): every pipeline has its questions, written criteria,
// outputs, known dependencies and a hand-off to system analysis. Prints the pipelines in dependency order.
// Usage: check-pipelines.js [pipelines-dir]
const path = require('node:path');
const { PIPELINES_DIR, loadPipelines, validateCatalogue } = require('../lib/pipelines');

const dir = process.argv[2] ? path.resolve(process.argv[2]) : PIPELINES_DIR;

let entries;
try {
  entries = loadPipelines(dir);
} catch (e) {
  console.error(`check-pipelines: cannot read ${dir} (${e.message})`);
  process.exit(1);
}
const { problems, counts, order } = validateCatalogue(entries);
if (problems.length === 0) {
  const summary = order.map((id) => `${id} ${counts[id]}`).join(', ');
  console.log(`check-pipelines: ${order.length} pipeline(s), criteria per pipeline in dependency order: ${summary}.`);
} else {
  console.error(`check-pipelines: ${problems.length} problem(s). Fix the pipeline file.\n${problems.join('\n')}`);
  process.exit(1);
}
