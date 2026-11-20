'use strict';
// Copies the harness into another project. A plugin can ship agents, commands and skills, but not
// permission rules, sandbox settings, a status line or always-loaded rules, and the guards expect to
// live at <project>/.claude/harness. So the plugin carries this installer and the human runs it once.
const fs = require('node:fs');
const path = require('node:path');

const SETTINGS_KEYS = ['permissions', 'sandbox', 'hooks', 'statusLine'];
const GITIGNORE_LINE = '.harness/';
// The harness's own test suite checks this repository (its CI workflow, its manifests), so it stays here.
const SKIP_IN_HARNESS = ['test'];

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const exists = (p) => fs.existsSync(p);
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const union = (a = [], b = []) => [...a, ...b.filter((x) => !a.includes(x))];
const commandsOf = (groups = []) => groups.flatMap((g) => (g.hooks || []).map((h) => h.command));

// Returns the merged settings plus a note per decision. Never drops anything the target already has.
function mergeSettings(target, source) {
  const out = JSON.parse(JSON.stringify(target));
  const notes = [];
  const perms = source.permissions || {};
  out.permissions = out.permissions || {};
  for (const kind of ['allow', 'deny']) {
    const before = out.permissions[kind] || [];
    out.permissions[kind] = union(before, perms[kind]);
    const added = out.permissions[kind].length - before.length;
    if (added > 0) notes.push(`permissions.${kind}: added ${added} rule(s)`);
  }
  for (const key of ['sandbox', 'statusLine']) {
    if (source[key] === undefined) continue;
    if (out[key] === undefined) { out[key] = source[key]; notes.push(`${key}: set`); }
    else if (JSON.stringify(out[key]) !== JSON.stringify(source[key])) notes.push(`${key}: kept your existing value (differs from the harness default)`);
  }
  out.hooks = out.hooks || {};
  for (const [event, groups] of Object.entries(source.hooks || {})) {
    const have = new Set(commandsOf(out.hooks[event]));
    const fresh = groups.filter((g) => !(g.hooks || []).every((h) => have.has(h.command)));
    if (fresh.length === 0) continue;
    out.hooks[event] = [...(out.hooks[event] || []), ...fresh];
    notes.push(`hooks.${event}: added ${fresh.length} hook group(s)`);
  }
  return { settings: out, notes };
}

function copyTree(src, dest, { overwrite, dryRun, skip = [] }) {
  let copied = 0;
  let skipped = 0;
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(src, rel), { withFileTypes: true })) {
      const r = path.join(rel, entry.name);
      if (skip.includes(r)) continue;
      if (entry.isDirectory()) { walk(r); continue; }
      const to = path.join(dest, r);
      if (!overwrite && exists(to)) { skipped += 1; continue; }
      copied += 1;
      if (dryRun) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(src, r), to);
    }
  };
  walk('');
  return { copied, skipped };
}

// sourceClaudeDir: the .claude directory (or plugin root) that holds harness/, rules/ and settings.json.
function install({ sourceClaudeDir, targetDir, dryRun = false, force = false }) {
  const src = path.resolve(sourceClaudeDir);
  const targetClaude = path.join(path.resolve(targetDir), '.claude');
  const fail = (message) => ({ ok: false, message, actions: [] });
  if (!exists(path.join(src, 'harness', 'hooks')) || !exists(path.join(src, 'settings.json'))) {
    return fail(`${src} does not contain harness/ and settings.json`);
  }
  if (!exists(targetDir) || !fs.statSync(targetDir).isDirectory()) return fail(`${targetDir} is not a directory`);
  if (real(src) === real(targetClaude)) return fail('source and target are the same directory; the harness is already here');
  if (exists(path.join(targetDir, '.harness', 'state.json'))) {
    return fail('a harness run is recorded in .harness/state.json; finish it or run `harness.js off` first');
  }

  // Read and merge settings before touching any file, so a broken settings.json changes nothing.
  const settingsFile = path.join(targetClaude, 'settings.json');
  let current = {};
  if (exists(settingsFile)) {
    try { current = readJson(settingsFile); } catch (err) { return fail(`${settingsFile} is not valid JSON (${err.message}); fix it and re-run`); }
  }
  const source = readJson(path.join(src, 'settings.json'));
  const wanted = Object.fromEntries(SETTINGS_KEYS.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]));
  const { settings, notes } = mergeSettings(current, wanted);

  const actions = [];
  const opts = { dryRun };
  const harness = copyTree(path.join(src, 'harness'), path.join(targetClaude, 'harness'), { ...opts, overwrite: true, skip: SKIP_IN_HARNESS });
  actions.push(`.claude/harness: ${harness.copied} file(s) written`);
  for (const [rel, label] of [['rules', '.claude/rules'], ['plans', '.claude/plans']]) {
    if (!exists(path.join(src, rel))) continue;
    const res = copyTree(path.join(src, rel), path.join(targetClaude, rel), { ...opts, overwrite: force });
    actions.push(`${label}: ${res.copied} file(s) written${res.skipped ? `, ${res.skipped} existing kept (use --force to overwrite)` : ''}`);
  }
  if (notes.length === 0) actions.push('.claude/settings.json: already up to date');
  else {
    for (const n of notes) actions.push(`.claude/settings.json: ${n}`);
    if (!dryRun) {
      fs.mkdirSync(targetClaude, { recursive: true });
      fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
    }
  }
  const ignoreFile = path.join(targetDir, '.gitignore');
  const ignore = exists(ignoreFile) ? fs.readFileSync(ignoreFile, 'utf8') : '';
  if (!ignore.split(/\r?\n/).some((l) => l.trim() === GITIGNORE_LINE || l.trim() === '.harness')) {
    actions.push(`.gitignore: added ${GITIGNORE_LINE}`);
    if (!dryRun) fs.writeFileSync(ignoreFile, `${ignore}${ignore && !ignore.endsWith('\n') ? '\n' : ''}${GITIGNORE_LINE}\n`);
  }
  return { ok: true, dryRun, actions };
}

module.exports = { install, mergeSettings, copyTree };
