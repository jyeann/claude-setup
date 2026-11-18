#!/usr/bin/env node
'use strict';
// Usage: node .claude/harness/bin/agents-kpi.js [--out file.json] [--interventions list.json] [--tune tune-report.json] [--finals agent-runs.json]   Prints the per-agent KPI roll-up as JSON.
const fs = require('node:fs');
const path = require('node:path');
const { buildKpi } = require('../lib/agents-kpi');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const i = process.argv.indexOf('--out');
const f = process.argv.indexOf('--finals');
// A JSON array of completion-notice figures for background agents (see lib/agents-kpi.js applyFinals).
const finals = f > -1 && process.argv[f + 1] ? JSON.parse(fs.readFileSync(process.argv[f + 1], 'utf8')) : [];
const kpi = buildKpi(root, path.join(root, '.claude', 'agents'), { finals });
const j = process.argv.indexOf('--interventions');
// Interventions from before the human-prompt hook existed: a hand-kept JSON array, shown as such.
if (j > -1 && process.argv[j + 1]) kpi.knownInterventions = JSON.parse(fs.readFileSync(process.argv[j + 1], 'utf8'));
const t = process.argv.indexOf('--tune');
// A tune-report.json from tune.js: model x effort pass rate, cost and time on a fixed task.
if (t > -1 && process.argv[t + 1]) kpi.tune = JSON.parse(fs.readFileSync(process.argv[t + 1], 'utf8')).results;
const json = JSON.stringify(kpi, null, 2);
if (i > -1 && process.argv[i + 1]) fs.writeFileSync(process.argv[i + 1], json + '\n'); else process.stdout.write(json + '\n');
