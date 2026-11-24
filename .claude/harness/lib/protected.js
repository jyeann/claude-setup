'use strict';
// Server-side twin of the in-session read-only guard: which changed files must a PR not touch?
const DEFAULT_PROTECTED = ['.claude/', '.github/', '.harness-protected', 'verify.config.json', 'acceptance/', 'spec.md'];

// Tool configs that can weaken an adapter's gate (#55, #60): a Vitest include list that drops tests, a coverage
// or Stryker setting, a tsconfig that stops checking, a Playwright testMatch. Protected like verify.config.json
// whenever the project's verify.config.json names the adapter. Glob entries match a file name at any depth.
const ADAPTER_PROTECTED = Object.freeze({
  'vitest-stryker': Object.freeze(['stryker.conf.*', 'stryker.config.*', 'vitest.config.*', 'vitest.workspace.*', 'vite.config.*', 'tsconfig*.json', 'playwright.config.*']),
});

// The same configs looked up by what a `junit` config runs: each runner's own config, Stryker's when mutation
// runs, tsconfig when a type check runs.
const RUNNER_PROTECTED = Object.freeze({
  vitest: ['vitest.config.*', 'vitest.workspace.*', 'vite.config.*'],
  playwright: ['playwright.config.*'],
});
const STRYKER_PROTECTED = ['stryker.conf.*', 'stryker.config.*'];
const TYPECHECK_PROTECTED = ['tsconfig*.json'];

// A config file a command names (`--config f`, `-c f`, `--project f`, `-p f`, `--config=f`, `--project=f`) is
// protected too. Only project-relative paths count: flags, shell variables and absolute paths are skipped.
const CONFIG_FLAG = /^(?:--config|-c|--project|-p)$/;
const CONFIG_FLAG_EQ = /^(?:--config|--project)=(.+)$/;
function commandConfigs(command) {
  if (typeof command !== 'string') return [];
  const words = command.split(/[\s;&|()]+/).map((w) => w.replace(/^["']|["']$/g, '')).filter(Boolean);
  const named = words.flatMap((w, i) => {
    const eq = CONFIG_FLAG_EQ.exec(w);
    if (eq) return [eq[1]];
    return CONFIG_FLAG.test(w) && words[i + 1] ? [words[i + 1]] : [];
  });
  return named.map(normalise).filter((p) => !p.startsWith('-') && !p.includes('$') && !p.startsWith('/') && !/^[A-Za-z]:/.test(p));
}

// configText: the text of verify.config.json (or null). Unreadable config protects nothing extra; the gate
// itself refuses to run on it. Setup files a config loads (Vitest setupFiles/globalSetup) and a tsconfig's
// `extends` target are not found: reading them would mean executing or resolving the config (README).
function adapterProtected(configText) {
  let raw;
  try { raw = JSON.parse(configText ?? ''); } catch { return []; }
  if (!raw || typeof raw !== 'object' || (!Object.hasOwn(ADAPTER_PROTECTED, raw.adapter ?? '') && raw.adapter !== 'junit')) return [];
  const byTool = raw.adapter === 'junit'
    ? [
      ...[raw.runner, raw.holdout?.runner, raw.journeys?.runner].flatMap((r) => (Object.hasOwn(RUNNER_PROTECTED, r ?? '') ? RUNNER_PROTECTED[r] : [])),
      ...(raw.mutation?.command ? STRYKER_PROTECTED : []),
      ...(raw.typecheck?.command ? TYPECHECK_PROTECTED : []),
    ]
    : ADAPTER_PROTECTED[raw.adapter];
  const commands = [raw.testCommand, raw.typecheck?.command, raw.holdout?.command, raw.journeys?.command, raw.mutation?.command];
  return [...new Set([...byTool, ...commands.flatMap(commandConfigs)])];
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
