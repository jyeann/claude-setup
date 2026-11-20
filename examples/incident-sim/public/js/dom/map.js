// PLACEHOLDER written by builder P2 so the play view runs before builder P3's real map lands. P3 overwrites this file.
// Contract: createMap(rootEl, scenario) -> { update(state), setSelected(id|null), onSelect(fn), onActivate(fn), destroy() }.
import { statusOf } from '../../js/engine/engine.js';

export function createMap(rootEl, scenario) {
  let selectFn = () => {};
  let activateFn = () => {};
  const wrap = document.createElement('div');
  const nodes = new Map();
  for (const id of Object.keys(scenario.topology.nodes)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-testid', 'map-node');
    b.setAttribute('data-node', id);
    b.setAttribute('role', 'button');
    b.setAttribute('tabindex', '0');
    const badge = document.createElement('span');
    badge.setAttribute('data-testid', 'map-node-badge');
    b.append(id, ' ', badge);
    b.addEventListener('click', () => { selectFn(id); activateFn(id); });
    wrap.append(b);
    nodes.set(id, { b, badge });
  }
  rootEl.setAttribute('data-testid', 'system-map');
  rootEl.setAttribute('role', 'group');
  rootEl.setAttribute('aria-label', 'System map');
  rootEl.setAttribute('data-ready', 'true');
  rootEl.append(wrap);
  return {
    update(state) {
      for (const [id, n] of nodes) {
        const s = statusOf(state, id);
        n.b.setAttribute('data-status', s);
        n.badge.textContent = { ok: 'OK', warn: 'WARN', crit: 'CRIT', recovering: 'RECV' }[s];
        n.b.setAttribute('data-saturation', String(state.m[id].saturation));
      }
    },
    setSelected(id) { for (const [k, n] of nodes) n.b.setAttribute('data-selected', String(k === id)); },
    onSelect(fn) { selectFn = fn; },
    onActivate(fn) { activateFn = fn; },
    destroy() { wrap.remove(); },
  };
}
