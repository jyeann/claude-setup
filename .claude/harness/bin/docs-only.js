#!/usr/bin/env node
'use strict';
// CI step: may this PR skip the heavy jobs because it changes only documentation? (#105, ADR-0004)
// Prints the decision and, inside Actions, writes `docs_only=true|false` to $GITHUB_OUTPUT. The heavy steps run
// unless the output is exactly "true", so a crash, a bad ref or a missing output all mean "run the full gate".
const fs = require('node:fs');
const { baseProtectedList, changedFiles } = require('../lib/protected');
const { isDocFile, isDocsOnly } = require('../lib/docs-only');

const USAGE = 'Usage: docs-only --base <ref> [--keep <path>]...   (--keep: a path whose .md files are gate inputs)';

function parseArgs(argv) {
  const opts = { base: null, keep: [] };
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i + 1] === undefined) throw new Error(`Missing value for ${argv[i]}\n${USAGE}`);
    if (argv[i] === '--base') opts.base = argv[i + 1];
    else if (argv[i] === '--keep') opts.keep.push(argv[i + 1]);
    else throw new Error(`Unknown argument: ${argv[i]}\n${USAGE}`);
  }
  if (!opts.base) throw new Error(USAGE);
  return opts;
}

function main() {
  const { base, keep } = parseArgs(process.argv.slice(2));
  const gateInputs = [...baseProtectedList(base), ...keep];
  const files = changedFiles(base);
  const docsOnly = isDocsOnly(files, gateInputs);
  if (docsOnly) console.log(`docs-only: ${files.length} changed file(s), all documentation; the heavy steps are skipped`);
  else {
    const code = files.filter((f) => !isDocFile(f, gateInputs));
    console.log(files.length === 0 ? 'not docs-only: no changed files found; running the full gate' : `not docs-only: ${code.length} non-documentation file(s), e.g. ${code.slice(0, 5).join(', ')}; running the full gate`);
  }
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${docsOnly}\n`);
  return 0;
}

try { process.exitCode = main(); } catch (err) { console.error(`docs-only: ${err.message}`); process.exitCode = 2; }
