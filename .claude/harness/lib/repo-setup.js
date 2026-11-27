'use strict';
// One command that sets up a product repository (spec #108): harness, the two plugins, the labels,
// the repository docs, and a report on the cloud environment. Each row ends as `done` (this run did
// it), `already there`, `needs you` (with a link and one action), or `missing` (check mode only).
// GitHub is reached only through an injected client; the gh client below only lists and creates
// repository labels. It never applies a label to an issue: the gate labels are the owner's to apply.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { install } = require('./install');
const { PIPELINE_COMMAND } = require('./stop-loop');

const LABELS = [
  { name: 'spec-approved', color: '0E8A16', description: 'Owner gate: spec approved. Applied by the owner only.' },
  { name: 'accepted', color: '1D76DB', description: 'Owner gate: result accepted against the spec. Applied by the owner only.' },
  { name: 'design-approved', color: 'C5DEF5', description: 'Owner gate: look and key screens approved. Applied by the owner only.' },
  { name: 'afk', color: 'C2E0C6', description: 'Ticket an agent can finish alone' },
  { name: 'hitl', color: 'F9D0C4', description: 'Ticket that needs a human' },
  { name: 'needs-triage', color: 'FBCA04', description: 'Maintainer needs to evaluate this issue' },
  { name: 'needs-info', color: 'D4C5F9', description: 'Waiting on the reporter for more information' },
  { name: 'wontfix', color: 'FFFFFF', description: 'Will not be actioned' },
  { name: 'needs-fable', color: '5319E7', description: 'Owner approval for a fable run' },
];
const GATE_LABELS = ['design-approved', 'spec-approved', 'accepted'];
const MARKETPLACE = 'jyeann';
const PLUGINS = [
  { id: 'product-team', title: 'Plugin product-team (agents, skills, commands)' },
  { id: 'mattpocock-skills', title: 'Plugin mattpocock-skills (spec, tickets, prototype)' },
];
const DOCS = [
  ['docs/agents/issue-tracker.md', 'issue-tracker.md'],
  ['docs/agents/triage-labels.md', 'triage-labels.md'],
  ['docs/agents/domain.md', 'domain.md'],
  ['GLOSSARY.md', 'GLOSSARY.md'],
  ['docs/adr/README.md', 'adr-README.md'],
];
const ENV_FILE = 'docs/agents/environment.md';
const ENV_LINE = /^Cloud environment: (.+)$/m;
const ENV_DOCS = 'https://code.claude.com/docs/en/claude-code-on-the-web';
const HARNESS_DOCS = 'https://github.com/jyeann/claude-setup/blob/main/.claude/harness/README.md';
const SETUP_DOCS = 'https://github.com/jyeann/claude-setup#new-repository';
const SKIP_IN_HARNESS = ['test', 'fixtures'];
// owner/name as GitHub allows it; anything else could reshape the `gh api` path.
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const exists = (p) => fs.existsSync(p);
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function parseRepo(url) {
  const m = /([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(String(url || '').trim());
  const name = m ? `${m[1]}/${m[2]}` : null;
  return name && REPO_RE.test(name) && !name.split('/').some((p) => /^\.+$/.test(p)) ? name : null;
}

function repoFromGit(dir) {
  const r = spawnSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
  return r.status === 0 ? parseRepo(r.stdout) : null;
}

// runner(cmd, args) -> { status, stdout, stderr, error }. Only `gh api repos/<repo>/labels` is ever called.
function ghClient(runner = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 30000 })) {
  const call = (args) => {
    const r = runner('gh', ['api', ...args]);
    if (r.error) return { ok: false, message: r.error.message };
    if (r.status !== 0) return { ok: false, message: (String(r.stderr || '').trim().split('\n')[0]) || `gh exited ${r.status}` };
    return { ok: true, stdout: String(r.stdout || '') };
  };
  return {
    listLabels(repo) {
      const r = call(['--paginate', `repos/${repo}/labels`, '--jq', '.[].name']);
      return r.ok ? { ok: true, names: r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) } : r;
    },
    createLabel(repo, label) {
      const r = call(['--method', 'POST', `repos/${repo}/labels`,
        '-f', `name=${label.name}`, '-f', `color=${label.color}`, '-f', `description=${label.description}`]);
      return r.ok ? { ok: true } : r;
    },
  };
}

// The harness is current when a dry-run install would change no setting, rule or plan, and every
// harness file in the target equals the source's.
function harnessCurrent(src, targetDir, dry) {
  const rest = dry.actions.filter((a) => !a.startsWith('.claude/harness:'));
  if (!rest.every((a) => /: 0 file\(s\) written|already up to date/.test(a))) return false;
  const from = path.join(src, 'harness');
  const to = path.join(targetDir, '.claude', 'harness');
  const walk = (rel) => fs.readdirSync(path.join(from, rel), { withFileTypes: true }).every((e) => {
    const r = path.join(rel, e.name);
    if (SKIP_IN_HARNESS.includes(r)) return true;
    if (e.isDirectory()) return walk(r);
    return exists(path.join(to, r)) && hash(path.join(to, r)) === hash(path.join(from, r));
  });
  return walk('');
}

