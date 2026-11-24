'use strict';
// lcov reader for the report contract (ADR-0003, #58). Pure and dependency-free. It reads the line data (`SF:`,
// `DA:`, `LF:`, `LH:`, `end_of_record`) and checks that `LF`/`LH` agree with the `DA:` lines; other `KEY:value`
// records (functions, branches, lcov 2 additions) are skipped. Anything else is refused with its line number.
// Which files count as source is never taken from the report: the gate matches records to the files it found
// in srcDirs, and a source file without a record fails (strong-verify.js).
const path = require('node:path');

class LcovError extends Error {}
const fail = (lineNo, why) => { throw new LcovError(`malformed lcov report: line ${lineNo}: ${why}`); };

const RECORD = /^([A-Z][A-Z0-9_]*):(.*)$/;
const DA = /^(\d+),(\d+)(?:,[^,]*)?$/;
const COUNT = /^\d+$/;

// Returns [{ file, lines: Map<lineNumber, hits> }] in report order; `file` is the `SF:` path as written.
function parseLcov(text) {
  const records = [];
  let current = null;
  const lines = String(text).split(/\r?\n/);
  lines.forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (line === '') return;
    if (line === 'end_of_record') {
      if (!current) fail(n, 'end_of_record without SF:');
      records.push({ file: current.file, lines: current.lines });
      current = null;
      return;
    }
    const m = RECORD.exec(line);
    if (!m) fail(n, 'not an lcov record');
    const [, key, value] = m;
    if (key === 'SF') {
      if (current) fail(n, 'SF: before end_of_record');
      if (value.trim() === '') fail(n, 'SF: has no path');
      current = { file: value.trim(), lines: new Map(), start: n };
      return;
    }
    if (key === 'TN' || key === 'VER') return;
    if (!current) fail(n, `${key}: outside an SF: record`);
    if (key === 'DA') {
      const da = DA.exec(value);
      if (!da || Number(da[1]) < 1) fail(n, 'unreadable DA: entry');
      const lineNo = Number(da[1]);
      current.lines.set(lineNo, Math.max(current.lines.get(lineNo) ?? 0, Number(da[2])));
    } else if (key === 'LF' || key === 'LH') {
      if (!COUNT.test(value)) fail(n, `unreadable ${key}: entry`);
      const expected = key === 'LF' ? current.lines.size : [...current.lines.values()].filter((h) => h > 0).length;
      if (Number(value) !== expected) fail(n, key === 'LF' ? `LF:${value} disagrees with the ${expected} DA: line(s)` : `LH:${value} disagrees with the ${expected} covered DA: line(s)`);
    }
  });
  if (current) fail(current.start, 'the SF: record is not closed by end_of_record');
  if (records.length === 0) fail(lines.length, 'no SF: record');
  return records;
}

const toPosix = (p) => p.replace(/\\/g, '/');
const ABSOLUTE = /^(?:\/|[A-Za-z]:\/)/;

// The project-relative POSIX path of an `SF:` entry, or null when it lies outside every root. Relative entries
// are relative to the project root (Vitest, Jest, c8 write them so); absolute ones must start with a root, whose
// letter case is ignored (Windows and macOS file systems are case-insensitive, and drive letters vary).
function toProjectPath(sf, roots) {
  const file = toPosix(sf);
  if (!ABSOLUTE.test(file)) {
    const rel = path.posix.normalize(file);
    return rel === '.' || rel === '..' || rel.startsWith('../') ? null : rel;
  }
  for (const root of roots) {
    const base = `${toPosix(root).replace(/\/+$/, '')}/`;
    if (file.length > base.length && file.slice(0, base.length).toLowerCase() === base.toLowerCase()) {
      const rel = path.posix.normalize(file.slice(base.length));
      if (!rel.startsWith('../') && rel !== '..' && rel !== '.') return rel;
    }
  }
  return null;
}

// Map<source file, Map<line, hits>> for the gate's own source files. A record matches a file exactly, or
// ignoring letter case when exactly one file matches that way; records for other files are ignored. Several
// records for one file (a merged report) add up.
function indexLcov(records, { roots, files }) {
  const exact = new Set(files);
  const folded = new Map();
  for (const f of files) {
    const key = f.toLowerCase();
    folded.set(key, folded.has(key) ? null : f);
  }
  const byFile = new Map();
  for (const record of records) {
    const rel = toProjectPath(record.file, roots);
    if (rel === null) continue;
    const file = exact.has(rel) ? rel : folded.get(rel.toLowerCase());
    if (!file) continue;
    const lines = byFile.get(file) ?? new Map();
    for (const [n, hits] of record.lines) lines.set(n, (lines.get(n) ?? 0) + hits);
    byFile.set(file, lines);
  }
  return byFile;
}

// Same shape and rounding as v8-coverage.js lineCoverage, so the floors judge both paths alike.
function fileCoverage(lines) {
  const numbers = [...lines.keys()].sort((a, b) => a - b);
  const uncoveredLines = numbers.filter((n) => lines.get(n) === 0);
  const executable = numbers.length;
  const covered = executable - uncoveredLines.length;
  const pct = executable === 0 ? 100 : Math.round((covered / executable) * 10000) / 100;
  return { executable, covered, uncoveredLines, pct };
}

module.exports = { parseLcov, LcovError, toProjectPath, indexLcov, fileCoverage };
