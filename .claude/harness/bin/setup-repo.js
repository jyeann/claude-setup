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

const args = process.argv.slice(2);
const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const valued = new Set(['--repo', '--environment']);
const positional = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
const targetDir = path.resolve(positional[0] || process.env.CLAUDE_PROJECT_DIR || process.cwd());

const res = setupRepo({
  sourceClaudeDir: path.resolve(__dirname, '..', '..'),
  targetDir,
  repo: value('--repo'),
  environment: value('--environment'),
  check: args.includes('--check'),
});
if (!res.ok) {
  console.error(`setup-repo: ${res.message}`);
  process.exit(2);
}
console.log(formatChecklist(res));
process.exit(res.complete ? 0 : 1);
