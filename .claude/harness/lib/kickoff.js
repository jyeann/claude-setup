'use strict';
// Kickoff choices (#128, spec #126): how the owner wants a run handled, chosen before it starts. One file per
// product, <product-repo>/docs/product/<slug>/kickoff.json:
//   { "version": 1, "prototype": false, "choices": { "<id>": "<value>", ... }, "alsoSensitive": ["<area>"] }
// Ids and values are those of the Kickoff Choices page. A choice left out takes its default, the owner's pick of
// 2026-11-26 (posted on #126). The hard limits (spec #126 item 7) are not a choice: they live here, frozen, every
// result carries them, and the file can only add areas to them (alsoSensitive). Each choice also says whether a
// check enforces it today; one that nothing enforces is "recorded only" and names the ticket that will.
const fs = require('node:fs');

const deepFreeze = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v); }); return Object.freeze(o); };

const CHOICES = deepFreeze([
  { id: 'gate_how', group: 'Approving', question: 'How a gate is approved', default: 'word',
    options: { label: 'A label on the GitHub issue', word: 'One word typed in the session' } },
  { id: 'gate1', group: 'Approving', question: 'Who judges Gate 1, the spec', default: 'me', prototypeOnly: ['agent'],
    options: { me: 'The owner, every time', agent_small: 'An agent for small changes; the owner for a new product', agent: 'An agent, always (prototypes only)' } },
  { id: 'gate2', group: 'Approving', question: 'Who judges Gate 2, the result', default: 'me',
    options: { me: 'The owner, every time', agent_fix: 'An agent for fixes; the owner for everything else' } },
  { id: 'merge', group: 'Building', question: 'Who merges pull requests', default: 'agent_safe', prototypeOnly: ['agent_all'],
    options: { me: 'The owner, each one', agent_safe: 'An agent, when both reviewers pass and every check is green, except sensitive work', agent_all: 'An agent, everything that is green (prototypes only)' } },
  { id: 'absent', group: 'Building', question: 'Where the owner is during the build', default: 'absent',
    options: { reachable: 'Reachable; asked when something is needed', absent: 'Absent; keys and accounts collected at kickoff; only a halted run reaches the owner' } },
  { id: 'halt', group: 'Building', question: 'How a halted run reaches the owner', default: 'email',
    options: { list: 'The owner checks the session list', email: 'Email', phone: 'A notification on the phone' } },
  { id: 'standards', group: 'Building', question: 'Who decides which build standards apply', default: 'agent_show',
    options: { me: 'The owner, line by line', agent_show: 'An agent proposes the set; the owner sees a summary and changes the exceptions', agent: 'An agent decides; the owner sees the result at Gate 1' } },
  { id: 'design', group: 'Design', question: 'Which screens are designed first', default: 'key',
    options: { all: 'Every screen', key: 'Key screens only; standard components elsewhere', none: 'None; standard components throughout' } },
  { id: 'look', group: 'Design', question: 'Who picks the look', default: 'me',
    options: { me: 'The owner, from rendered variations', agent: 'An agent picks; the owner sees it at Gate 1' } },
  { id: 'staging', group: 'Checking', question: 'A staging site before going live', default: 'yes',
    options: { yes: 'Yes', no: 'No, straight to live' } },
  { id: 'uat', group: 'Checking', question: 'Who does user acceptance testing', default: 'both',
    options: { agent: 'An agent only', both: 'An agent first, then the owner', me: 'The owner only' } },
  { id: 'security', group: 'Checking', question: 'Who does the security review', default: 'agent',
    options: { agent: 'An agent', both: 'An agent, then a person' } },
]);

const DEFAULTS = Object.freeze(Object.fromEntries(CHOICES.map((c) => [c.id, c.default])));

// Spec #126 item 7: work touching these always stops for the owner, whatever is chosen.
const HARD_LIMITS = deepFreeze([
  { id: 'login', label: 'login and accounts' },
  { id: 'payments', label: 'payments' },
  { id: 'user_data', label: 'user data' },
  { id: 'migrations', label: 'data migrations' },
  { id: 'deploy', label: 'deploy' },
  { id: 'secrets', label: 'secrets' },
  { id: 'spend', label: 'spend' },
  { id: 'legal', label: 'legal' },
]);

const FIELDS = new Set(['version', 'prototype', 'choices', 'alsoSensitive']);
// A field or choice id that reads like a way to loosen the hard limits gets its own message.
const LIMIT_WORDS = /hard|limit|sensitiv|except|exempt|override|skip|bypass/i;
// Advisory only (for the message): the built-in limits never come from the file, so an entry it misses still
// only adds an area.
const NEGATED = /^\s*(?:[!~-]|not\b|no\b|except\b|without\b|exclud|remov|off\b|disabl|minus\b)/i;
const LIMITS_FIXED = 'the hard limits cannot be switched off or narrowed from this file; "alsoSensitive" can only add areas';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const byId = new Map(CHOICES.map((c) => [c.id, c]));

