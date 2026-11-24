'use strict';
// Repository layout check: directories that must not exist and paths that tracked docs must not cite.
// The policy is a JSON file kept by the repository that wants the check (see bin/check-layout.js), so the
// harness ships the mechanism and each repository owns its rules.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// "prefix/" matches the start of a path or "prefix/" itself, so "skip": ["plugins/"] covers the whole folder.
const under = (file, prefixes) => prefixes.some((p) => file === p || (p.endsWith('/') && file.startsWith(p)));

function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

// Returns a list of problems, one string each; empty means the layout is clean.
// policy: {forbiddenDirs: [], forbiddenRefs: [], docExtensions: ['.md'], skip: []}
//  - forbiddenRefs match only at the start of a path (not "code-examples/" for "examples/"), so a path in
//    another repository written as `<product-repo>/docs/product/...` is not a reference into this one.
//  - a reference written as `git show <rev>:<path>` points at history and is allowed.
function checkLayout(root, policy, files = trackedFiles(root)) {
  const problems = [];
  for (const dir of policy.forbiddenDirs || []) {
    if (fs.existsSync(path.join(root, dir))) problems.push(`${dir}/ exists`);
  }
  const refs = policy.forbiddenRefs || [];
  if (refs.length === 0) return problems;
  const exts = policy.docExtensions || ['.md'];
  const skip = policy.skip || [];
  const re = new RegExp(`(?<![\\w./-])(?:${refs.map(escape).join('|')})`, 'g');
  for (const file of files) {
    if (!exts.includes(path.extname(file)) || under(file, skip)) continue;
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        if (/git show [^\s:`]+:$/.test(line.slice(0, m.index))) continue;
        problems.push(`${file}:${i + 1} cites ${m[0]}`);
      }
    });
  }
  return problems;
}

module.exports = { checkLayout, trackedFiles };
