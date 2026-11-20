#!/usr/bin/env node
'use strict';
// Usage: install.js [targetDir] [--dry-run] [--force]
// Copies this harness (hooks, guards, verify, rules) into targetDir/.claude and merges the hook,
// permission, sandbox and status-line settings into targetDir/.claude/settings.json.
// targetDir defaults to $CLAUDE_PROJECT_DIR or the current directory. Safe to re-run: it updates
// the harness files and never removes a setting you already have. --force also overwrites rules.
// Exit 0: installed (or dry run printed). Exit 2: refused, nothing written.
const path = require('node:path');
const { install } = require('../lib/install');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const targetDir = path.resolve(args.find((a) => !a.startsWith('--')) || process.env.CLAUDE_PROJECT_DIR || process.cwd());

const result = install({
  sourceClaudeDir: path.resolve(__dirname, '..', '..'),
  targetDir,
  dryRun: flags.has('--dry-run'),
  force: flags.has('--force'),
});
if (!result.ok) {
  console.error(`install: ${result.message}`);
  process.exit(2);
}
console.log(`${result.dryRun ? 'Would install' : 'Installed'} harness into ${targetDir}`);
for (const a of result.actions) console.log(`  ${a}`);
if (!result.dryRun) console.log('Restart Claude Code in that project so the hooks and settings load, then review the diff and commit it.');
