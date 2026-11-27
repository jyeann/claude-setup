'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseCommands, stripHeredocs } = require('./shell');
const { matchesProtected } = require('./protected');

const ok = Object.freeze({ block: false, reason: '' });
const deny = (reason) => ({ block: true, reason });

const PROTECTED_BRANCHES = new Set(['main', 'master']);
const HARNESS_PATHS = ['.claude/', '.harness/'];
// Gitignored scratch space for helper agents' unfinished work (#112). It is the one writable part of .harness/
// during a run, so work in progress stays out of git's view (and out of the cloud platform's commit-check Stop hook).
const WORK_DIR = '.harness/work/';
const ALLOW_SECRET_MARKER = 'harness:allow-secret';

const WRITE_VERBS = new Set(['rm', 'mv', 'cp', 'chmod', 'chown', 'tee', 'truncate', 'ln', 'dd', 'install', 'patch', 'rsync', 'touch']);
const DESTINATION_ONLY = new Set(['cp', 'rsync', 'install', 'ln']);
const GIT_WRITE_SUBS = new Set(['restore', 'rm', 'clean', 'apply', 'mv']);
const INTERPRETERS = new Set(['node', 'python', 'python3', 'perl', 'ruby', 'deno', 'bun']);
const EVAL_FLAGS = new Set(['-e', '-c', '-p', '--eval', '--print']);
const SECRET_READERS = new Set([
  'cat', 'less', 'more', 'head', 'tail', 'bat', 'nl', 'tac', 'od', 'xxd', 'hexdump', 'strings', 'grep', 'rg', 'ag',
  'awk', 'sed', 'base64', 'cp', 'mv', 'scp', 'rsync', 'tar', 'zip', 'curl', 'wget', 'source', '.',
  'node', 'python', 'python3', 'perl', 'ruby',
  'sort', 'cut', 'paste', 'diff', 'cmp', 'dd', 'openssl', 'column', 'fold', 'rev', 'uniq', 'tee',
]);
const DANGEROUS_RM = new Set([
  '/', '/*', '~', '~/*', '$HOME', '${HOME}', '$PWD', '${PWD}', '.', '..', '*', './*', '.git',
  '/home', '/usr', '/etc', '/var', '/bin', '/lib', '/opt', '/root',
]);
const SECRET_VAR = /KEY|TOKEN|SECRET|PASS|CRED/i;
// Short flags that take a value; letters after them belong to that value, not to flags.
const VALUE_SHORT_FLAGS = new Set(['m', 'F', 'C', 'c', 't', 'S']);
const TEMPLATE_ENV = /^\.env\.(example|sample|template)$/;

