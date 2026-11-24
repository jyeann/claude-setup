'use strict';
// Reader for the mutation-testing-elements JSON schema (Stryker's `json` reporter), for the report contract
// (ADR-0003, #59). Pure and dependency-free. It refuses anything it cannot read with certainty, and its error
// messages never quote the report (no status, path or reason text).

const STATUSES = ['Killed', 'Survived', 'Timeout', 'NoCoverage', 'Ignored', 'CompileError', 'RuntimeError'];

class MutationReportError extends Error {}
const fail = (why) => { throw new MutationReportError(`malformed mutation report: ${why}`); };
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const positive = (v) => Number.isInteger(v) && v >= 1;

// Report keys are project-relative; Windows separators and a leading `./` are normalised away.
const normalisePath = (file) => file.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');

function readMutant(raw, fileIndex, index) {
  const where = `(file ${fileIndex + 1}, mutant ${index + 1})`;
  if (!isObject(raw)) fail(`a mutant is not an object ${where}`);
  if (!STATUSES.includes(raw.status)) fail(`a mutant has an unknown status ${where}; expected one of ${STATUSES.join(', ')}`);
  const start = raw.location?.start;
  const end = raw.location?.end ?? start;
  if (!positive(start?.line)) fail(`a mutant has no start line ${where}`);
  return {
    id: String(raw.id ?? index),
    mutator: String(raw.mutatorName ?? ''),
    replacement: String(raw.replacement ?? ''),
    status: raw.status,
    reason: typeof raw.statusReason === 'string' ? raw.statusReason : '',
    line: start.line,
    column: start.column ?? 1,
    endLine: end?.line ?? start.line,
    endColumn: end?.column ?? start.column ?? 1,
  };
}

// -> { files: { path: { mutants } }, counts: { status: n }, config }
function parseMutationReport(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return fail('not valid JSON (truncated file?)'); }
  if (!isObject(raw)) fail('the report is not a JSON object');
  if (typeof raw.schemaVersion !== 'string' || !/^1(?:\.|$)/.test(raw.schemaVersion)) fail('schemaVersion is missing or not 1.x');
  if (!isObject(raw.files)) fail('"files" is not an object');
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const files = {};
  Object.entries(raw.files).forEach(([file, entry], fileIndex) => {
    if (!isObject(entry) || !Array.isArray(entry.mutants)) fail(`a file has no mutants list (file ${fileIndex + 1})`);
    const key = normalisePath(file);
    if (Object.hasOwn(files, key)) fail(`a file is listed twice (file ${fileIndex + 1}); its mutants would be counted twice`);
    const mutants = entry.mutants.map((m, i) => readMutant(m, fileIndex, i));
    for (const m of mutants) counts[m.status] += 1;
    files[key] = { mutants };
  });
  return { files, counts, config: isObject(raw.config) ? raw.config : null };
}

// Score = (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage): a hung mutant counts as killed, as on
// the node path. CompileError, RuntimeError and Ignored are outside the score (Ignored is judged separately).
function scoreMutants(counts) {
  const n = (s) => counts[s] ?? 0;
  const detected = n('Killed') + n('Timeout');
  const valid = detected + n('Survived') + n('NoCoverage');
  return { detected, valid, rate: valid === 0 ? null : detected / valid };
}

module.exports = { parseMutationReport, scoreMutants, normalisePath, MutationReportError, STATUSES };
