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
// policy: {forbiddenDirs: [], forbiddenRefs: [], retiredNames: [], retiredNamesSkip: [], retiredPhrases: [],
//          retiredPhrasesSkip: [], docExtensions: ['.md'], skip: []}
//  - forbiddenRefs match only at the start of a path (not "code-examples/" for "examples/"), so a path in
//    another repository written as `<product-repo>/docs/product/...` is not a reference into this one.
//  - a reference written as `git show <rev>:<path>` points at history and is allowed.
//  - retiredNames are removed skills or tools; they match as a whole name anywhere in a line, path forms
//    such as `.claude/skills/<name>/` included, so no current doc can send an agent to them. There is no
//    `git show` exception; retiredNamesSkip lists files (history) exempt from this check only.
//  - retiredPhrases are retired wording; they match whole words, ignoring case and wrapped across lines, and
//    are reported at the line where they start. retiredPhrasesSkip lists files or folders exempt from this check only.
function checkLayout(root, policy, files = trackedFiles(root)) {
  const problems = [];
  for (const dir of policy.forbiddenDirs || []) {
    if (fs.existsSync(path.join(root, dir))) problems.push(`${dir}/ exists`);
  }
  const refs = policy.forbiddenRefs || [];
  const names = policy.retiredNames || [];
  const phrases = policy.retiredPhrases || [];
  if (refs.length === 0 && names.length === 0 && phrases.length === 0) return problems;
  const exts = policy.docExtensions || ['.md'];
  const skip = policy.skip || [];
  const nameSkip = policy.retiredNamesSkip || [];
  const phraseSkip = policy.retiredPhrasesSkip || [];
  const refRe = refs.length ? new RegExp(`(?<![\\w./-])(?:${refs.map(escape).join('|')})`, 'g') : null;
  const nameRe = names.length ? new RegExp(`(?<![\\w-])(?:${names.map(escape).join('|')})(?![\\w-])`, 'g') : null;
  const words = (p) => p.trim().split(/\s+/).map(escape).join('\\s+');
  const phraseRe = phrases.length ? new RegExp(`(?<![\\w-])(?:${phrases.map(words).join('|')})(?![\\w-])`, 'gi') : null;
  for (const file of files) {
    if (!exts.includes(path.extname(file)) || under(file, skip)) continue;
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      for (const m of refRe ? line.matchAll(refRe) : []) {
        if (/git show [^\s:`]+:$/.test(line.slice(0, m.index))) continue;
        problems.push(`${file}:${i + 1} cites ${m[0]}`);
      }
      for (const m of nameRe && !under(file, nameSkip) ? line.matchAll(nameRe) : []) problems.push(`${file}:${i + 1} names retired ${m[0]}`);
    });
    for (const m of phraseRe && !under(file, phraseSkip) ? text.matchAll(phraseRe) : []) {
      const at = text.slice(0, m.index).split('\n').length;
      problems.push(`${file}:${at} uses retired phrase "${m[0].replace(/\s+/g, ' ')}"`);
    }
  }
  return problems;
}

module.exports = { checkLayout, trackedFiles };
