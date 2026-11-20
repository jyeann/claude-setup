#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { checkRefs } = require('../lib/refs');

// Usage: check-refs.js [dir] [--also otherDir ...]   --also dirs supply targets but are not themselves checked.
const args = process.argv.slice(2);
const also = args.flatMap((a, i) => (a === '--also' && args[i + 1] ? [path.resolve(args[i + 1])] : []));
const first = args.find((a, i) => a !== '--also' && args[i - 1] !== '--also');
const claudeDir = first ? path.resolve(first) : path.resolve(__dirname, '..', '..');
const problems = checkRefs(claudeDir, { also });
if (problems.length === 0) console.log('check-refs: no dangling references.');
else {
  console.error(`check-refs: ${problems.length} dangling reference(s). Remove them or ship the target.\n${problems.join('\n')}`);
  process.exit(1);
}
