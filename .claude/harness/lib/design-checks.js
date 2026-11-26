'use strict';
// A design asset is "done" only with its quality check result attached (#111, spec #109). Each product's
// direction.md names a check command per asset kind in its `## Checks` section; `design-check.js run` runs them and
// writes `docs/design/<product>/checks.json`. A record holds a hash of every file the asset covers, so a file changed,
// added or removed after the check makes the record stale. Hashes (not times) keep a committed record current in a
// fresh clone and after a commit.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { sections } = require('./design');

const DESIGN = 'docs/design';
// Bookkeeping, not assets: editing them never makes a check stale.
const BOOKKEEPING = new Set(['checks.json', 'pages.json', 'direction.md']);
const CHECK_LINE = /^[-*]\s+([A-Za-z0-9][A-Za-z0-9 ._-]*?)\s*:\s*(.*)$/;
const COMMAND = /^`([^`]+)`\s*(?:files:\s*(.+))?$/;
const DEFAULT_TIMEOUT_S = 1800;

const checksFile = (product) => `${DESIGN}/${product}/checks.json`;

// `- <asset>: \`<command>\` files: <glob>, <glob>`. Lines that are not list items are notes and are ignored.
function parseChecks(text, product) {
  const list = [];
  const problems = [];
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!/^[-*]\s/.test(line)) continue;
    const m = CHECK_LINE.exec(line);
    const cmd = m && COMMAND.exec(m[2].trim());
    if (!cmd) { problems.push(`Checks: "${line.slice(0, 60)}" needs the form "- <asset>: \`<command>\` files: <glob>" with the command in backticks`); continue; }
    const asset = m[1];
    if (list.some((c) => c.asset === asset)) { problems.push(`Checks: asset "${asset}" is named twice`); continue; }
    if (cmd[2] && /[{}]/.test(cmd[2])) { problems.push(`Checks: "${asset}" uses braces in files:; list each glob separated by commas instead`); continue; }
    const files = cmd[2] ? cmd[2].split(',').map((g) => g.trim()).filter(Boolean) : [`${DESIGN}/${product}/**`];
    list.push({ asset, command: cmd[1].trim(), files });
  }
  return { checks: list, problems };
}

// Passed and total from the command's output, or null when it prints no count. The last count printed wins.
function countFrom(output) {
  const text = String(output || '');
  const tapPass = [...text.matchAll(/^# pass (\d+)$/gm)].pop();
  if (tapPass) {
    const tapFail = [...text.matchAll(/^# fail (\d+)$/gm)].pop();
    const passed = Number(tapPass[1]);
    return { passed, total: passed + Number(tapFail ? tapFail[1] : 0) };
  }
  const ofTotal = [...text.matchAll(/(\d+)\s*(?:of|\/)\s*(\d+)\s*(?:passed|passing|pass)\b/gi)].pop();
  if (ofTotal) return { passed: Number(ofTotal[1]), total: Number(ofTotal[2]) };
  const line = text.split('\n').filter((l) => /\d+\s+passed\b/i.test(l)).pop();
  if (!line) return null;
  const passed = Number(/(\d+)\s+passed\b/i.exec(line)[1]);
  const failed = /(\d+)\s+failed\b/i.exec(line);
  return { passed, total: passed + (failed ? Number(failed[1]) : 0) };
}

function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; out += '(?:.*/)?'; } else out += '.*';
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

const gitOut = (root, args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
};
const isGit = (root) => gitOut(root, ['rev-parse', '--show-toplevel']) !== null
  && path.resolve(gitOut(root, ['rev-parse', '--show-toplevel']).trim()) === fs.realpathSync(root);

function walk(root, rel = '') {
  const out = [];
  for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (d.name === '.git' || d.name === 'node_modules') continue;
    const p = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...walk(root, p));
    else if (d.isFile()) out.push(p);
  }
  return out;
}

// Every file in the project (tracked and untracked, ignored files left out when it is a git repository).
function projectFiles(root) {
  if (isGit(root)) {
    const listed = gitOut(root, ['ls-files', '-z', '-co', '--exclude-standard']);
    if (listed === null) return walk(root);
    return listed.split('\0').filter((f) => f && fs.existsSync(path.join(root, f)));
  }
  return walk(root);
}

const isBookkeeping = (file) => {
  const parts = file.split('/');
  return parts.length === 4 && `${parts[0]}/${parts[1]}` === DESIGN && BOOKKEEPING.has(parts[3]);
};

// path -> sha1 of each file the asset's globs cover. `cache` shares hashes between assets in one pass.
function fingerprint(root, globs, files = projectFiles(root), cache = new Map()) {
  const res = globs.map(globToRegExp);
  const out = {};
  for (const f of files.filter((x) => !isBookkeeping(x) && res.some((re) => re.test(x))).sort()) {
    const abs = path.join(root, f);
    if (!fs.existsSync(abs)) continue; // removed since the list was taken (e.g. by the check itself)
    if (!cache.has(f)) cache.set(f, crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex'));
    out[f] = cache.get(f);
  }
  return out;
}

function changedFiles(before, now) {
  const all = new Set([...Object.keys(before), ...Object.keys(now)]);
  return [...all].filter((f) => before[f] !== now[f]).sort();
}

function describeCount(count) {
  return count ? `${count.passed}/${count.total} passed` : 'no count printed';
}

// The file list is taken after the command, so files the check itself writes or removes are part of the record.
function runOne(root, check, { now = () => new Date().toISOString(), timeoutS = DEFAULT_TIMEOUT_S } = {}) {
  const r = spawnSync('sh', ['-c', check.command], {
    cwd: root, encoding: 'utf8', timeout: timeoutS * 1000, maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${r.stdout || ''}${r.stderr || ''}`;
  const count = countFrom(output);
  const exit = typeof r.status === 'number' ? r.status : null;
  // A check that ran nothing (0/0) proves nothing, so it is a fail.
  const ok = exit === 0 && (!count || (count.total > 0 && count.passed === count.total));
  const at = now();
  const how = exit === null ? `stopped (${r.signal || r.error?.code || 'no exit code'})` : `exit ${exit}`;
  const line = `${check.asset}: ${ok ? 'pass' : 'fail'} - ${describeCount(count)}, ${how}, ${at}, \`${check.command}\``;
  return {
    record: {
      asset: check.asset, command: check.command, exit, passed: count ? count.passed : null, total: count ? count.total : null,
      ok, at, line, files: fingerprint(root, check.files),
    },
    output,
  };
}

function validRecords(data, where) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.records)) return [`${where}: needs {"product": "...", "records": [...]}`];
  const problems = [];
  data.records.forEach((r, i) => {
    if (!r || typeof r.asset !== 'string' || typeof r.ok !== 'boolean' || typeof r.line !== 'string'
      || !r.files || typeof r.files !== 'object') problems.push(`${where}: record ${i} needs asset, ok, line and files`);
  });
  return problems;
}

// { records, error }: no file is an empty list; a file that cannot be read or is not valid is an error.
function readRecords(root, product) {
  const rel = checksFile(product);
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) return { records: [], error: null };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const problems = validRecords(data, rel);
    return problems.length ? { records: [], error: problems.join('; ') } : { records: data.records, error: null };
  } catch (err) { return { records: [], error: `${rel}: ${err.message}` }; }
}

