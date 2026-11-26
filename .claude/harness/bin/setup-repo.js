#!/usr/bin/env node
'use strict';
// Usage: setup-repo.js [targetDir] [--repo owner/name] [--environment <name>] [--check]
// Sets up a product repository in one go (spec #108) and prints one checklist: the harness, the
// product-team and mattpocock-skills plugins, the labels (created through `gh`), the repository docs,
// and the cloud environment (reported, never created). Re-running changes nothing that is right.
// --check writes nothing and creates nothing. --repo defaults to the target's origin remote.
// Exit 0: checklist complete. Exit 1: a row needs the owner or is missing. Exit 2: refused.
const path = require('node:path');
const { setupRepo, formatChecklist } = require('../lib/repo-setup');

// Strict parsing: a typo or a missing value must not turn a --check into a real setup.
const VALUED = new Set(['--repo', '--environment']);
const SWITCHES = new Set(['--check']);
const opts = { positional: [] };
const fail = (message) => { console.error(`setup-repo: ${message}`); process.exit(2); };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (VALUED.has(a)) {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) fail(`${a} needs a value`);
    opts[a] = v;
    i += 1;
  } else if (SWITCHES.has(a)) opts[a] = true;
  else if (a.startsWith('--')) fail(`unknown option ${a}`);
  else opts.positional.push(a);
}
if (opts.positional.length > 1) fail('give at most one target directory');
const targetDir = path.resolve(opts.positional[0] || process.env.CLAUDE_PROJECT_DIR || process.cwd());

const res = setupRepo({
  sourceClaudeDir: path.resolve(__dirname, '..', '..'),
  targetDir,
  repo: opts['--repo'],
  environment: opts['--environment'],
  check: opts['--check'] === true,
});
if (!res.ok) fail(res.message);
console.log(formatChecklist(res));
process.exit(res.complete ? 0 : 1);
