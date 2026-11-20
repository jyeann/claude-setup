// Native <dialog> helpers: showModal traps focus, Escape closes, focus returns to the opener.
import { h, icon } from './dom.js';

let counter = 0;

// buttons: [{ id: testid, label, value, primary }]. Resolves with the chosen value, or '' when dismissed.
// focus: testid of the button that gets focus first (always the safe one).
export function openDialog({
  testid, title, body, buttons, focus, opener, extraClass,
}) {
  return new Promise((resolve) => {
    counter += 1;
    const titleId = `dlg-title-${counter}`;
    const dialog = h('dialog', { class: `dialog${extraClass ? ` ${extraClass}` : ''}`, testid, 'aria-labelledby': titleId });
    const actions = h('div', { class: 'dialog-actions' });
    let firstFocus = null;
    for (const b of buttons) {
      const btn = h('button', { type: 'button', class: `btn${b.primary ? ' btn-primary' : ''}`, testid: b.id, text: b.label, on: { click: () => dialog.close(b.value) } });
      if (b.id === focus) firstFocus = btn;
      actions.append(btn);
    }
    dialog.append(h('h2', { id: titleId, text: title }), ...(Array.isArray(body) ? body : [body]), actions);
    dialog.addEventListener('close', () => {
      const value = dialog.returnValue;
      dialog.remove();
      const back = opener && opener.isConnected ? opener : null;
      if (back) back.focus();
      resolve(value);
    });
    document.body.append(dialog);
    dialog.returnValue = '';
    dialog.showModal();
    (firstFocus || actions.querySelector('button')).focus();
  });
}

export const confirmDialog = (opts) => openDialog({ ...opts, buttons: opts.buttons }).then((v) => v === 'yes');

const KEYS = [
  ['Tab', 'Move through controls in the usual order.'],
  ['Arrow keys', 'On the map: move to the nearest node. In the action list: Up and Down.'],
  ['Home, End', 'On the map: first or last node.'],
  ['Enter', 'On a node: inspect it. On an action: apply it.'],
  ['i', 'Inspect the selected node, or the first node that left OK.'],
  ['a', 'Focus the first enabled action.'],
  ['1 to 9', 'In the action list: jump to the nth action without applying it.'],
  ['l', 'Focus the log list.'],
  ['s', 'Say the status: how many nodes are failing and which is worst.'],
  ['[ and ]', 'Select the previous or next node with a firing page.'],
  ['Space', 'Pause or resume. On a button, Space presses the button.'],
  ['.', 'While paused or in text mode: step 1 s.'],
  ['>', 'While paused or in text mode: step 5 s.'],
  ['t', 'Toggle text mode.'],
  ['h', 'Take one hint (costs score, not pager).'],
  ['d', 'When the incident is over: open the debrief.'],
  ['?', 'Open this list.'],
  ['Escape', 'Close a dialog. From the side panels, go back to the selected node.'],
  ['c, r, b', 'In the debrief: copy the result, retry this seed, back to incidents.'],
  ['[ and ] (debrief)', 'In the replay: previous or next action mark.'],
];

export function openKeysDialog(opener) {
  const rows = KEYS.map(([k, d]) => h('tr', null, [h('th', { scope: 'row' }, h('kbd', { text: k })), h('td', { text: d })]));
  const table = h('table', { class: 'keys' }, [h('caption', { class: 'sr-only', text: 'Keyboard shortcuts' }), h('tbody', null, rows)]);
  const note = h('p', { class: 'hint', text: 'Single-letter shortcuts can be turned off with the Shortcuts switch.' });
  return openDialog({
    testid: 'shortcuts-dialog', title: 'Keyboard shortcuts', body: [table, note], opener, focus: 'shortcuts-close', extraClass: 'dialog-keys',
    buttons: [{ id: 'shortcuts-close', label: 'Close', value: 'close', primary: true }],
  });
}

export const dialogIcon = icon;
