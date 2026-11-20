// Text mode: the table twin of the map. Same engine, no canvas, no map. Clock control is explicit (step and run).
import {
  h, icon, setText, setAttr, setIcon,
} from './shell.js';
import {
  nodeIds, nodeVm, STATUS_LABEL, STATUS_ICON,
} from '../core/viewmodel.js';
import { int, percent } from '../core/format.js';

const COLUMNS = ['Node', 'Status', 'p50', 'p99', 'Errors', 'Saturation', 'Queue', 'Hit rate'];

export function createTextView({ scenario, state, onSelect }) {
  const rows = new Map();
  const body = h('tbody');
  for (const id of nodeIds(state)) {
    const vm = nodeVm(state, scenario, id);
    const btn = h('button', { type: 'button', class: 'btn btn-quiet', text: vm.label, on: { click: () => onSelect(id) } });
    const badgeIcon = icon('ic-ok');
    const badgeText = h('span', { text: 'OK' });
    const badge = h('span', { class: 'badge', 'data-status': 'ok' }, [badgeIcon, badgeText]);
    const cells = Array.from({ length: 6 }, () => h('td'));
    const row = h('tr', { testid: 'text-row', 'data-node': id, 'data-status': 'ok' }, [h('td', null, btn), h('td', null, badge), ...cells]);
    body.append(row);
    rows.set(id, { row, btn, badge, badgeIcon, badgeText, cells });
  }
  const table = h('table', { class: 'text-table' }, [
    h('thead', null, h('tr', null, COLUMNS.map((c) => h('th', { scope: 'col', text: c })))),
    body,
  ]);
  const el = h('section', { class: 'panel text-view', testid: 'text-view', 'aria-labelledby': 'h-text' }, [
    h('div', { class: 'panel-head' }, [h('h2', { id: 'h-text', text: 'System status' }), h('span', { class: 'panel-aside', text: 'Text mode: the clock runs only when you act or step.' })]),
    h('div', { class: 'table-wrap' }, table),
  ]);
  return {
    el,
    update(st, selected) {
      for (const id of nodeIds(st)) {
        const n = rows.get(id);
        const vm = nodeVm(st, scenario, id);
        setAttr(n.row, 'data-status', vm.status);
        setAttr(n.row, 'data-selected', id === selected ? 'true' : 'false');
        setAttr(n.badge, 'data-status', vm.status);
        setIcon(n.badgeIcon, STATUS_ICON[vm.status].slice(1));
        setText(n.badgeText, STATUS_LABEL[vm.status]);
        const v = [`${int(vm.p50)} ms`, `${int(vm.p99)} ms`, percent(vm.errorRate), percent(vm.saturation), vm.queue > 0 ? int(vm.queue) : '-', vm.hitRate === null ? '-' : percent(vm.hitRate)];
        v.forEach((t, i) => setText(n.cells[i], t));
        setAttr(n.btn, 'aria-label', `${vm.label}, select to inspect`);
      }
    },
    focusNode(id) { const n = rows.get(id); if (n) n.btn.focus(); },
    destroy() { el.remove(); },
  };
}
