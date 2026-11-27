#!/usr/bin/env node
'use strict';
// Usage: kickoff.js [--docs <product docs dir> | --file <kickoff.json>] [--json | --judges]   (#128, spec #126)
//        kickoff.js --page [--json]                                                          (#135)
//   Prints the product's kickoff choices in plain language: each pick, whether a check enforces it today or it is
//   only recorded, and the hard limits no choice can switch off. With no file it prints the defaults (the owner's
//   picks). --docs reads <dir>/kickoff.json. Exit 0: valid (or no file). Exit 1: the file is not valid. Exit 2: usage.
//   --page prints the choices page the owner answers at the kickoff step, the recommended picks marked (with
//   --json: the same as data, each option with the value kickoff.json takes). --judges prints the rows of the
//   spec-approved page's "Who judges each layer" section, filled from the choices.
const path = require('node:path');
const { readKickoff, describe, notEnforced, page, pageData, judgesTable } = require('../lib/kickoff');

const USAGE = 'usage: kickoff.js [--docs <product docs dir> | --file <kickoff.json>] [--json | --judges]\n       kickoff.js --page [--json]';
const args = process.argv.slice(2);
const flags = { json: false, page: false, judges: false };
for (let i = 0; i < args.length; i += 1) {
  if (['--json', '--page', '--judges'].includes(args[i])) flags[args[i].slice(2)] = true;
  else if (['--docs', '--file'].includes(args[i]) && args[i + 1] !== undefined && flags[args[i].slice(2)] === undefined) { flags[args[i].slice(2)] = args[i + 1]; i += 1; }
  else { console.error(USAGE); process.exit(2); }
}
if ((flags.docs !== undefined && flags.file !== undefined) || (flags.judges && (flags.json || flags.page)) || (flags.page && (flags.docs ?? flags.file) !== undefined)) { console.error(USAGE); process.exit(2); }
if (flags.page) {
  console.log(flags.json ? JSON.stringify(pageData(), null, 2) : page());
  process.exit(0);
}

const base = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const file = path.resolve(base, flags.file ?? path.join(flags.docs ?? '.', 'kickoff.json'));
const result = readKickoff(file);
if (flags.json) {
  const { ok, errors, choices, sources, prototype, hardLimits, missing } = result;
  console.log(JSON.stringify({ ok, errors, missing, prototype, choices, sources, notEnforced: notEnforced(choices), hardLimits }, null, 2));
} else if (flags.judges) {
  // An invalid file applies nothing, so its rows would be the defaults': print the problems instead.
  if (result.ok) console.log(judgesTable(result.choices));
  else console.error(describe(result));
} else console.log(describe(result));
process.exitCode = result.ok ? 0 : 1;
