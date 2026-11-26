'use strict';
// Owner mode (#113, spec #109): two states only the owner sets, kept in .harness/owner-mode.json.
//   stopped         - nothing is published, pushed or written to GitHub until the owner says "continue".
//                     It holds across turns the owner did not start (a finished background task, another session).
//   run-unattended  - the session does not end a turn to ask permission for a step inside the agreed work.
//                     It never lifts an owner gate, an owner-only decision (spend, secrets, legal, scope) or a
//                     hard-to-reverse action; those end the turn on a line starting "Owner decision:".
// Phrases are a small fixed list (English only); every state also has an explicit command, `harness: <state>`
// typed as the first line of a prompt, and `bin/owner-mode.js` for a terminal. The prompt text is never stored.
const fs = require('node:fs');
const path = require('node:path');
const { parseCommands } = require('./shell');
const { promptKind } = require('./trace');

const MODE_FILE = path.join('.harness', 'owner-mode.json');
const modePath = (projectDir) => path.join(projectDir, MODE_FILE);

// Matched against the first clause of the prompt's first line (text before . ! ? , ; :), lower-cased, whole.
const STOP = new Set(['stop', 'stop it', 'stop now', 'stop here', 'stop that', 'pause', 'halt']);
const CONTINUE = new Set(['continue', 'resume', 'carry on', 'go on', 'keep going', 'go ahead', 'unpause',
  'continue without me', 'go ahead without me', 'carry on without me', 'keep going without me']);
const ATTENDED = new Set(['ask me first', 'check with me first']);
// Matched anywhere in the prompt, as whole words; each names "me", so "don't ask the user" or a "Don't ask again"
// checkbox set nothing.
const UNATTENDED = ['run without me', 'go ahead without me', 'carry on without me', 'keep going without me', 'continue without me',
  'work without me', 'without asking me', "don't ask me", 'do not ask me', 'no need to ask me'];
// Matched as the whole first clause only ("Don't ask, just do it").
const UNATTENDED_CLAUSE = new Set(["don't ask", 'do not ask', 'no need to ask', 'without asking', 'just do it']);
const COMMAND = /^harness:\s*(stop|continue|unattended|attended)\s*$/i;

const normal = (text) => String(text ?? '').replace(/[‘’]/g, "'").toLowerCase();
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasPhrase = (text, phrase) => new RegExp(`(?:^|[^\\w'])${escapeRe(phrase)}(?![\\w'])`).test(text);

// A prompt from the harness, a background task or another session is never an owner instruction.
const isOwnerPrompt = (prompt) => promptKind(prompt) === 'human' && !/^\s*</.test(String(prompt ?? ''));

// Which owner instructions a prompt carries: any of 'stop', 'continue', 'unattended', 'attended'.
function classifyPrompt(prompt) {
  const text = normal(prompt);
  const firstLine = (text.split('\n').find((l) => l.trim()) ?? '').trim();
  const command = COMMAND.exec(firstLine);
  if (command) return [command[1]];
  const clause = firstLine.split(/[.!?,;:]/)[0].replace(/\s+/g, ' ').trim();
  const actions = [];
  if (STOP.has(clause)) actions.push('stop');
  if (CONTINUE.has(clause)) actions.push('continue');
  if (ATTENDED.has(clause)) actions.push('attended');
  else if (UNATTENDED_CLAUSE.has(clause) || UNATTENDED.some((p) => hasPhrase(text, p))) actions.push('unattended');
  return actions;
}

