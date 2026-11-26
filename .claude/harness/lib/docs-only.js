'use strict';
// Which PRs may skip the heavy CI jobs as docs-only (#105, ADR-0004)? Only one whose every changed file is
// documentation: a `.md` file anywhere, or a file under docs/ with a documentation extension (text or image),
// AND not a gate input: nothing under a protected path (.claude/, .github/, acceptance/, spec.md, ... plus the base
// branch's .harness-protected and adapter configs) and nothing under a path the workflow names with --keep.
// Anything else, or an empty change list, means "run the full gate": the rule fails closed.
const { matchesProtected } = require('./protected');

const DOCS_DIR_EXTENSIONS = /\.(md|mdx|markdown|txt|rst|adoc|png|jpe?g|gif|svg|webp)$/i;

function isDocFile(file, gateInputs) {
  if (file.includes('\\')) return false; // a literal backslash in a git path is no doc we know; run the gate
  const f = file.replace(/^\.\//, '');
  if (gateInputs.some((entry) => matchesProtected(f, entry))) return false;
  return /\.md$/i.test(f) || (f.startsWith('docs/') && DOCS_DIR_EXTENSIONS.test(f));
}

function isDocsOnly(files, gateInputs) {
  return files.length > 0 && files.every((f) => isDocFile(f, gateInputs));
}

module.exports = { isDocFile, isDocsOnly };
