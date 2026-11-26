#!/usr/bin/env node
'use strict';
// Checks the build standards catalogue (#136): every standard has its fields, a known test kind and a source
// the checker can verify. Prints the number of standards per layer.
// Usage: check-standards.js [standards-dir] [--repo <root>]   (repo: where "repo" sources are looked up)
const path = require('node:path');
const { STANDARDS_DIR, REPO_ROOT, loadStandards, validateCatalogue } = require('../lib/standards');

const args = process.argv.slice(2);
const repoAt = args.indexOf('--repo');
const repoRoot = repoAt === -1 ? REPO_ROOT : path.resolve(args[repoAt + 1] ?? '.');
const dirArg = args.find((a, i) => a !== '--repo' && args[i - 1] !== '--repo');
const dir = dirArg ? path.resolve(dirArg) : STANDARDS_DIR;

let entries;
try {
  entries = loadStandards(dir);
} catch (e) {
  console.error(`check-standards: cannot read ${dir} (${e.message})`);
  process.exit(1);
}
const { problems, counts } = validateCatalogue(entries, { repoRoot });
const total = Object.values(counts).reduce((a, b) => a + b, 0);
const summary = Object.entries(counts).map(([id, n]) => `${id} ${n}`).join(', ');
if (problems.length === 0) console.log(`check-standards: ${total} standard(s) in ${Object.keys(counts).length} layer(s): ${summary}.`);
else {
  console.error(`check-standards: ${problems.length} problem(s). Fix the standard or cite a source the checker can verify.\n${problems.join('\n')}`);
  process.exit(1);
}
