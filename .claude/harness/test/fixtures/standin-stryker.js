#!/usr/bin/env node
'use strict';
// Stand-in for `stryker run` in the mutation-report tests (#59): the real Stryker cannot be installed in the
// harness's dependency-free tests. It takes what the gate hands Stryker (a gate-owned config file as the
// positional argument, holding jsonReporter.fileName, plus --testRunner --mutate --reporters --checkers
// --tempDirName), writes a mutation-testing-elements report there and prints a Stryker-like line.
// Usage: node standin-stryker.js --scenario <file.json> run <gate config> <flags...>
// The scenario (all optional):
//   mutants   { "<file>": [{ status, line, mutator, replacement, reason }] }  per mutated file; default one Killed
//   fromReport  path of a real report: its first file's mutants are reported for every mutated file
//   omit      [files] left out of the report;  extra { "<file>": [...] } files nobody asked for
//   config    fields merged into the report's `config` (e.g. { "incremental": true })
//   exit, sleepMs, noReport, oldReport, garbage   what a broken or dishonest run would do
// Every run appends its arguments and the gate config to <scenario>.runs.jsonl so tests can inspect them.
const fs = require('node:fs');

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i].startsWith('--')) { flags[args[i].slice(2)] = args[i + 1]; i += 1; } else positional.push(args[i]);
}
const scenarioFile = flags.scenario;
const scenario = scenarioFile ? JSON.parse(fs.readFileSync(scenarioFile, 'utf8')) : {};
const gateConfigFile = positional.find((p) => p.endsWith('.json'));
const gateConfig = gateConfigFile ? JSON.parse(fs.readFileSync(gateConfigFile, 'utf8')) : null;
if (scenarioFile) fs.appendFileSync(`${scenarioFile}.runs.jsonl`, `${JSON.stringify({ args, gateConfig })}\n`);
if (!gateConfig?.jsonReporter?.fileName) { console.error('standin-stryker: no config file with jsonReporter.fileName'); process.exit(7); }

const mutate = (flags.mutate ?? '').split(',').filter(Boolean);
const real = scenario.fromReport ? Object.values(JSON.parse(fs.readFileSync(scenario.fromReport, 'utf8')).files)[0].mutants : null;
let id = 0;
const mutant = (m) => ({
  id: String(id++), mutatorName: m.mutator ?? 'EqualityOperator', replacement: m.replacement ?? 'a !== b',
  ...(m.reason ? { statusReason: m.reason } : {}), status: m.status, static: false,
  location: { start: { line: m.line ?? 1, column: 1 }, end: { line: m.line ?? 1, column: 2 } },
});
const files = {};
for (const file of mutate.filter((f) => !(scenario.omit ?? []).includes(f))) {
  const list = real ?? (scenario.mutants?.[file] ?? [{ status: 'Killed' }]).map(mutant);
  files[file] = { language: 'javascript', source: '', mutants: list };
}
for (const [file, list] of Object.entries(scenario.extra ?? {})) files[file] = { language: 'javascript', source: '', mutants: list.map(mutant) };

const report = {
  files, schemaVersion: '1.0', thresholds: { high: 80, low: 60, break: null }, projectRoot: '.',
  config: { mutate, incremental: gateConfig.incremental ?? false, testRunner: flags.testRunner, ...scenario.config },
};
const finish = () => {
  const out = gateConfig.jsonReporter.fileName;
  if (!scenario.noReport) {
    fs.writeFileSync(out, scenario.garbage ? '{"files": ' : JSON.stringify(report));
    if (scenario.oldReport) fs.utimesSync(out, new Date('2001-01-01'), new Date('2001-01-01'));
  }
  console.log(`INFO MutationTestReportHelper Final mutation score of ${mutate.length} file(s) written`);
  process.exit(scenario.exit ?? 0);
};
if (scenario.sleepMs) setTimeout(finish, scenario.sleepMs); else finish();
