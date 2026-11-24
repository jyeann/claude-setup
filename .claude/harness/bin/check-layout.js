#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { checkLayout } = require('../lib/layout');

// Usage: check-layout.js [repoRoot] [--policy file]   default policy: <repoRoot>/.claude/layout.json
// Exits 0 when the repository has no policy file: the check is opt-in per repository.
const args = process.argv.slice(2);
const at = args.indexOf('--policy');
const policyArg = at >= 0 ? args[at + 1] : null;
const first = args.find((a, i) => a !== '--policy' && (at < 0 || i !== at + 1));
const root = path.resolve(first || path.join(__dirname, '..', '..', '..'));
const policyFile = path.resolve(policyArg || path.join(root, '.claude', 'layout.json'));
if (!fs.existsSync(policyFile)) {
  console.log(`check-layout: no policy at ${policyFile}, nothing to check.`);
  process.exit(0);
}
const problems = checkLayout(root, JSON.parse(fs.readFileSync(policyFile, 'utf8')));
if (problems.length === 0) console.log('check-layout: layout is clean.');
else {
  console.error(`check-layout: ${problems.length} problem(s). Move the file or fix the reference.\n${problems.join('\n')}`);
  process.exit(1);
}