const SECRET_PATTERNS = [
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{36,}/],
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/],
];
const CREDENTIAL = /(?:api[_-]?key|secret|token|passw(?:or)?d)\s*[:=]\s*['"]([A-Za-z0-9_\-/+=]{16,})['"]/gi;
const PLACEHOLDER = /example|placeholder|changeme|your[-_]|xxxx|dummy|fake|sample|redacted/i;

const stripDot = (p) => p.replace(/^\.\//, '');
// A protected entry with "*" (an adapter's tool config, e.g. `vitest.config.*`) matches a file name at any depth;
// every other entry matches as a prefix, as before.
const GLOB = (p) => p.includes('*');
const hitsEntry = (rel, p) => (GLOB(p) ? matchesProtected(rel, p) : rel.startsWith(p));

// Held-out tests: the dir lives outside the project and its path is never shown to the agent. While a run is
// active neither the path nor the env var that carries it may be mentioned, and Read/Grep/Glob may not reach it.
const HIDDEN_ENV = 'HARNESS_HIDDEN_DIR';
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentionsHidden = (text, dir) => text.includes(HIDDEN_ENV) || new RegExp(`${escapeRe(dir)}(?![\\w.-])`).test(text);
const trimSlash = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

const SECRET_NAMES = ['.env', 'id_rsa', 'id_ed25519', '.npmrc', '.netrc'];

// A glob such as `.env*` or `.e*` expands to a secret file; shells do not match leading dots with * or ?.
function globMatchesSecret(base) {
  if (!/[*?[]/.test(base) || /^[*?[]/.test(base)) return false;
  const re = new RegExp(`^${base.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  return SECRET_NAMES.some((name) => re.test(name));
}

function isSecretPath(arg) {
  const value = arg.replace(/^(--?[\w-]+|if)=/, '').replace(/^@/, '');
  const base = path.basename(value);
  if (TEMPLATE_ENV.test(base)) return false;
  return /^\.env(\.[\w.-]+)?$/.test(base)
    || /^id_(rsa|ed25519|ecdsa|dsa)$/.test(base)
    || /^\.(npmrc|netrc|pgpass|git-credentials)$/.test(base)
    || /\.(pem|p12|pfx)$/.test(base)
    || /(^|\/)\.aws\/(credentials|config)$/.test(value)
    || /(^|\/)\.config\/gh\/hosts\.yml$/.test(value)
    || /^\/proc\/[^/]+\/environ$/.test(value)
    || globMatchesSecret(base);
}

function pushViolation(argv, currentBranch) {
  const args = argv.slice(2);
  if (args.some((a) => a === '--force' || a === '--mirror' || a === '--all' || a.startsWith('--force-with-lease')
    || a === '--force-if-includes' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a))) {
    return 'Force, mirror and --all pushes are blocked: they rewrite or publish shared history.';
  }
  const positional = args.filter((a) => !a.startsWith('-'));
  const refspecs = positional.slice(1);
  if (refspecs.some((r) => r.startsWith('+'))) return 'Force refspecs (+ref) are blocked.';
  const targets = refspecs.map((r) => (r.includes(':') ? r.split(':').pop() : r).replace(/^refs\/heads\//, ''));
  const hit = targets.find((t) => PROTECTED_BRANCHES.has(t));
  if (hit) return `Pushing to ${hit} is blocked: work on a feature branch and open a PR.`;
  const implicit = refspecs.length === 0 || refspecs.every((r) => r === 'HEAD');
  if (implicit && PROTECTED_BRANCHES.has(currentBranch)) {
    return `You are on ${currentBranch}: a push here targets a protected branch. Switch to a feature branch.`;
  }
  return null;
}

function rmViolation(argv) {
  const flags = argv.slice(1).filter((a) => a.startsWith('-'));
  const recursive = flags.some((f) => /^-[a-zA-Z]*[rR]/.test(f) || f === '--recursive');
  if (!recursive) return null;
  const targets = argv.slice(1).filter((a) => !a.startsWith('-')).map(trimSlash);
  return targets.some((t) => DANGEROUS_RM.has(t)) ? 'Recursive delete of a root, home or whole-project path is blocked.' : null;
}

// True when a short flag letter is present, including bundled forms (-anm) but not inside a flag's value (-m "-n").
function hasBundledFlag(args, wanted) {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!/^-[a-zA-Z]+$/.test(a)) continue;
    for (const letter of a.slice(1)) {
      if (letter === wanted) return true;
      if (VALUE_SHORT_FLAGS.has(letter)) { if (a.endsWith(letter)) i += 1; break; }
    }
  }
  return false;
}

// `-n` is --no-verify for commit, including bundled forms like -nm / -anm (but not -am or `-m "-n"`).
const commitSkipsHooks = (args) => args.includes('--no-verify') || hasBundledFlag(args, 'n');

// Commands that stage files nobody named, so a secret in the working tree could ride along.
function stagesImplicitly({ argv }) {
  if (argv[0] !== 'git') return false;
  const args = argv.slice(2);
  if (argv[1] === 'add') return args.some((a) => ['-A', '--all', '.', '*', '-u', '--update'].includes(a)) || hasBundledFlag(args, 'A') || hasBundledFlag(args, 'u');
  if (argv[1] === 'commit') return args.includes('--all') || hasBundledFlag(args, 'a');
  return false;
}

const impliesBulkStaging = (command) => parseCommands(command).some(stagesImplicitly);

// Names of staged/untracked/modified files (git status --porcelain=v1 -z output) that look like secrets.
function secretPathsInStatus(porcelainZ) {
  return porcelainZ.split('\0').filter((e) => e.length > 3).map((e) => e.slice(3)).filter(isSecretPath);
}

// `kill $(pgrep node)` and `pgrep x | xargs kill` hide the target name from the argv check.
const KILL_BY_LOOKUP = /\bkill\b[^\n]*(\$\(|`)\s*pgrep\b|\bpgrep\b[^\n]*\|\s*xargs\s+(\S+\s+)*kill\b/;
const KILLERS = new Set(['pkill', 'killall', 'kill']);
const BRANCH_DESTRUCTIVE = new Set(['-d', '-D', '-m', '-M', '-f', '-c', '-C', '--delete', '--force', '--move']);
// Hook bypass by config or environment: neither shows up as a git subcommand.
const HOOK_BYPASS = /core\.hooksPath|\bHUSKY(_SKIP_HOOKS)?\s*=\s*(0|true)\b|\bGIT_CONFIG_(COUNT|PARAMETERS|GLOBAL)\b/i;

// Commands that destroy uncommitted work or history. The dry-run / staged / lowercase forms stay allowed.
function irreversibleGit(argv) {
  const [, sub] = argv;
  const rest = argv.slice(2);
  const has = (...flags) => rest.some((a) => flags.includes(a));
  if (sub === 'clean' && !has('-n', '--dry-run')) return 'git clean deletes untracked files and is blocked.';
  if (sub === 'checkout' && (has('--', '-f', '--force'))) return 'git checkout -- / -f discards uncommitted work and is blocked.';
  if (sub === 'restore' && !has('--staged', '-S')) return 'git restore discards uncommitted work and is blocked.';
  if (sub === 'branch' && has('-D')) return 'git branch -D deletes unmerged work and is blocked.';
  if (sub === 'stash' && (rest[0] === 'drop' || rest[0] === 'clear')) return 'git stash drop/clear discards saved work and is blocked.';
  return null;
}

// Owner gates (#24, #149): only the owner adds design-approved, spec-approved or accepted to a spec issue. The
// session's gh token is the owner's, so GitHub cannot tell who added a label; this guard keeps gh from doing it.
const GATE_LABEL = /(?:^|[^\w-])(?:design-approved|spec-approved|accepted)(?![\w-])/;
function gateLabelEdit(args) {
  if (!args.some((a) => GATE_LABEL.test(a))) return false;
  return args[0] === 'label' || args.some((a) => /^--(?:add|remove)-label\b/.test(a) || /(?:^|\/)labels\b|^labels?(?:\[\])?=/.test(a));
}

// Layer verdicts (#48): only the owner writes a `verdict:` line on the spec issue, and GitHub cannot tell the
// owner from the agent using the owner's token. So a gh command may not carry a verdict line anywhere: in an
// argument (--body, -b, -f/-F body=), a here-string, a heredoc fed to it, or a file it or a piped cat reads
// (--body-file, -F body=@file, --input). A verdict line starts a line, a quoted string, a JSON "\n" or a key=.
const VERDICT_TEXT = /(?:^|\\n|["'=])[ \t]*verdict:/im;
const BODY_FILE_FLAGS = new Set(['--body-file', '-F', '--field', '--input']);
function bodyFiles(commands) {
  const files = [];
  for (const { argv } of commands) {
    if (argv[0] === 'cat') files.push(...argv.slice(1).filter((a) => !a.startsWith('-')));
    if (argv[0] !== 'gh') continue;
    argv.forEach((a, i) => {
      const value = BODY_FILE_FLAGS.has(a) ? argv[i + 1] : (/^--(?:body-file|input)=(.+)$/.exec(a) ?? [])[1];
      if (value === undefined) return;
      const at = /^[^=]*=@(.+)$/.exec(value);
      if (at) files.push(at[1]);
      else if (a !== '-F' && a !== '--field') files.push(value);
    });
  }
  return files.filter((f) => f && f !== '-');
}
function verdictPost(command, commands, ctx) {
  if (!commands.some((c) => c.argv[0] === 'gh')) return false;
  if (VERDICT_TEXT.test(command)) return true;
  return bodyFiles(commands).some((f) => {
    try {
      return VERDICT_TEXT.test(fs.readFileSync(path.resolve(ctx.projectDir ?? process.cwd(), f), 'utf8'));
    } catch {
      return false;
    }
  });
}

function commandViolation({ argv }, ctx) {
  const [cmd, sub] = argv;
  if (cmd === 'printenv' && (argv.length === 1 || argv.slice(1).some((a) => SECRET_VAR.test(a)))) return 'Dumping the environment can leak secrets.';
  if (cmd === 'env' && argv.length === 1) return 'Dumping the environment can leak secrets.';
  if (cmd === 'export' && (argv.length === 1 || argv.includes('-p'))) return 'Dumping the environment can leak secrets.';
  if (cmd === 'rm') return rmViolation(argv);
  if (KILLERS.has(cmd) && argv.slice(1).some((a) => /verify|harness|node|claude/i.test(a))) return 'Killing node, the verifier or the harness is blocked.';
  if (cmd === 'gh' && gateLabelEdit(argv.slice(1))) return 'Owner gate labels (design-approved, spec-approved, accepted) are added by the owner only: tell the owner which issue to review and end the turn.';
  if (cmd !== 'git') return null;
  if (sub === 'push') return pushViolation(argv, ctx.currentBranch);
  if (sub === 'commit' && commitSkipsHooks(argv.slice(2))) return '--no-verify / -n skips the safety gates and is blocked.';
  if (sub === 'checkout' && argv.slice(2).includes('.') && !argv.includes('-b')) return 'git checkout . discards all uncommitted work and is blocked.';
  if (sub === 'clean' && argv.slice(2).some((a) => /^-[a-zA-Z]*[fxX]/.test(a) || a === '--force')) return 'git clean deletes untracked and ignored files (including .env) and is blocked.';
  if (sub === 'branch' && argv.slice(2).some((a) => BRANCH_DESTRUCTIVE.has(a) || /^-[a-zA-Z]*[dDmMf]/.test(a))
    && argv.slice(2).some((a) => PROTECTED_BRANCHES.has(a))) return 'Deleting, renaming or force-moving a protected branch is blocked.';
  if (sub === 'reset' && argv.includes('--hard')) return 'git reset --hard discards work and is blocked.';
  return irreversibleGit(argv);
}

function secretReadViolation({ argv, redirects }) {
  const [cmd, sub] = argv;
  const reads = SECRET_READERS.has(cmd) || (cmd === 'git' && sub === 'add');
  return reads && [...argv.slice(1), ...redirects].some(isSecretPath)
    ? 'Reading, copying or staging secret or credential files is blocked.'
    : null;
}

// A project-relative path is in the work folder only if no part of it from `.harness` down is a symlink: a link,
// even one whose target does not exist yet, could point the write anywhere. Without a project dir, it never is.
function inWorkDir(rel, projectDir) {
  const asDir = (p) => (p.endsWith('/') ? p : `${p}/`);
  if (!projectDir || !asDir(rel).startsWith(WORK_DIR)) return false;
  let at = projectDir;
  for (const part of rel.split('/').filter(Boolean)) {
    at = path.join(at, part);
    let st;
    try { st = fs.lstatSync(at); } catch { return true; } // the rest is not created yet
    if (st.isSymbolicLink()) return false;
  }
  return true;
}

// Is a project-relative path guarded? `.harness/` is, except its work folder; protected paths always are.
function guardedRel(rel, protectedPaths, projectDir, { workDirWritable = true } = {}) {
  const asDir = rel.endsWith('/') ? rel : `${rel}/`;
  const hits = (p) => hitsEntry(rel, p) || (!GLOB(p) && asDir.startsWith(p));
  if (protectedPaths.some(hits)) return true;
  if (!HARNESS_PATHS.some(hits)) return false;
  return !(workDirWritable && inWorkDir(rel, projectDir));
}

function guardedMatcher(ctx, opts) {
  const protectedPaths = (ctx.protectedPaths ?? []).map(stripDot);
  const guarded = [...HARNESS_PATHS, ...protectedPaths];
  const projectDir = ctx.projectDir ? trimSlash(ctx.projectDir) : null;
  const isGuarded = (arg) => {
    const raw = arg.replace(/^of=/, '');
    const trailing = raw.endsWith('/') ? '/' : '';
    if (!projectDir) {
      if (raw.startsWith('/')) return false;
      // No root to resolve against: guarded if either spelling hits, so normalising never lets a path through.
      return [stripDot(raw), stripDot(path.posix.normalize(raw))].some((a) => guardedRel(a, protectedPaths, null, opts));
    }
    // Resolve against the project: `.harness/work/../state.json` and `../<project>/.claude/x` are what they point at.
    const abs = path.posix.resolve(projectDir, raw);
    if (abs !== projectDir && !abs.startsWith(`${projectDir}/`)) return false;
    const a = path.posix.relative(projectDir, abs);
    return a !== '' && guardedRel(`${a}${trailing}`, protectedPaths, projectDir, opts);
  };
  const mentions = (text) => guarded.some((p) => text.includes(GLOB(p) ? p.slice(0, p.indexOf('*')) : p));
  return { isGuarded, mentions };
}

// `ln`, `link`, and `cp` in link mode (-l, -s, --link, --symbolic-link, bundled as in -al).
function makesLink([cmd, ...args]) {
  if (cmd === 'ln' || cmd === 'link') return true;
  return cmd === 'cp' && args.some((a) => a === '--link' || a === '--symbolic-link' || /^-[a-zA-Z]*[ls]/.test(a));
}

// `rm -r .claude/../..` resolves to above the project; the raw-text check in rmViolation cannot see that.
function recursiveRmAtOrAbove([cmd, ...args], projectDir) {
  if (cmd !== 'rm' || !projectDir || !args.some((a) => a === '--recursive' || /^-[a-zA-Z]*[rR]/.test(a))) return false;
  const root = trimSlash(projectDir);
  return args.filter((a) => !a.startsWith('-')).some((a) => {
    const abs = path.posix.resolve(root, a);
    return abs === root || abs === '/' || root.startsWith(`${abs}/`);
  });
}

function activeViolation({ argv, redirects }, matcher) {
  const [cmd, sub] = argv;
  const tail = argv.slice(1);
  const harnessIdx = argv.findIndex((a) => a.endsWith('harness.js'));
  if (harnessIdx >= 0 && ['off', 'init', 'restore'].includes(argv[harnessIdx + 1])) {
    return 'The agent cannot stop, re-initialise or restore over the harness run; a human does that.';
  }
  const guardedMsg = 'Guardrail, state and acceptance files are read-only during a harness run.';
  if (redirects.some(matcher.isGuarded)) return guardedMsg;
  if (WRITE_VERBS.has(cmd)) {
    const positional = tail.filter((a) => !a.startsWith('-'));
    const afterT = tail.findIndex((a) => a === '-t') >= 0 ? [tail[tail.findIndex((a) => a === '-t') + 1]] : [];
    const written = DESTINATION_ONLY.has(cmd) ? [positional[positional.length - 1], ...afterT] : tail;
    if (written.some((a) => a && matcher.isGuarded(a))) return guardedMsg;
  }
  if (cmd === 'sed' && tail.some((a) => /^-[a-zA-Z]*i/.test(a) || a === '--in-place') && tail.some(matcher.isGuarded)) return guardedMsg;
  const switchesBranch = tail.some((a) => ['-b', '-B', '--orphan'].includes(a));
  if (cmd === 'git' && tail.some(matcher.isGuarded) && (GIT_WRITE_SUBS.has(sub) || (sub === 'checkout' && !switchesBranch))) return guardedMsg;
  if (INTERPRETERS.has(cmd) && tail.some((a) => EVAL_FLAGS.has(a)) && tail.some((a) => matcher.mentions(a))) return guardedMsg;
  return null;
}

// Quoted text (commit messages, echo'd docs) is data, so these run on the command with quotes blanked.
const PIPE_TO_SHELL = [
  /\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(\S*\/)?(ba|z|da|k)?sh\b/,
  /\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(\S*\/)?(python3?|node|perl|ruby)(\s+-)?\s*(?:$|[|;&)\n])/,
  /(\b(ba|z)?sh|\bsource|(?:^|[\s;&|(])\.)\s+<\(\s*(curl|wget)\b/,
];
const RAW_PIPE_TO_SHELL = /\b((ba|z)?sh\s+-c|eval)\s+["']?\$\(\s*(curl|wget)\b/;
const blankQuotes = (t) => t.replace(/"[^"]*"|'[^']*'/g, '""');

// After `cd <guarded dir>`, relative paths point inside it, so a write-like command in the same line is refused.
// Read-only exploration (`cd .claude/harness; ls lib`) is fine.
function writesLike({ argv, redirects }) {
  const [cmd, sub] = argv;
  if (redirects.length > 0 || WRITE_VERBS.has(cmd)) return true;
  if (cmd === 'sed' && argv.some((a) => /^-[a-zA-Z]*i/.test(a) || a === '--in-place')) return true;
  if (cmd === 'git' && (GIT_WRITE_SUBS.has(sub) || sub === 'checkout' || sub === 'restore')) return true;
  return INTERPRETERS.has(cmd) && argv.some((a) => EVAL_FLAGS.has(a));
}

function checkBash(command, ctx = {}) {
  if (ctx.active && ctx.hiddenDir && mentionsHidden(command, ctx.hiddenDir)) {
    return deny('Held-out tests are not readable during a run; make the visible tests and spec pass for the right reasons.');
  }
  const text = stripHeredocs(command);
  if (RAW_PIPE_TO_SHELL.test(text) || PIPE_TO_SHELL.some((re) => re.test(blankQuotes(text)))) return deny('Piping a download into a shell or interpreter is blocked.');

  if (KILL_BY_LOOKUP.test(blankQuotes(text))) return deny('Killing processes found by name lookup is blocked.');
  if (HOOK_BYPASS.test(blankQuotes(text))) return deny('Changing the hooks path or disabling hooks by environment is blocked.');

  const commands = parseCommands(command);
  for (const c of commands) {
    const reason = commandViolation(c, ctx) || secretReadViolation(c);
    if (reason) return deny(reason);
  }
  if (verdictPost(command, commands, ctx)) return deny('Layer verdicts (a line starting "verdict:") are written by the owner only, never by an agent, on GitHub: describe what changed in your own words, quote nothing in verdict form, and ask the owner to post the verdict.');
  if (ctx.active && hiddenViolation(command, ctx)) return deny(HIDDEN_MSG);
  if (ctx.active) {
    const matcher = guardedMatcher(ctx);
    // From inside the work folder `../state.json` is harness state, so cd counts the work folder as guarded too.
    const strict = guardedMatcher(ctx, { workDirWritable: false });
    const cdsIntoGuarded = commands.some((c) => ['cd', 'pushd'].includes(c.argv[0]) && c.argv[1] && strict.isGuarded(c.argv[1]));
    if (cdsIntoGuarded && commands.some(writesLike)) {
      return deny('Guardrail, state and acceptance files are read-only during a harness run.');
    }
    // A link made now is not resolved by the checks above (they run before it exists), and a hard link never is:
    // no link may name a guarded path or the work folder during a run.
    if (commands.some((c) => makesLink(c.argv) && c.argv.slice(1).some((a) => !a.startsWith('-') && strict.isGuarded(a)))) {
      return deny('Making links to or inside guarded paths (the work folder included) is blocked during a harness run.');
    }
    if (commands.some((c) => recursiveRmAtOrAbove(c.argv, ctx.projectDir))) {
      return deny('Recursively deleting the project folder or anything above it is blocked during a harness run.');
    }
    for (const c of commands) {
      const reason = activeViolation(c, matcher);
      if (reason) return deny(reason);
    }
  }
  return ok;
}

const HIDDEN_MSG = 'That path holds hidden (held-out) acceptance tests and is off limits during a harness run.';

// Hidden paths are absolute. For a path inside the project the relative form is matched too, so `cat holdout/x` is caught.
function hiddenForms(ctx) {
  const root = ctx.projectDir ? `${trimSlash(ctx.projectDir)}/` : null;
  return (ctx.hiddenPaths ?? []).flatMap((h) => (root && h.startsWith(root) ? [h, h.slice(root.length)] : [h]));
}
const hiddenViolation = (text, ctx) => hiddenForms(ctx).some((form) => text.includes(form)) || Boolean(ctx.hiddenDir && mentionsHidden(text, ctx.hiddenDir));

function checkRead(event, ctx = {}, projectDir = process.cwd()) {
  if (!ctx.active || ((ctx.hiddenPaths ?? []).length === 0 && !ctx.hiddenDir)) return ok;
  const input = event.tool_input ?? {};
  const values = [input.file_path, input.notebook_path, input.path, input.pattern, input.glob].filter((v) => typeof v === 'string' && v !== '');
  const roots = [...(ctx.hiddenPaths ?? []), ...(ctx.hiddenDir ? [ctx.hiddenDir] : [])];
  const inside = (abs) => roots.some((h) => abs === h || abs.startsWith(`${h}/`));
  const hit = values.some((v) => {
    const abs = path.resolve(projectDir, v);
    const real = fs.existsSync(abs) ? fs.realpathSync(abs) : abs;
    return inside(abs) || inside(real) || hiddenViolation(v, { ...ctx, projectDir });
  });
  return hit ? deny(HIDDEN_MSG) : ok;
}

function isGitCommit(command) {
  return parseCommands(command).some(({ argv }) => argv[0] === 'git' && argv[1] === 'commit');
}

function scanSecrets(text) {
  const found = new Set();
  for (const line of text.split('\n')) {
    if (line.includes(ALLOW_SECRET_MARKER)) continue;
    for (const [name, re] of SECRET_PATTERNS) if (re.test(line)) found.add(name);
    for (const m of line.matchAll(CREDENTIAL)) if (!PLACEHOLDER.test(m[1])) found.add('hardcoded credential');
  }
  return [...found];
}

function writtenText(input) {
  const edits = Array.isArray(input.edits) ? input.edits.map((e) => e.new_string ?? '') : [];
  return [input.content, input.new_string, input.new_source, ...edits].filter((s) => typeof s === 'string').join('\n');
}

function candidateRelPaths(file, projectDir) {
  const resolved = path.resolve(projectDir, file);
  const real = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
  const realRoot = fs.existsSync(projectDir) ? fs.realpathSync(projectDir) : projectDir;
  return [
    path.relative(projectDir, resolved),
    path.relative(realRoot, real),
  ].map((p) => p.split(path.sep).join('/'));
}

function checkWrite(event, ctx = {}, projectDir = process.cwd()) {
  const input = event.tool_input ?? {};
  const file = input.file_path ?? input.notebook_path ?? '';
  if (ctx.active && file) {
    const protectedPaths = (ctx.protectedPaths ?? []).map(stripDot);
    const hit = candidateRelPaths(file, projectDir).some((rel) => guardedRel(rel, protectedPaths, projectDir));
    if (hit) return deny(`${file} is protected during a harness run (guardrails, state and acceptance tests are read-only).`);
  }
  if (TEMPLATE_ENV.test(path.basename(file))) return ok;
  const found = scanSecrets(writtenText(input));
  return found.length > 0 ? deny(`Possible hardcoded secret (${found.join(', ')}). Use an environment variable.`) : ok;
}

module.exports = { WORK_DIR, checkBash, checkWrite, checkRead, isGitCommit, scanSecrets, isSecretPath, impliesBulkStaging, secretPathsInStatus };
