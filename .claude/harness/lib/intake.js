'use strict';
// Intake: the first decision on any piece of work. An agent judges it and writes a verdict file in a fixed format;
// this module parses that file strictly (so a typo is an error, not a silently dropped field) and applies the
// risk floors and reviewer routing that must not depend on an agent's mood.
//
//   DECISION: accept | reject | ask
//   RISK: low | medium | high            (required when accepting)
//   SURFACES: ui, logins, ...            (from SURFACES below; may be empty)
//   REASON: one paragraph                (required for reject and ask; recommended always)
const RISKS = Object.freeze(['low', 'medium', 'high']);
const DECISIONS = Object.freeze(['accept', 'reject', 'ask']);
// What the work touches. A closed list: a surface the pipeline does not know cannot raise a floor or pick a reviewer.
const SURFACES = Object.freeze([
  'ui', 'api', 'data-store', 'money', 'logins', 'personal-data',
  'network-egress', 'runs-generated-code', 'third-party-content',
]);
// Never merged by an agent, whatever the risk tag says.
const SENSITIVE = Object.freeze(['money', 'logins', 'personal-data']);
// Work that touches these cannot be tagged lower than medium.
const MEDIUM_FLOOR = Object.freeze([...SENSITIVE, 'network-egress', 'runs-generated-code', 'third-party-content']);
const REVIEWERS = Object.freeze({
  low: ['code-reviewer'],
  medium: ['code-reviewer', 'security-reviewer'],
  high: ['code-reviewer', 'security-reviewer', 'architect'],
});

const rank = (risk) => RISKS.indexOf(risk);

// The lowest risk this work may carry, and why. Two or more sensitive surfaces together are high.
function riskFloor(surfaces, kind = 'build') {
  const sensitive = surfaces.filter((s) => SENSITIVE.includes(s));
  if (sensitive.length >= 2) return { risk: 'high', why: `touches ${sensitive.join(' and ')} together` };
  const hit = surfaces.filter((s) => MEDIUM_FLOOR.includes(s));
  if (hit.length) return { risk: 'medium', why: `touches ${hit.join(', ')}` };
  if (kind === 'rebuild') return { risk: 'medium', why: 'a rebuild of someone else\'s product' };
  return { risk: 'low', why: '' };
}

function resolveRisk(requested, surfaces, kind) {
  const floor = riskFloor(surfaces, kind);
  if (rank(requested) >= rank(floor.risk)) return { risk: requested, raisedBy: null };
  return { risk: floor.risk, raisedBy: `${floor.why} (tagged ${requested}, raised to ${floor.risk})` };
}

// Reviewers follow the risk, plus the reviewers a surface calls for whatever the risk is.
function reviewersFor(risk, surfaces) {
  const set = [...REVIEWERS[risk]];
  if (surfaces.includes('ui') && !set.includes('a11y-architect')) set.push('a11y-architect');
  if (surfaces.some((s) => MEDIUM_FLOOR.includes(s)) && !set.includes('security-reviewer')) set.push('security-reviewer');
  return set;
}

function parseSurfaces(text) {
  const list = text.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const unknown = list.filter((s) => !SURFACES.includes(s));
  if (unknown.length) throw new Error(`Unknown surface(s): ${unknown.join(', ')}. Use: ${SURFACES.join(', ')}.`);
  return [...new Set(list)];
}

function parseIntake(text) {
  const fields = {};
  let current = null;
  for (const line of String(text).split('\n')) {
    const m = line.match(/^([A-Z]+):\s*(.*)$/);
    if (m && ['DECISION', 'RISK', 'SURFACES', 'REASON'].includes(m[1])) {
      if (m[1] in fields) throw new Error(`Intake verdict has two ${m[1]} lines.`);
      fields[m[1]] = m[2].trim();
      current = m[1];
    } else if (current === 'REASON' && line.trim()) {
      fields.REASON = `${fields.REASON} ${line.trim()}`.trim();
    }
  }
  const decision = (fields.DECISION ?? '').toLowerCase();
  if (!DECISIONS.includes(decision)) throw new Error(`Intake verdict needs "DECISION: ${DECISIONS.join(' | ')}".`);
  const risk = (fields.RISK ?? '').toLowerCase();
  if (decision === 'accept' && !RISKS.includes(risk)) throw new Error(`An accepted intake verdict needs "RISK: ${RISKS.join(' | ')}".`);
  if (risk && !RISKS.includes(risk)) throw new Error(`Unknown risk "${risk}". Use: ${RISKS.join(', ')}.`);
  const reason = fields.REASON ?? '';
  if (decision !== 'accept' && !reason) throw new Error(`A ${decision} verdict needs a REASON.`);
  return { decision, risk: risk || null, surfaces: parseSurfaces(fields.SURFACES ?? ''), reason };
}

module.exports = { RISKS, DECISIONS, SURFACES, SENSITIVE, MEDIUM_FLOOR, REVIEWERS, riskFloor, resolveRisk, reviewersFor, parseSurfaces, parseIntake };
