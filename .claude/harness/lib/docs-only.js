'use strict';
// Which PRs may skip the heavy CI jobs as docs-only (#105, ADR-0004)? Only one whose every changed file is
// documentation. A file is documentation when it is under docs/ or ends in .md AND it is not a gate input:
// nothing under a protected path (.claude/, .github/, acceptance/, spec.md, ... plus the base branch's
// .harness-protected and adapter configs) and nothing under a path the workflow names with --keep.
// Anything else, or an empty change list, means "run the full gate": the rule fails closed.
const { matchesProtected } = require('./protected');

const normalise = (f) => f.replace(/\\/g, '/').replace(/^\.\//, '');

function isDocFile(file, gateInputs) {
  const f = normalise(file);
  if (gateInputs.some((entry) => matchesProtected(f, entry))) return false;
  return f.startsWith('docs/') || /\.md$/i.test(f);
}

function isDocsOnly(files, gateInputs) {
  return files.length > 0 && files.every((f) => isDocFile(f, gateInputs));
}

module.exports = { isDocFile, isDocsOnly };