function validate(raw) {
  const errors = [];
  const choices = { ...DEFAULTS };
  const sources = Object.fromEntries(CHOICES.map((c) => [c.id, 'default']));
  const hardLimits = HARD_LIMITS.map((h) => ({ ...h }));
  const result = (prototype) => ({ ok: errors.length === 0, errors, choices, sources, prototype, hardLimits });
  if (!isObject(raw)) {
    errors.push('the kickoff file must be a JSON object');
    return result(false);
  }
  for (const key of Object.keys(raw)) {
    if (FIELDS.has(key)) continue;
    errors.push(LIMIT_WORDS.test(key) ? `field "${key}": ${LIMITS_FIXED}` : `unknown field "${key}" (allowed: ${[...FIELDS].join(', ')})`);
  }
  if (raw.version !== undefined && raw.version !== 1) errors.push(`"version" must be 1, not ${JSON.stringify(raw.version)}`);
  if (raw.prototype !== undefined && typeof raw.prototype !== 'boolean') errors.push('"prototype" must be true or false');
  const prototype = raw.prototype === true;

  if (raw.choices !== undefined && !isObject(raw.choices)) errors.push('"choices" must be an object of choice id to value');
  for (const [id, value] of Object.entries(isObject(raw.choices) ? raw.choices : {})) {
    const c = byId.get(id);
    if (!c) {
      errors.push(LIMIT_WORDS.test(id) ? `choice "${id}": ${LIMITS_FIXED}` : `unknown choice "${id}" (known: ${CHOICES.map((x) => x.id).join(', ')})`);
    } else if (typeof value !== 'string' || !Object.hasOwn(c.options, value)) {
      errors.push(`choice ${id}: ${JSON.stringify(value)} is not one of ${Object.keys(c.options).join(', ')}`);
    } else if ((c.prototypeOnly ?? []).includes(value) && !prototype) {
      errors.push(`choice ${id}: "${value}" is for prototypes only; set "prototype": true or pick another value`);
    } else {
      choices[id] = value;
      sources[id] = 'file';
    }
  }

  if (raw.alsoSensitive !== undefined) {
    if (!Array.isArray(raw.alsoSensitive)) errors.push('"alsoSensitive" must be a list of areas to add to the hard limits');
    else {
      for (const area of raw.alsoSensitive) {
        if (typeof area !== 'string' || !area.trim()) errors.push('"alsoSensitive" entries must be non-empty text');
        else if (NEGATED.test(area)) errors.push(`"alsoSensitive" entry "${area}": entries can only add an area, never remove one; ${LIMITS_FIXED}`);
        else if (!hardLimits.some((h) => [h.id, h.label].some((n) => n.toLowerCase() === area.trim().toLowerCase()))) {
          hardLimits.push({ id: area.trim(), label: area.trim(), added: true });
        }
      }
    }
  }
  // An invalid file applies nothing: every choice reads as its default, so no tool can act on half a file.
  if (errors.length) {
    Object.assign(choices, DEFAULTS);
    for (const id of Object.keys(sources)) sources[id] = 'default';
  }
  return result(prototype);
}

function readKickoff(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return { ...validate({}), file, missing: true };
    return { ...validate({}), ok: false, errors: [`cannot read ${file}: ${err.code ?? err.message}`], file, missing: false };
  }
  let raw;
  try { raw = JSON.parse(text); } catch (err) {
    return { ...validate({}), ok: false, errors: [`${file} is not valid JSON: ${err.message}`], file, missing: false };
  }
  return { ...validate(raw), file, missing: false };
}

