'use strict';
// The adapter catalogue (#62, spec #55): which stacks the verify gate can judge, how well, and the status of
// each adapter. The orchestrator reads it when it proposes a stack at kickoff; pipeline.js reads it to check the
// design phase's Stack section. No always-loaded rule refers to it, so it costs no tokens outside a product run.
const fs = require('node:fs');
const path = require('node:path');

const CATALOGUE_FILE = path.join(__dirname, '..', 'adapters', 'catalogue.json');
const STATUSES = Object.freeze(['proven', 'experimental', 'planned']);
const OPTIONS = Object.freeze(['supported alternative', 'weaker gate', 'adapter first']);

// The design.md lines the Stack section is read from.
const ADAPTER_LINE = /^\s*(?:[-*]\s*)?Adapter:\s*`?([\w.-]+)`?\s*\(\s*([\w-]+)\s*\)/gim;
const UNSUPPORTED_LINE = /^\s*(?:[-*]\s*)?Unsupported:\s*(.+)$/im;
// The owner approves a weaker gate here, at spec-approved: design.md is hashed with that approval (#48).
const WEAKER_LINE = /^\s*(?:[-*]\s*)?Weaker gate:\s*(.*)$/im;
const OPTION = new RegExp(`;\\s*option:\\s*(${OPTIONS.join('|')})\\s*$`, 'i');
const FORMS = `"Adapter: <id> (<status>)" for an adapter from .claude/harness/adapters/catalogue.json, or "Unsupported: <stack>; option: ${OPTIONS.join('|')}" for a stack with no adapter`;

function loadCatalogue(file = CATALOGUE_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const findAdapter = (catalogue, id) => catalogue.adapters.find((a) => a.id === id) ?? null;
const missingChecksOf = (adapter) => adapter.missingChecks.map((m) => (typeof m === 'string' ? m : m.check));

// The body of a "## <name>" section, up to the next "## " heading; null when the section is absent.
function section(text, name) {
  const lines = String(text ?? '').split('\n');
  const heading = new RegExp(`^##\\s+${name}\\s*$`, 'i');
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return null;
  if (lines.filter((l) => heading.test(l)).length > 1) return { twice: true };
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

// Returns { problems, adapter, option, weakerGate } for design.md's Stack section: the chosen adapter (a proven
// or experimental entry, with the status the catalogue gives it), for a stack with no adapter the option taken,
// and for option "weaker gate" the checks the owner accepts the gate will not run.
function readStack(designText, catalogue) {
  const body = section(designText, 'Stack');
  const fail = (problem) => ({ problems: [problem], adapter: null, option: null, weakerGate: null });
  if (body?.twice) return fail('design.md has more than one "## Stack" section: keep one');
  if (body === null) return fail(`design.md has no "## Stack" section: propose the stack and 1-2 alternatives from the adapter catalogue and record the choice as ${FORMS}`);
  const unsupported = UNSUPPORTED_LINE.exec(body);
  let option = null;
  if (unsupported) {
    const m = OPTION.exec(unsupported[1]);
    if (!m) return fail(`design.md's Stack section records no option: write "Unsupported: <stack>; option: ${OPTIONS.join('|')}"`);
    option = m[1].toLowerCase();
  }
  let weakerGate = null;
  if (option === 'weaker gate') {
    const w = WEAKER_LINE.exec(body);
    weakerGate = w ? w[1].split(/[\s,]+/).filter(Boolean) : [];
    if (weakerGate.length === 0) return fail('design.md\'s Stack section: option "weaker gate" needs a line "Weaker gate: <checks>" in the Stack section, naming the checks the gate will not run (the owner approves it with the page)');
  }
  const named = [...body.matchAll(ADAPTER_LINE)];
  if (named.length > 1) return fail(`design.md's Stack section names more than one adapter (${named.map((m) => m[1]).join(', ')}): name the chosen one on its "Adapter:" line and the alternatives on other lines`);
  if (named.length === 0) {
    if (option === 'adapter first') return { problems: [], adapter: null, option, weakerGate };
    if (option) return fail(`design.md's Stack section: option "${option}" runs an adapter from the catalogue: add "Adapter: <id> (<status>)" naming it`);
    return fail(`design.md's Stack section names no adapter: record ${FORMS}`);
  }
  const [, id, status] = named[0];
  const entry = findAdapter(catalogue, id);
  if (!entry) return fail(`design.md's Stack section names "${id}", but "${id}" is not in the adapter catalogue (${catalogue.adapters.map((a) => a.id).join(', ')})`);
  if (entry.status === 'planned') return fail(`design.md's Stack section names ${id}, but ${id} is planned: no adapter exists yet. Record "Unsupported: <stack>; option: ${OPTIONS.join('|')}" and show the owner the three options`);
  if (status.toLowerCase() !== entry.status) return fail(`design.md's Stack section gives ${id} as "${status}", but the catalogue lists it as "${entry.status}"`);
  return { problems: [], adapter: id, option, weakerGate };
}

module.exports = { CATALOGUE_FILE, STATUSES, OPTIONS, loadCatalogue, findAdapter, missingChecksOf, readStack, section };
