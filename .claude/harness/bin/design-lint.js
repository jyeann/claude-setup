#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { lintDesign } = require('../lib/design-lint');

const projectDir = path.resolve(process.argv[2] ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const { active, problems } = lintDesign(projectDir);
if (!active) { console.log('design-lint: no docs/design/tokens.json, nothing to check.'); process.exit(0); }
if (problems.length === 0) { console.log('design-lint: UI code conforms to the recorded design tokens.'); process.exit(0); }
console.error(`design-lint: ${problems.length} problem(s). Use a token, or change the direction on purpose (design-director records it).\n${problems.join('\n')}`);
process.exit(1);