// Whether a check enforces a choice's current value today, and which; `choices` is the whole resolved set,
// because some checks hold only while another choice keeps the owner at a gate.
const LABEL_GATE = 'pipeline.js waits for the label on the spec issue, and a harness guard stops agents adding it with gh';
// A known hole in an enforced choice: shown beside it until the ticket closes it.
const LABEL_GAP = 'agents can still add the label through the GitHub MCP tools or curl; closing this is planned in #146';
const TODAY = 'matches how a run works today, but no check holds it';
const ENFORCEMENT = {
  gate_how: (v) => (v === 'label'
    ? [true, LABEL_GATE, LABEL_GAP]
    : [false, 'gates still pass only by the label today; approval by a typed word is planned in #131']),
  gate1: (v) => (v === 'me'
    ? [true, `${LABEL_GATE} (spec-approved)`, LABEL_GAP]
    : [false, 'no agent judge exists; the owner still judges the spec. Planned after #131']),
  gate2: (v) => (v === 'me'
    ? [true, `${LABEL_GATE} (accepted)`, LABEL_GAP]
    : [false, 'no agent judge exists; the owner still judges the result. Planned after #131']),
  merge: (v) => [false, v === 'me'
    ? 'only the rule in working.md says agents merge nothing; a guard that blocks agent merges is planned in #130'
    : 'agents may not merge yet; merging under this rule, with the sensitive-work check, is planned in #130 and #129'],
  absent: (v) => (v === 'reachable'
    ? [false, `${TODAY}: the run asks the owner when it needs something`]
    : [false, 'keys and accounts are not yet collected at kickoff; planned in #132']),
  halt: (v) => (v === 'list'
    ? [false, `${TODAY}: a halted run shows in the session and nothing else is sent`]
    : [false, `a halted run does not yet send ${v === 'email' ? 'an email' : 'a phone notification'}; planned in #133`]),
  standards: () => [false, 'the build standards checklist does not exist yet; it is spec #127, and the run will read this choice in #134'],
  design: () => [false, 'nothing checks which screens are designed yet; planned in #134'],
  look: (v, c) => (v === 'me' && c.gate1 === 'me'
    ? [true, 'pipeline.js needs a "Look:" line in decisions.md, and the owner approves the look with the spec at spec-approved', LABEL_GAP]
    : [false, 'nothing yet lets an agent pick the look in the owner\'s place, or holds the owner\'s pick without the owner judging Gate 1; planned in #134']),
  staging: (v) => (v === 'no'
    ? [false, `${TODAY}: there is no staging step`]
    : [false, 'nothing checks for a staging site yet; planned in #134']),
  uat: (v, c) => (v === 'both' && c.gate2 === 'me'
    ? [true, 'pipeline.js needs an agent walkthrough (qa.md) and then the owner\'s accepted label']
    : [false, 'today the run always does an agent walkthrough and then the owner\'s accepted gate; following this pick is planned in #134']),
  security: () => [false, 'pipeline.js checks the review record for open findings but not that a security review ran; planned in #134'],
};

function enforcement(id, choices) {
  const rule = ENFORCEMENT[id];
  if (!rule) throw new Error(`unknown choice "${id}"`);
  const [enforced, by, gap] = rule(choices[id], choices);
  return gap ? { enforced, by, gap } : { enforced, by };
}

const notEnforced = (choices) => CHOICES.filter((c) => !enforcement(c.id, choices).enforced).map((c) => c.id);

// The plain-language printout for the owner.
function describe(r) {
  const out = [];
  if (r.missing) out.push('No kickoff file yet: these are the defaults (the owner\'s picks of 2026-11-26).', '');
  else if (r.file) out.push(`Kickoff choices from ${r.file}`, '');
  if (!r.ok) {
    out.push('This kickoff file is not valid. Problems:', ...r.errors.map((e) => `  - ${e}`), '', 'Until it is fixed, a run cannot rely on it, and nothing in it applies. The defaults are:', '');
  }
  if (r.prototype) out.push('This product is marked as a prototype.', '');
  let group = '';
  for (const c of CHOICES) {
    if (c.group !== group) {
      if (group) out.push('');
      group = c.group;
      out.push(group);
    }
    const e = enforcement(c.id, r.choices);
    const from = r.sources[c.id] === 'default' ? ' (default)' : '';
    out.push(`  ${c.question}: ${c.options[r.choices[c.id]]}${from}`);
    out.push(`    ${e.enforced ? 'enforced' : 'recorded only: nothing checks this yet'} - ${e.by}`);
    if (e.gap) out.push(`    known gap: ${e.gap}`);
  }
  const missing = notEnforced(r.choices);
  out.push('', `Not enforced yet (${missing.length} of ${CHOICES.length}):`);
  out.push(...(missing.length ? missing.map((id) => `  - ${byId.get(id).question}`) : ['  - none']));
  out.push('', 'Always stops for the owner, whatever is chosen here:');
  out.push(...r.hardLimits.map((h) => `  - ${h.label}${h.added ? ' (added for this product)' : ''}`));
  out.push('  Today this is a rule agents follow (working.md and spec #126); the check that finds such work is planned in #129.');
  return out.join('\n');
}

module.exports = { CHOICES, DEFAULTS, HARD_LIMITS, validate, readKickoff, enforcement, notEnforced, describe };