// A missing file is neither state. A corrupt one reads as stopped: damage must tighten the hold, never lift it.
function readMode(projectDir) {
  let raw;
  try { raw = fs.readFileSync(modePath(projectDir), 'utf8'); } catch { return { stopped: false, unattended: false }; }
  let m;
  try { m = JSON.parse(raw); } catch { m = null; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { stopped: true, unattended: false, corrupt: true };
  return { ...m, stopped: m.stopped === true, unattended: m.unattended === true };
}

function writeMode(projectDir, mode) {
  const file = modePath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(mode, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

const STEP = {
  stop: (m, now) => ({ ...m, stopped: true, stoppedAt: now }),
  continue: ({ stoppedAt, ...m }) => ({ ...m, stopped: false }),
  unattended: (m, now) => ({ ...m, unattended: true, unattendedAt: now }),
  attended: ({ unattendedAt, ...m }) => ({ ...m, unattended: false }),
};

function setMode(projectDir, actions, now = Date.now()) {
  const { corrupt, ...current } = readMode(projectDir);
  const next = actions.reduce((m, a) => STEP[a](m, now), corrupt ? { stopped: true, unattended: false } : current);
  writeMode(projectDir, next);
  return next;
}

function applyPrompt(projectDir, prompt, now = Date.now()) {
  const owner = isOwnerPrompt(prompt);
  const actions = owner ? classifyPrompt(prompt) : [];
  const mode = actions.length ? setMode(projectDir, actions, now) : readMode(projectDir);
  return { owner, actions, mode };
}

const LIFT = '"continue" (or a first line `harness: continue`)';
const NOTICES = {
  stop: `[harness] Owner mode: stopped. Publishing, pushing and GitHub writes are blocked until the owner says ${LIFT}. `
    + 'Finish or park local work, say in one line where it stands, and end the turn.',
  continue: '[harness] Owner mode: no longer stopped. Publishing and pushing are allowed again.',
  unattended: '[harness] Owner mode: run-unattended. Do not end a turn to ask permission for a step inside the agreed work; do it. '
    + 'This never lifts an owner gate, an owner-only decision (spend, secrets, legal, scope) or a hard-to-reverse action that needs confirmation: '
    + 'for those, end the turn with a line starting `Owner decision:`. The owner clears this with "ask me first" or `harness: attended`.',
  attended: '[harness] Owner mode: run-unattended cleared. Ask before steps as you normally would.',
};

// Text the UserPromptSubmit hook adds to the session's context; '' when there is nothing to say.
function noticeFor({ owner, actions, mode }) {
  if (!owner && mode.stopped) {
    return '[harness] The owner stopped this session, and this turn was not started by the owner. Do not publish, push or write '
      + `to GitHub, and do not start new work from it; note in one line what arrived and end the turn. Only the owner lifts the stop with ${LIFT}.`;
  }
  const lines = actions.map((a) => NOTICES[a]);
  if (owner && mode.stopped && !actions.includes('stop')) {
    lines.push(`[harness] The session is still stopped: publishing, pushing and GitHub writes stay blocked until the owner says ${LIFT}. `
      + 'If this instruction needs one of those, say so to the owner in one line.');
  }
  return lines.join('\n');
}

// --- PreToolUse: the hold while stopped, and the agent may not lift the owner's state ---

const ok = Object.freeze({ block: false, reason: '' });
const deny = (reason) => ({ block: true, reason });
const STOP_REASON = `The owner stopped this session. Nothing is published, pushed or written to GitHub until the owner says ${LIFT}. `
  + 'Do not work around this: finish local work, say where it stands, and end the turn.';
const OWNER_ONLY = 'The stop and run-unattended states are set and cleared by the owner only (their own words, or `harness: <state>`). '
  + 'Tell the owner what you need in one line and end the turn.';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const WRITE_VERBS = new Set(['rm', 'mv', 'cp', 'tee', 'truncate', 'ln', 'dd', 'install', 'touch', 'chmod', 'chown', 'rsync', 'sed', 'perl', 'unlink']);
const INTERPRETERS = new Set(['node', 'python', 'python3', 'ruby', 'deno', 'bun', 'bash', 'sh', 'zsh']);
const OWNER_SET = new Set(['continue', 'attended', 'unattended']);
const GH_READ = new Set(['view', 'list', 'status', 'diff', 'checks', 'watch', 'download', 'checkout', 'clone']);
const GH_VALUE_FLAGS = new Set(['-R', '--repo', '--hostname']);
const GH_AREAS = new Set(['pr', 'issue', 'release', 'repo', 'label', 'workflow', 'run', 'gist', 'secret', 'variable', 'project', 'cache']);
const GH_FIELD = /^(?:-[fF]|--field|--raw-field|--input)(?:$|=|(?<=^-[fF]).)/;

// The mode file's folder counts too: deleting .harness/ (or the file by a glob) would lift a stop. Its work folder
// (#112) stays writable.
const HARNESS_ARG = /(?:^|[\s/=('"])\.harness(?:$|[/\s*'")])/;
const mentionsMode = (s) => {
  const t = String(s);
  return t.includes('owner-mode.json') || (HARNESS_ARG.test(t) && !/\.harness\/work\//.test(t));
};
// Writing commands that take the guarded path as an argument; interpreters only when they name the module.
function touchesModeFile(commands) {
  const cdsIn = commands.some(({ argv }) => ['cd', 'pushd'].includes(argv[0]) && mentionsMode(argv[1] ?? ''));
  return commands.some(({ argv, redirects }) => {
    const cmd = path.basename(argv[0] ?? '');
    const writes = WRITE_VERBS.has(cmd) || (cmd === 'git' && ['rm', 'mv', 'restore', 'checkout', 'clean'].includes(argv[1]));
    if (redirects.some(mentionsMode) || (cdsIn && (writes || redirects.length > 0))) return true;
    if (INTERPRETERS.has(cmd)) return argv.slice(1).some((a) => a.includes('owner-mode') && !a.endsWith('owner-mode.js'));
    return writes && argv.slice(1).some(mentionsMode);
  });
}

// `owner-mode.js <anything> continue`: any clearing word after the script name counts, whatever comes between.
const runsOwnerSet = (commands) => commands.some(({ argv }) => {
  const i = argv.findIndex((a) => a.endsWith('owner-mode.js'));
  return i >= 0 && argv.slice(i + 1).some((a) => OWNER_SET.has(a));
});

// gh's own flags (-R o/r, --repo=o/r) may come before the area; drop them first.
function ghArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (out.length === 0 && GH_VALUE_FLAGS.has(args[i])) i += 1;
    else if (!(out.length === 0 && /^-/.test(args[i]))) out.push(args[i]);
  }
  return out;
}

function ghWrites([cmd, ...args]) {
  if (cmd !== 'gh') return false;
  const [sub, ...rest] = ghArgs(args);
  if (sub === 'api') {
    const i = rest.findIndex((a) => a === '-X' || a === '--method');
    const inline = rest.find((a) => /^(?:-X|--method=)./.test(a ?? ''));
    const method = i >= 0 ? rest[i + 1] : inline?.replace(/^(?:-X|--method=)/, '');
    return method ? method.toUpperCase() !== 'GET' : rest.some((a) => GH_FIELD.test(a ?? ''));
  }
  const verb = rest.filter((a, i) => !/^-/.test(a) && !GH_VALUE_FLAGS.has(rest[i - 1]))[0];
  return GH_AREAS.has(sub) && Boolean(verb) && !GH_READ.has(verb);
}

// curl or wget to the GitHub API with a method other than GET, or with a body.
function curlWritesGitHub([cmd, ...args]) {
  if (!['curl', 'wget'].includes(cmd) || !args.some((a) => /api\.github\.com|uploads\.github\.com/.test(a))) return false;
  const i = args.findIndex((a) => a === '-X' || a === '--request' || a === '--method');
  const inline = args.find((a) => /^(?:-X.|--request=|--method=)/.test(a));
  const method = i >= 0 ? args[i + 1] : inline?.replace(/^(?:-X|--request=|--method=)/, '');
  if (method) return method.toUpperCase() !== 'GET';
  return args.some((a) => /^(?:-d|--data|--data-\w+|--json|-F|--form|-T|--upload-file|--post-data|--post-file)(?:$|=)/.test(a) || /^-d./.test(a));
}

// `xargs [flags] git push`: look at the command xargs runs.
function unwrapXargs(argv) {
  if (argv[0] !== 'xargs') return argv;
  const i = argv.findIndex((a, j) => j > 0 && !a.startsWith('-') && !/^-[nLPIEdsa]$/.test(argv[j - 1]));
  return i > 0 ? argv.slice(i) : [];
}

const GITHUB_READ = (name) => /^(?:get|list|search)_/.test(name) || /_read$/.test(name) || /^actions_(?:get|list)$/.test(name);
const PUBLISHES = (name) => /(?:^|_)(?:publish|deploy|push)(?:_|$)/.test(name);

function stoppedVerdict(event) {
  const name = event.tool_name ?? '';
  const input = event.tool_input ?? {};
  if (name === 'Artifact') return ['publish', 'delete'].includes(input.action ?? 'publish') ? deny(STOP_REASON) : ok;
  if (name === 'Bash') {
    const commands = parseCommands(String(input.command ?? ''));
    const writes = commands.map(({ argv }) => unwrapXargs(argv))
      .some((argv) => (argv[0] === 'git' && argv.includes('push')) || ghWrites(argv) || curlWritesGitHub(argv));
    return writes ? deny(STOP_REASON) : ok;
  }
  const [prefix, server, ...rest] = name.split('__');
  if (prefix !== 'mcp' || !server) return ok;
  const toolName = rest.join('__');
  if (/github/i.test(server)) return GITHUB_READ(toolName) ? ok : deny(STOP_REASON);
  return PUBLISHES(toolName) ? deny(STOP_REASON) : ok;
}

function holdVerdict(event, mode) {
  const name = event.tool_name ?? '';
  const input = event.tool_input ?? {};
  if (EDIT_TOOLS.has(name) && mentionsMode(input.file_path ?? input.notebook_path ?? '')) return deny(OWNER_ONLY);
  if (name === 'Bash') {
    const commands = parseCommands(String(input.command ?? ''));
    if (runsOwnerSet(commands) || touchesModeFile(commands)) return deny(OWNER_ONLY);
  }
  return mode.stopped ? stoppedVerdict(event) : ok;
}

// --- Stop: a closing permission question while run-unattended ---

const PERMISSION = new RegExp(String.raw`\b(?:shall i|do you want me to|want me to|would you like me to|may i|can i|ready for me to|`
  + String.raw`should i (?:go ahead|proceed|continue|start|push|merge|publish|open|run|do|move on|begin|keep|carry on)|`
  + String.raw`ok(?:ay)? to (?:proceed|continue|go ahead|start|push|merge|publish))\b`, 'i');
const LET_ME_KNOW = /\blet me know (?:if|whether) (?:you(?:'d| would) like me to|you want me to|i should)\b/i;

// Only the closing paragraph counts: a question asked earlier and answered in the same message is not a stop to ask.
function asksPermission(text) {
  const paragraphs = normal(text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const last = paragraphs[paragraphs.length - 1] ?? '';
  if (LET_ME_KNOW.test(last)) return true;
  return last.split(/(?<=[.?!])\s+/).some((s) => s.trim().endsWith('?') && PERMISSION.test(s));
}

const hasOwnerDecision = (text) => /^\s*(?:[-*>]\s*)?(?:\*\*)?owner decision(?:\*\*)?:/im.test(String(text ?? ''));

const textOf = (content) => (typeof content === 'string' ? content
  : (Array.isArray(content) ? content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n') : ''));

// The closing message: the Stop event's own field where the host sends it, else the transcript's last assistant text.
function lastAssistantText(event) {
  if (typeof event.last_assistant_message === 'string') return event.last_assistant_message;
  if (!event.transcript_path) return '';
  let raw;
  try { raw = fs.readFileSync(event.transcript_path, 'utf8'); } catch { return ''; }
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    const msg = entry?.message;
    if ((entry?.type === 'assistant' || msg?.role === 'assistant') && textOf(msg?.content).trim()) return textOf(msg.content);
  }
  return '';
}

const UNATTENDED_REASON = 'The owner said to run without asking (run-unattended). Do not end the turn to ask permission for a step inside '
  + 'the agreed work: do it now. If what you are asking is an owner gate, an owner-only decision (spend, secrets, legal, scope) '
  + 'or a hard-to-reverse action that needs confirmation, end the turn with a line starting `Owner decision:` that says exactly what is needed.';

module.exports = {
  MODE_FILE, classifyPrompt, isOwnerPrompt, readMode, setMode, applyPrompt, noticeFor, holdVerdict,
  asksPermission, hasOwnerDecision, lastAssistantText, UNATTENDED_REASON,
};
