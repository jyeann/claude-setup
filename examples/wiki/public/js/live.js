// Live regions and focus helpers. Messages clear first and are set 50 ms later so repeats are re-read.
export function createLive({ statusEl, alertEl, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) }) {
  const pending = new Map();
  function post(el, message) {
    if (pending.has(el)) clearTimer(pending.get(el));
    el.textContent = '';
    pending.set(el, setTimer(() => {
      el.textContent = message;
      pending.delete(el);
    }, 50));
  }
  return {
    announce: (message) => post(statusEl, message),
    alert: (message) => post(alertEl, message),
  };
}

export function focusEl(el) {
  if (el && typeof el.focus === 'function') el.focus();
  return el;
}

// Dialog title text for the "Delete "X"?" style prompts.
export const quoted = (title) => `"${title}"`;

// Mac uses Cmd, everything else Ctrl.
export function shortcutLabel(platform) {
  return /mac|iphone|ipad/i.test(platform || '') ? 'Cmd+K' : 'Ctrl+K';
}

export function isSaveShortcut(ev) {
  return Boolean(ev.ctrlKey || ev.metaKey) && !ev.altKey && String(ev.key).toLowerCase() === 's';
}

export function isSearchShortcut(ev) {
  return Boolean(ev.ctrlKey || ev.metaKey) && !ev.altKey && String(ev.key).toLowerCase() === 'k';
}