function harnessRow(src, targetDir, check, self) {
  const row = { id: 'harness', title: 'Harness (guards, verify gate, rules, settings)' };
  // Run from the product's own installed copy (harness.js init does this): that copy is the harness here.
  // There is nothing to compare it with, so it is not updated; setup-repo.js from claude-setup updates it.
  if (self) return { ...row, status: 'already there', detail: 'this installed copy is running the check' };
  const dry = install({ sourceClaudeDir: src, targetDir, dryRun: true });
  if (!dry.ok) return { ...row, status: 'needs you', detail: dry.message, link: HARNESS_DOCS, action: dry.message.includes('harness.js off') ? 'Finish the run or run `node .claude/harness/bin/harness.js off`, then re-run.' : 'Fix the problem above, then re-run.' };
  if (harnessCurrent(src, targetDir, dry)) return { ...row, status: 'already there' };
  if (check) return { ...row, status: 'missing', detail: 'install or update with this command' };
  const res = install({ sourceClaudeDir: src, targetDir });
  return { ...row, status: 'done', detail: `installed (${res.actions.length} change(s)); review \`git diff\` and commit it` };
}

function readSettings(file) {
  if (!exists(file)) return { ok: true, settings: {} };
  try { return { ok: true, settings: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (err) { return { ok: false, message: `${file} is not valid JSON (${err.message})` }; }
}

function pluginRow(plugin, src, targetDir, check) {
  const row = { id: plugin.id, title: plugin.title };
  const file = path.join(targetDir, '.claude', 'settings.json');
  const read = readSettings(file);
  if (!read.ok) return { ...row, status: 'needs you', detail: read.message, link: file, action: 'Fix .claude/settings.json, then re-run.' };
  const s = read.settings;
  const key = `${plugin.id}@${MARKETPLACE}`;
  const enabled = (s.enabledPlugins || {})[key];
  const known = Boolean((s.extraKnownMarketplaces || {})[MARKETPLACE]);
  if (enabled === false) {
    return { ...row, status: 'needs you', detail: `${key} is switched off in .claude/settings.json`, link: file, action: `Set enabledPlugins."${key}" to true in .claude/settings.json if this product should use it, then re-run.` };
  }
  if (enabled === true && known) return { ...row, status: 'already there' };
  if (check) return { ...row, status: 'missing', detail: `${key} is not enabled in .claude/settings.json` };
  const srcSettings = readSettings(path.join(src, 'settings.json'));
  const market = (srcSettings.ok && (srcSettings.settings.extraKnownMarketplaces || {})[MARKETPLACE])
    || { source: { source: 'github', repo: 'jyeann/claude-setup' } };
  const out = { ...s, extraKnownMarketplaces: { [MARKETPLACE]: market, ...(s.extraKnownMarketplaces || {}) }, enabledPlugins: { ...(s.enabledPlugins || {}), [key]: true } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  return { ...row, status: 'done', detail: `enabled ${key} in .claude/settings.json; plugins load when a session starts, so open a new session here` };
}

// A saved copy of the repository's labels (#118): a JSON array of names or of label objects with a `name`,
// or an object holding such an array under `labels`. Read only while gh cannot reach GitHub.
function readSavedLabels(file) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { return { ok: false, message: err.message }; }
  const list = Array.isArray(data) ? data : data && data.labels;
  if (!Array.isArray(list)) return { ok: false, message: 'expected a JSON array of labels' };
  const names = list.map((l) => (typeof l === 'string' ? l : l && l.name)).filter((n) => typeof n === 'string');
  return { ok: true, names };
}

function labelsRow(repo, github, check, labelsJson) {
  const row = { id: 'labels', title: 'Labels (owner gates, afk/hitl, triage, needs-fable)' };
  const names = LABELS.map((l) => l.name);
  if (!repo) return { ...row, status: 'needs you', detail: 'no GitHub repository found (no origin remote)', link: SETUP_DOCS, action: 'Re-run with --repo owner/name.' };
  const link = `https://github.com/${repo}/labels`;
  let listed = github.listLabels(repo);
  let note = '';
  if (!listed.ok && labelsJson) {
    const saved = readSavedLabels(labelsJson);
    if (!saved.ok) return { ...row, status: 'needs you', detail: `GitHub not reachable (${listed.message}) and the saved copy ${labelsJson} could not be read: ${saved.message}`, link, action: 'Save the repository\'s labels as a JSON array to that file, or re-run where gh can reach GitHub.' };
    note = ` (from the saved copy ${labelsJson}; gh could not reach GitHub: ${listed.message})`;
    listed = { ok: true, names: saved.names };
  }
  if (!listed.ok) {
    return { ...row, status: 'needs you', detail: `GitHub not reachable: ${listed.message}`, link, action: `Create the labels ${names.join(', ')} there, or re-run where gh can reach GitHub, or pass --labels-json <file> with a saved copy of the repository's labels.` };
  }
  const fromSaved = note !== '';
  // GitHub label names are case-insensitive: an existing `Accepted` is the `accepted` label.
  const have = new Set(listed.names.map((n) => n.toLowerCase()));
  const missing = LABELS.filter((l) => !have.has(l.name.toLowerCase()));
  if (missing.length === 0) return { ...row, status: 'already there', link, fromSaved, ...(fromSaved ? { detail: note.slice(2, -1) } : {}) };
  if (check) return { ...row, status: 'missing', detail: `missing: ${missing.map((l) => l.name).join(', ')}${note}`, link, fromSaved };
  const failed = missing.filter((l) => !github.createLabel(repo, l).ok);
  if (failed.length > 0) {
    return { ...row, status: 'needs you', detail: `could not create: ${failed.map((l) => l.name).join(', ')}`, link, action: `Create the labels ${failed.map((l) => l.name).join(', ')} there.` };
  }
  return { ...row, status: 'done', detail: `created: ${missing.map((l) => l.name).join(', ')}`, link };
}

function docsRow(src, targetDir, repo, check) {
  const row = { id: 'docs', title: 'Repository docs (docs/agents/, GLOSSARY.md, docs/adr/)' };
  const missing = DOCS.filter(([to]) => !exists(path.join(targetDir, to)));
  if (missing.length === 0) return { ...row, status: 'already there' };
  const list = missing.map(([to]) => to).join(', ');
  if (check) return { ...row, status: 'missing', detail: `missing: ${list}` };
  for (const [to, from] of missing) {
    const text = fs.readFileSync(path.join(src, 'harness', 'templates', 'repo', from), 'utf8').replaceAll('{{repo}}', repo || '<owner>/<name>');
    fs.mkdirSync(path.dirname(path.join(targetDir, to)), { recursive: true });
    fs.writeFileSync(path.join(targetDir, to), text);
  }
  return { ...row, status: 'done', detail: `wrote ${list}` };
}

// Reported, never created (owner decision on #108): the command records the name the owner gives.
function environmentRow(targetDir, repo, environment, check) {
  const row = { id: 'environment', title: 'Cloud environment (allowed hosts, keys)' };
  const file = path.join(targetDir, ENV_FILE);
  const text = exists(file) ? fs.readFileSync(file, 'utf8') : undefined;
  const current = text === undefined ? undefined : (ENV_LINE.exec(text) || [])[1];
  const ask = { status: 'needs you', link: ENV_DOCS, action: `Create a cloud environment for ${repo || 'this repository'} (its allowed hosts and keys) in Claude Code on the web, then re-run with --environment <name>.` };
  if (environment !== undefined && !/^[\w .()-]{1,64}$/.test(environment)) return { ...row, ...ask, detail: `"${environment}" is not a valid environment name` };
  if (current && (environment === undefined || environment === current)) return { ...row, status: 'already there', detail: current };
  if (environment === undefined) return { ...row, ...ask, detail: 'no cloud environment recorded; this command does not create one' };
  if (check) return { ...row, status: 'missing', detail: `would record ${environment}` };
  // Only the `Cloud environment:` line is ours; any other text the owner wrote in the file is kept.
  const line = `Cloud environment: ${environment}`;
  let out = `# Cloud environment\n\nThe cloud environment product sessions for this repository run in, named by the owner.\n\n${line}\n`;
  if (text !== undefined) out = current ? text.replace(ENV_LINE, line) : `${text}${text.endsWith('\n') || text === '' ? '' : '\n'}${line}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out);
  return { ...row, status: 'done', detail: `recorded ${environment} in ${ENV_FILE}` };
}

// claude-setup itself: its `jyeann` marketplace serves the product-team plugin from its own .claude folder.
function isSetupSource(dir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'marketplace.json'), 'utf8'));
    return m.name === MARKETPLACE && (m.plugins || []).some((p) => p && p.name === 'product-team' && path.resolve(dir, String(p.source)) === path.resolve(dir, '.claude'));
  } catch { return false; }
}

function setupRepo({ sourceClaudeDir, targetDir, repo, github = ghClient(), environment, check = false, labelsJson }) {
  const src = path.resolve(sourceClaudeDir);
  const dir = path.resolve(targetDir);
  if (!exists(dir) || !fs.statSync(dir).isDirectory()) return { ok: false, message: `${dir} is not a directory`, rows: [] };
  if (isSetupSource(dir)) return { ok: false, message: 'the target is this repository (claude-setup); name the product repository', rows: [] };
  const self = real(path.join(dir, '.claude')) === real(src);
  // A target whose .claude resolves into claude-setup (a symlink) would get claude-setup's files rewritten.
  if (self && isSetupSource(path.dirname(real(src)))) return { ok: false, message: 'the target\'s .claude is this repository\'s (claude-setup); name the product repository', rows: [] };
  if (repo !== undefined && parseRepo(repo) !== repo) return { ok: false, message: `--repo must be owner/name, got "${repo}"`, rows: [] };
  const name = repo || repoFromGit(dir);
  const rows = [
    harnessRow(src, dir, check, self),
    ...PLUGINS.map((p) => pluginRow(p, src, dir, check)),
    labelsRow(name, github, check, labelsJson),
    docsRow(src, dir, name, check),
    environmentRow(dir, name, environment, check),
  ];
  const complete = rows.every((r) => r.status === 'done' || r.status === 'already there');
  return { ok: true, targetDir: dir, repo: name, check, rows, complete };
}

function formatChecklist(res) {
  const width = Math.max(...res.rows.map((r) => r.status.length)) + 2;
  const lines = [`Repository setup${res.check ? ' (check only, nothing written)' : ''}: ${res.targetDir}${res.repo ? ` (${res.repo})` : ''}`];
  for (const r of res.rows) {
    lines.push(`  ${`[${r.status}]`.padEnd(width + 1)} ${r.title}${r.detail ? `: ${r.detail}` : ''}`);
    if (r.status !== 'needs you') continue;
    if (r.link) lines.push(`  ${' '.repeat(width + 1)} -> ${r.link}`);
    lines.push(`  ${' '.repeat(width + 1)} ${r.action}`);
  }
  const owner = res.rows.filter((r) => r.status === 'needs you').length;
  const missing = res.rows.filter((r) => r.status === 'missing').length;
  if (res.complete) lines.push('Checklist complete: a product run can start here.');
  else lines.push([owner && `${owner} row(s) need you.`, missing && `${missing} row(s) missing: run without --check to set them up.`].filter(Boolean).join(' '));
  return lines.join('\n');
}

// A product run is one whose definition of done is the whole pipeline (orch-product-team): the same test the
// Stop hook uses to recognise the pipeline's owner gates.
const isProductRun = (verifyCommand) => PIPELINE_COMMAND.test(String(verifyCommand || ''));
const OK = new Set(['done', 'already there']);

// #118: harness.js init runs this before it writes anything. A product run starts only in a repository whose
// setup checklist (check mode: nothing written, nothing created) is complete. A build-only run and the runs
// in claude-setup itself are not checked.
function productRunGate({ sourceClaudeDir, projectDir, verifyCommand, github = ghClient(), labelsJson }) {
  const dir = path.resolve(projectDir);
  if (!isProductRun(verifyCommand)) return { ok: true, checked: false, warnings: [] };
  if (isSetupSource(dir)) return { ok: true, checked: false, warnings: [] };
  const res = setupRepo({ sourceClaudeDir, targetDir: dir, github, labelsJson, check: true });
  if (!res.ok) return { ok: false, checked: true, message: `cannot check the setup checklist: ${res.message}` };
  const warnings = res.rows.filter((r) => r.fromSaved && OK.has(r.status)).map((r) => `${r.title}: ${r.detail}`);
  if (res.complete) return { ok: true, checked: true, warnings, res };
  const open = res.rows.filter((r) => !OK.has(r.status));
  const lines = [`a product run needs a complete setup checklist in ${dir}; not complete:`];
  for (const r of open) {
    lines.push(`  - [${r.status}] ${r.title}${r.detail ? `: ${r.detail}` : ''}`);
    if (r.status === 'needs you') {
      if (r.link) lines.push(`      -> ${r.link}`);
      lines.push(`      ${r.action}`);
    } else lines.push('      Set up by the command below.');
  }
  const env = open.some((r) => r.id === 'environment') ? ' --environment <name>' : '';
  lines.push(`Set the repository up: \`node .claude/harness/bin/setup-repo.js ${dir}${env}\` (or the repo-setup skill), relay every needs-you row to the owner, commit, then start the run again. Nothing was written.`);
  return { ok: false, checked: true, message: lines.join('\n'), res };
}

module.exports = { setupRepo, productRunGate, isProductRun, isSetupSource, ghClient, parseRepo, formatChecklist, LABELS, GATE_LABELS, ENV_FILE };
