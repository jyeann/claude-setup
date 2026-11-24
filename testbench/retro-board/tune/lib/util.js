'use strict';
// Shared helpers for the graders, make-bases, selftest and run. Node built-ins only.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TUNE = path.resolve(__dirname, '..');
const GOLDEN = path.join(TUNE, 'golden');
const GOLDEN_APP = path.join(GOLDEN, 'app');
const GOLDEN_DOCS = path.join(GOLDEN, 'docs', 'testbench', 'retro-board');
// The harness that holds verify.js. Override with HARNESS_DIR when the kit lives outside the claude-setup repo.
const HARNESS_DIR = process.env.HARNESS_DIR || path.resolve(TUNE, '..', '..', '..', '.claude', 'harness');

// Layout inside every base repo and trial worktree (same as the real repo).
const APP_REL = path.join('testbench', 'retro-board');
const DOCS_REL = path.join('docs', 'testbench', 'retro-board');

const PHASES = ['discover', 'ux', 'design', 'tests', 'build', 'review', 'qa', 'release'];

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const rmrf = (p) => fs.rmSync(p, { recursive: true, force: true });
const exists = (p) => fs.existsSync(p);
const read = (p) => fs.readFileSync(p, 'utf8');
const readIf = (p) => (fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : null);

function copy(from, to, filter) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, filter });
}

// Collects check lines, prints one per check, and decides the exit code.
function reporter(name) {
  const checks = [];
  return {
    check(label, ok, detail = '') {
      checks.push({ label, ok: Boolean(ok), detail });
      console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
      return Boolean(ok);
    },
    done() {
      const failed = checks.filter((c) => !c.ok).length;
      console.log(failed === 0 ? `${name}: ACCEPTED (${checks.length} checks)` : `${name}: REJECTED (${failed} of ${checks.length} checks failed)`);
      return failed === 0 ? 0 : 1;
    },
    failed: () => checks.filter((c) => !c.ok).length,
  };
}

// Split a markdown document into `## ` sections: [{title, body}]. Text before the first heading is dropped.
function sections(md, level = 2) {
  const re = new RegExp(`^#{${level}}\\s+(.*)$`, 'gm');
  const marks = [...md.matchAll(re)];
  return marks.map((m, i) => ({
    title: m[1].trim(),
    body: md.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : md.length),
  }));
}
const findSection = (md, titleRe, level = 2) => sections(md, level).find((s) => titleRe.test(s.title));

// Items of a numbered list: [{n, text}] with continuation lines joined.
function numberedItems(body) {
  const items = [];
  for (const line of body.split('\n')) {
    const m = /^\s{0,3}(\d+)[.)]\s+(.*)$/.exec(line);
    if (m) items.push({ n: Number(m[1]), text: m[2] });
    else if (items.length && line.trim() && !/^#{1,6}\s/.test(line)) items[items.length - 1].text += ` ${line.trim()}`;
  }
  return items;
}

const wordCount = (s) => (String(s).match(/[\p{L}\p{N}][\p{L}\p{N}'’./-]*/gu) || []).length;

// Parse the summary lines of `node --test` (spec reporter: "ℹ tests 5", tap: "# tests 5").
function parseTestSummary(out) {
  const num = (name) => {
    const m = new RegExp(`^(?:ℹ|#)\\s+${name}\\s+(\\d+)\\s*$`, 'm').exec(out);
    return m ? Number(m[1]) : 0;
  };
  return { tests: num('tests'), pass: num('pass'), fail: num('fail'), cancelled: num('cancelled'), skipped: num('skipped'), todo: num('todo') };
}

function run(cmd, args, { cwd, env, timeoutMs = 120_000 } = {}) {
  const { NODE_TEST_CONTEXT, ...base } = process.env;
  const r = spawnSync(cmd, args, { cwd, env: { ...base, ...(env || {}) }, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, killSignal: 'SIGKILL' });
  return { code: r.status, signal: r.signal, out: `${r.stdout || ''}${r.stderr || ''}`, timedOut: r.error && r.error.code === 'ETIMEDOUT' };
}

module.exports = {
  TUNE, GOLDEN, GOLDEN_APP, GOLDEN_DOCS, HARNESS_DIR, APP_REL, DOCS_REL, PHASES,
  tmp, rmrf, exists, read, readIf, copy, reporter, sections, findSection, numberedItems, wordCount, parseTestSummary, run,
};
