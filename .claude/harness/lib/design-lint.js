'use strict';
// Design conformance lint. Inert unless the project has docs/design/tokens.json.
// Checks only what a machine can check honestly: raw color literals that are not tokens, and
// banned patterns from docs/design/slop.rules.json. Spacing, type and taste stay with the design-director.
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_EXT = new Set(['.css', '.scss', '.sass', '.less', '.html', '.htm', '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.astro']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', '.harness', 'docs', 'dist', 'build', 'coverage', '.next', '.turbo', 'out']);
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const FUNC = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(\s*[^)]*\)/g;
const IGNORE = /design-lint-ignore/;

function normHex(h) {
  let s = h.slice(1).toLowerCase();
  if (s.length <= 4) s = [...s].map((c) => c + c).join('');
  if (s.length === 8 && s.endsWith('ff')) s = s.slice(0, 6);
  return `#${s}`;
}
const normFunc = (f) => f.toLowerCase().replace(/\s+/g, '');

function collectValues(node, out) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => collectValues(n, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((n) => collectValues(n, out));
}

function allowedColors(tokens) {
  const values = [];
  collectValues(tokens.color ?? {}, values);
  const set = new Set();
  for (const v of values) {
    for (const m of v.matchAll(HEX)) set.add(normHex(m[0]));
    for (const m of v.matchAll(FUNC)) set.add(normFunc(m[0]));
  }
  return set;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { return err.code === 'ENOENT' ? null : { error: err.message }; }
}

function* walk(dir, root) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(abs, root); } else if (SOURCE_EXT.has(path.extname(e.name))) yield abs;
  }
}

function lintDesign(projectDir) {
  const tokens = readJson(path.join(projectDir, 'docs', 'design', 'tokens.json'));
  if (tokens === null) return { active: false, problems: [] };
  if (tokens.error) return { active: true, problems: [`docs/design/tokens.json is not valid JSON: ${tokens.error}`] };
  const rules = readJson(path.join(projectDir, 'docs', 'design', 'slop.rules.json'));
  const problems = [];
  const compiled = [];
  if (rules?.error) problems.push(`docs/design/slop.rules.json is not valid JSON: ${rules.error}`);
  for (const r of Array.isArray(rules) ? rules : []) {
    try { compiled.push({ id: r.id, message: r.message, re: new RegExp(r.pattern, 'i') }); } catch { problems.push(`slop.rules.json: rule ${r.id} has an invalid pattern`); }
  }
  const allowed = allowedColors(tokens);
  for (const file of walk(projectDir, projectDir)) {
    const rel = path.relative(projectDir, file);
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (IGNORE.test(line)) return;
      const at = (what) => problems.push(`${rel}:${i + 1} ${what}`);
      for (const m of line.matchAll(HEX)) if (!allowed.has(normHex(m[0]))) at(`raw color ${m[0]} is not a token (add it to docs/design/tokens.json or use var(--...))`);
      for (const m of line.matchAll(FUNC)) if (!allowed.has(normFunc(m[0])) && !/var\(/.test(m[0])) at(`raw color ${m[0]} is not a token`);
      for (const r of compiled) if (r.re.test(line)) at(`slop rule ${r.id}: ${r.message}`);
    });
  }
  return { active: true, problems };
}

module.exports = { lintDesign, normHex };
