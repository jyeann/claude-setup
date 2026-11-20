// Live-region queue (ux.md "Live regions"). Pure apart from its own closure: callers pass the simulated second.
// Assertive: only new SEV1/SEV2 pages, at most one update per 3 simulated seconds, pages inside the window merge.
// Polite: everything else, joined in order. Log lines and toasts are never announced.
export const ASSERTIVE_GAP = 3;

const trimEnd = (s) => String(s).replace(/[.\s]+$/, '');

export function pageMessage(pages) {
  if (pages.length === 0) return null;
  const parts = pages.map((p) => `SEV${p.severity}: ${trimEnd(p.text)}.`);
  return pages.length === 1 ? `Page. ${parts[0]}` : `${pages.length} new pages. ${parts.join(' ')}`;
}

export function createAnnouncer({ gap = ASSERTIVE_GAP } = {}) {
  let lastAssertive = null;
  let pages = [];
  let polite = [];
  return {
    page(_simTime, { severity, text }) {
      if (severity <= 2) pages.push({ severity, text });
      else polite.push(`Warning. SEV${severity}: ${trimEnd(text)}.`);
    },
    cleared(text) { polite.push(`Cleared: ${trimEnd(text)}.`); },
    say(text) { if (text) polite.push(text); },
    // Returns what to put in each region now. Pages wait until the 3 s window since the last assertive update has passed.
    drain(simTime) {
      let assertive = null;
      if (pages.length > 0 && (lastAssertive === null || simTime - lastAssertive >= gap)) {
        assertive = pageMessage(pages);
        pages = [];
        lastAssertive = simTime;
      }
      const politeText = polite.length > 0 ? polite.join(' ') : null;
      polite = [];
      return { assertive, polite: politeText };
    },
    pending() { return pages.length + polite.length; },
  };
}

const RANK = { crit: 3, warn: 2, recovering: 1, ok: 0 };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// nodes: [{label, status, saturation (fraction)}]. "2 nodes failing, 1 warning. Worst: Cache, saturation 91 percent."
export function statusSummary(nodes) {
  const count = (s) => nodes.filter((n) => n.status === s).length;
  const crit = count('crit');
  const warn = count('warn');
  const recv = count('recovering');
  if (crit + warn + recv === 0) return 'All nodes healthy.';
  const parts = [];
  if (crit) parts.push(plural(crit, 'node failing', 'nodes failing'));
  if (warn) parts.push(plural(warn, 'warning', 'warnings'));
  if (recv) parts.push(`${recv} recovering`);
  let worst = null;
  for (const n of nodes) {
    if (!worst || RANK[n.status] > RANK[worst.status] || (RANK[n.status] === RANK[worst.status] && n.saturation > worst.saturation)) worst = n;
  }
  return `${parts.join(', ')}. Worst: ${worst.label}, saturation ${Math.round(worst.saturation * 100)} percent.`;
}