// Latest record per asset; records for assets not run this time are kept.
function writeRecords(root, product, fresh) {
  const { records, error } = readRecords(root, product);
  const kept = error ? [] : records.filter((r) => !fresh.some((f) => f.asset === r.asset));
  const data = { product, records: [...kept, ...fresh].sort((a, b) => a.asset.localeCompare(b.asset)) };
  const file = path.join(root, checksFile(product));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return data;
}

// One entry per asset kind: done (with its check line), or not done with why.
// state: done | failing | missing | stale.
function assetStatus(root, product, checkList, records, files = projectFiles(root), cache = new Map()) {
  const fingerprint_ = (globs) => fingerprint(root, globs, files, cache);
  return checkList.map((check) => {
    const rec = records.find((r) => r.asset === check.asset);
    if (!rec) return { product, asset: check.asset, state: 'missing', why: 'no check record', files: Object.keys(fingerprint_(check.files)) };
    if (rec.command !== check.command) return { product, asset: check.asset, state: 'stale', why: `stale: the check command changed since ${rec.at}`, line: rec.line, changed: [`${DESIGN}/${product}/direction.md`] };
    const changed = changedFiles(rec.files, fingerprint_(check.files));
    if (changed.length) return { product, asset: check.asset, state: 'stale', why: `stale: changed since the check (${rec.at}): ${changed.join(', ')}`, line: rec.line, changed };
    if (!rec.ok) return { product, asset: check.asset, state: 'failing', why: `check failed: ${rec.line}`, line: rec.line };
    return { product, asset: check.asset, state: 'done', line: rec.line };
  });
}

// Every product's check status, plus problems that stop the status being known.
function statusAll(root, productDirs, { product } = {}) {
  const items = [];
  const problems = [];
  const files = productDirs.length ? projectFiles(root) : [];
  const cache = new Map();
  for (const p of productDirs.filter((x) => !product || x === product)) {
    const dirFile = path.join(root, DESIGN, p, 'direction.md');
    if (!fs.existsSync(dirFile)) continue;
    const parsed = parseChecks(sections(fs.readFileSync(dirFile, 'utf8')).get('Checks') || '', p);
    problems.push(...parsed.problems.map((x) => `${DESIGN}/${p}/direction.md: ${x}`));
    const { records, error } = readRecords(root, p);
    if (error) { problems.push(error); continue; }
    items.push(...assetStatus(root, p, parsed.checks, records, files, cache));
  }
  return { items, problems };
}

// Uncommitted files, for the Stop hook; null when this is not a git repository.
function dirtyFiles(root) {
  if (!isGit(root)) return null;
  const out = gitOut(root, ['status', '--porcelain', '-z', '-uall']);
  if (out === null) return null;
  const entries = out.split('\0').filter(Boolean);
  const files = new Set();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    files.add(e.slice(3));
    if (/^[RC]/.test(e)) i++; // the next entry is the rename's source path
  }
  return files;
}

// Stop hook: assets being worked on now (uncommitted changes to their files, or to direction.md for a changed
// command) whose record is stale or missing. A stale record that arrived committed (a merge, a pull) does not hold
// unrelated sessions; `status` still lists it as not done. Outside git every stale or missing asset counts.
function staleForStop(root, productDirs) {
  const dirty = dirtyFiles(root);
  if (dirty && dirty.size === 0) return []; // nothing being worked on: skip hashing entirely
  const { items } = statusAll(root, productDirs);
  const touched = (list) => !dirty || list.some((f) => dirty.has(f));
  return items.filter((i) => (i.state === 'stale' && touched(i.changed || []))
    || (i.state === 'missing' && i.files.length && touched(i.files)));
}

module.exports = {
  parseChecks, countFrom, globToRegExp, fingerprint, projectFiles, runOne, readRecords, writeRecords,
  assetStatus, statusAll, staleForStop, checksFile,
};
