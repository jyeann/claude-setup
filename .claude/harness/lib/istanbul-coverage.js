'use strict';
// Source-file line coverage for runners that cannot be measured with raw V8 coverage (Vitest, Jest): they run
// transformed code that V8 reports without a file URL or with offsets of the transformed text. Both can write an
// Istanbul `coverage-final.json` already mapped back to the original files, and that is what we read.
const fs = require('node:fs');
const path = require('node:path');

const REPORT = 'coverage-final.json';

// Map of project-relative path -> Istanbul file coverage. Missing or unreadable report -> null (the caller says why).
function collectIstanbul(dir, projectRoot) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(path.join(dir, REPORT), 'utf8')); } catch { return null; }
  const roots = new Set([projectRoot, fs.realpathSync(projectRoot)]);
  const byFile = new Map();
  for (const [key, file] of Object.entries(parsed ?? {})) {
    const abs = path.resolve(file?.path ?? key);
    const root = [...roots].find((r) => abs.startsWith(`${r}${path.sep}`));
    if (!root) continue;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (!rel.split('/').includes('node_modules')) byFile.set(rel, file);
  }
  return byFile;
}

// Istanbul's own definition of line coverage: a line is executable if a statement starts on it, and covered if
// any statement starting there ran. Type-only lines hold no statements, so they never count.
function istanbulLineCoverage(file) {
  const hits = new Map();
  for (const [id, loc] of Object.entries(file?.statementMap ?? {})) {
    const line = loc?.start?.line;
    if (!Number.isInteger(line)) continue;
    hits.set(line, Math.max(hits.get(line) ?? 0, Number(file.s?.[id] ?? 0)));
  }
  const lines = [...hits.keys()].sort((a, b) => a - b);
  const uncoveredLines = lines.filter((l) => hits.get(l) === 0);
  const executable = lines.length;
  const covered = executable - uncoveredLines.length;
  return { executable, covered, uncoveredLines, pct: executable === 0 ? 100 : Math.round((covered / executable) * 10000) / 100 };
}

module.exports = { collectIstanbul, istanbulLineCoverage, REPORT };
