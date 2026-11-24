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

// Letter case is ignored only where the file system usually ignores it (Windows, macOS); on Linux `Src/a.ts`
// and `src/a.ts` are different files.
const caseInsensitive = (platform) => platform === 'win32' || platform === 'darwin';

// The project-relative POSIX path of an `SF:` entry, or null when it lies outside every root. Relative entries
// are relative to the project root (Vitest, Jest, c8 write them so); absolute ones must start with a root
// (ignoring letter case on Windows and macOS, where drive letters and folder case vary).
function toProjectPath(sf, roots, { platform = process.platform } = {}) {
  const file = toPosix(sf);
  if (!ABSOLUTE.test(file)) {
    const rel = path.posix.normalize(file);
    return rel === '.' || rel === '..' || rel.startsWith('../') ? null : rel;
  }
  const fold = caseInsensitive(platform) ? (s) => s.toLowerCase() : (s) => s;
  for (const root of roots) {
    const base = `${toPosix(root).replace(/\/+$/, '')}/`;
    if (file.length > base.length && fold(file.slice(0, base.length)) === fold(base)) {
      const rel = path.posix.normalize(file.slice(base.length));
      if (!rel.startsWith('../') && rel !== '..' && rel !== '.') return rel;
    }
  }
  return null;
}

// Map<source file, Map<line, hits>> for the gate's own source files. A record matches a file exactly, or on
// Windows and macOS ignoring letter case when exactly one file matches that way; records for other files are
// ignored. Several records for one file (a merged report) keep the highest hit count per line: summing would
// count one execution twice when the same run is reported twice.
function indexLcov(records, { roots, files, platform = process.platform }) {
  const exact = new Set(files);
  const folded = new Map();
  if (caseInsensitive(platform)) {
    for (const f of files) {
      const key = f.toLowerCase();
      folded.set(key, folded.has(key) ? null : f);
    }
  }
  const byFile = new Map();
  for (const record of records) {
    const rel = toProjectPath(record.file, roots, { platform });
    if (rel === null) continue;
    const file = exact.has(rel) ? rel : folded.get(rel.toLowerCase());
    if (!file) continue;
    const lines = byFile.get(file) ?? new Map();
    for (const [n, hits] of record.lines) lines.set(n, Math.max(lines.get(n) ?? 0, hits));
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

// Comments that tell a coverage tool to skip lines (`/* v8 ignore next */`, `// c8 ignore start`,
// `/* istanbul ignore else */`, `/* node:coverage ignore next */`, any letter case, also on a `*` continuation
// line of a block comment). Lines they hide vanish from lcov, so a hard file could score 100% unseen.
const HINT = /(?:\/\*+|\/\/|^\s*\*)\s*(?:v8|c8|istanbul|node:coverage)\s+ignore\b/i;
const coverageHints = (text) => String(text).split(/\r?\n/).flatMap((line, i) => (HINT.test(line) ? [i + 1] : []));

// True when nothing but comments and whitespace is left (a file that legitimately has no executable line).
const isBlankSource = (text) => String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim() === '';

// Number of lines as an editor counts them: a final newline does not start another line.
const countLines = (text) => (text === '' ? 0 : text.split(/\r?\n/).length - (/\r?\n$/.test(text) ? 1 : 0));

module.exports = { parseLcov, LcovError, toProjectPath, indexLcov, fileCoverage, coverageHints, isBlankSource, countLines };
