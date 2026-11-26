#!/usr/bin/env node
'use strict';
// Usage: kickoff.js [--docs <product docs dir> | --file <kickoff.json>] [--json]   (#128, spec #126)
//   Prints the product's kickoff choices in plain language: each pick, whether a check enforces it today or it is
//   only recorded, and the hard limits no choice can switch off. With no file it prints the defaults (the owner's
//   picks). --docs reads <dir>/kickoff.json. Exit 0: valid (or no file). Exit 1: the file is not valid. Exit 2: usage.
const path = require('node:path');
const { readKickoff, describe, notEnforced } = require('../lib/kickoff');

const USAGE = 'usage: kickoff.js [--docs <product docs dir> | --file <kickoff.json>] [--json]';
const args = process.argv.slice(2);
const flags = { json: false };
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--json') flags.json = true;
  else if (['--docs', '--file'].includes(args[i]) && args[i + 1] !== undefined) { flags[args[i].slice(2)] = args[i + 1]; i += 1; }
  else { console.error(USAGE); process.exit(2); }
}
if (flags.docs && flags.file) { console.error(USAGE); process.exit(2); }

const base = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const file = path.resolve(base, flags.file ?? path.join(flags.docs ?? '.', 'kickoff.json'));
const result = readKickoff(file);
if (flags.json) {
  const { ok, errors, choices, sources, prototype, hardLimits, missing } = result;
  console.log(JSON.stringify({ ok, errors, missing, prototype, choices, sources, notEnforced: notEnforced(choices), hardLimits }, null, 2));
} else console.log(describe(result));
process.exitCode = result.ok ? 0 : 1;
