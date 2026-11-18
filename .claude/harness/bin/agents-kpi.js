#!/usr/bin/env node
'use strict';
// Usage: node .claude/harness/bin/agents-kpi.js [--out file.json]   Prints the per-agent KPI roll-up as JSON.
const fs = require('node:fs');
const path = require('node:path');
const { buildKpi } = require('../lib/agents-kpi');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const i = process.argv.indexOf('--out');
const json = JSON.stringify(buildKpi(root, path.join(root, '.claude', 'agents')), null, 2);
if (i > -1 && process.argv[i + 1]) fs.writeFileSync(process.argv[i + 1], json + '\n'); else process.stdout.write(json + '\n');
