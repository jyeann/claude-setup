// Keyboard model (ux.md "Keyboard model"). Pure: a key descriptor in, a command name (or null) out.
// targetKind: text | button | map-node | action | slider | dialog | other.
// context: { view: "play" | "debrief" | "other", paused, text, over }.
// Character keys obey the Shortcuts switch (WCAG 2.1.4). Arrows, Enter, Home, End and Escape never do.
export const TARGET_KINDS = Object.freeze(['text', 'button', 'map-node', 'action', 'slider', 'dialog', 'other']);

const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const VECTORS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

export function resolve(d) {
  if (d === null || typeof d !== 'object' || typeof d.key !== 'string') return null;
  const { key, ctrl = false, alt = false, meta = false, targetKind = 'other', context = {}, shortcutsOn = true } = d;
  if (ctrl || alt || meta) return null;
  if (targetKind === 'text' || targetKind === 'dialog') return null;
  const view = context.view || 'other';
  const char = key.length === 1 ? key.toLowerCase() : key;

  if (view === 'play') {
    if (key === 'Escape') return 'escape';
    if (targetKind === 'map-node') {
      if (Object.hasOwn(ARROWS, key)) return `move-${ARROWS[key]}`;
      if (key === 'Home') return 'map-first';
      if (key === 'End') return 'map-last';
      if (key === 'Enter') return 'inspect';
    }
    if (targetKind === 'action') {
      if (key === 'ArrowUp') return 'action-prev';
      if (key === 'ArrowDown') return 'action-next';
      if (key === 'Enter') return 'action-apply';
      if (shortcutsOn && /^[1-9]$/.test(key)) return `jump-${key}`;
    }
  }
  if (!shortcutsOn) return null;

  if (char === '?') return 'help';
  if (view === 'play') {
    const stepping = context.paused === true || context.text === true;
    switch (char) {
      case 'i': return 'inspect';
      case 'a': return 'focus-actions';
      case 'l': return 'focus-log';
      case 's': return 'say-status';
      case '[': return 'alert-prev';
      case ']': return 'alert-next';
      case 't': return 'toggle-text';
      case 'h': return 'hint';
      case 'd': return context.over === true ? 'debrief' : null;
      case '.': return stepping ? 'step-1' : null;
      case '>': return stepping ? 'step-5' : null;
      case ' ': return targetKind === 'other' || targetKind === 'map-node' ? 'pause-toggle' : null;
      default: return null;
    }
  }
  if (view === 'debrief') {
    if (char === 'c') return 'copy';
    if (char === 'r') return 'retry';
    if (char === 'b') return 'back';
    if (char === '[') return 'mark-prev';
    if (char === ']') return 'mark-next';
  }
  return null;
}

// Nearest point from fromId in a direction. points: [{id, x, y}] (y grows downward). Candidates lie in the 90 degree cone of the
// direction; when the cone is empty the nearest point on that side wins. Score = distance along plus twice the sideways drift.
export function nearest(points, fromId, dir) {
  const from = points.find((p) => p.id === fromId);
  const v = VECTORS[dir];
  if (!from || !v) return null;
  let best = null;
  let bestScore = Infinity;
  let fallback = null;
  let fallbackScore = Infinity;
  for (const p of points) {
    if (p.id === fromId) continue;
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    const along = dx * v[0] + dy * v[1];
    if (along <= 0) continue;
    const side = Math.abs(dx * -v[1] + dy * v[0]);
    const score = along + 2 * side;
    if (side <= along && (score < bestScore || (score === bestScore && p.id < best.id))) { best = p; bestScore = score; }
    if (score < fallbackScore) { fallback = p; fallbackScore = score; }
  }
  const hit = best || fallback;
  return hit ? hit.id : null;
}

// Reading order: top to bottom in rows of similar height, then left to right.
export function readingOrder(points, rowTolerance = 24) {
  const sorted = [...points].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const p of sorted) {
    const row = rows.find((r) => Math.abs(r.y - p.y) <= rowTolerance);
    if (row) row.items.push(p);
    else rows.push({ y: p.y, items: [p] });
  }
  return rows.flatMap((r) => r.items.sort((a, b) => a.x - b.x)).map((p) => p.id);
}
