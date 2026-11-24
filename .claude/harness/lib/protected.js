'use strict';
// Server-side twin of the in-session read-only guard: which changed files must a PR not touch?
const DEFAULT_PROTECTED = ['.claude/', '.github/', '.harness-protected', 'verify.config.json', 'acceptance/', 'spec.md'];

// Tool configs that can weaken an adapter's gate (#55, #60): a Vitest include list that drops tests, a coverage
// or Stryker setting, a tsconfig that stops checking, a Playwright testMatch. Protected like verify.config.json
// whenever the project's verify.config.json names the adapter. Glob entries match a file name at any depth.
const ADAPTER_PROTECTED = Object.freeze({
  'vitest-stryker': Object.freeze(['stryker.conf.*', 'stryker.config.*', 'vitest.config.*', 'vitest.workspace.*', 'vite.config.*', 'tsconfig*.json', 'playwright.config.*']),
});

// configText: the text of verify.config.json (or null). Unreadable config protects nothing extra; the gate
// itself refuses to run on it.
function adapterProtected(configText) {
  let adapter;
  try { adapter = JSON.parse(configText ?? '')?.adapter; } catch { return []; }
  return Object.hasOwn(ADAPTER_PROTECTED, adapter ?? '') ? [...ADAPTER_PROTECTED[adapter]] : [];
}

const normalise = (file) => file.replace(/^\.\//, '');

function parseProtectedList(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
}

const globRe = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);

// Directory entries end with "/" and match by prefix; a glob entry (with "*") matches the file name at any
// depth; everything else must match exactly (no look-alikes). Matching is case-insensitive: a checkout on
// macOS/Windows treats `Acceptance/` and `acceptance/` as one path.
function matchesProtected(file, entry) {
  const l = normalise(file).toLowerCase();
  const e = entry.toLowerCase();
  if (e.includes('*')) return globRe(e).test(l.slice(l.lastIndexOf('/') + 1));
  return e.endsWith('/') ? l.startsWith(e) : l === e;
}

function changedProtected(files, list) {
  return files.map(normalise).filter((f) => list.some((entry) => matchesProtected(f, entry)));
}

module.exports = { DEFAULT_PROTECTED, ADAPTER_PROTECTED, adapterProtected, matchesProtected, parseProtectedList, changedProtected };
