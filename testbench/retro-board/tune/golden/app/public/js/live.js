// Live regions, toasts and focus helpers.

function region(id, attrs) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.className = 'sr-only';
    document.body.append(el);
  }
  return el;
}

const timers = new WeakMap();
function say(el, message) {
  clearTimeout(timers.get(el));
  el.textContent = '';
  timers.set(el, setTimeout(() => { el.textContent = message; }, 50));
}

export const announcePolite = (message) => say(region('live-polite', { 'aria-live': 'polite', 'aria-atomic': 'true' }), message);
export const announceAssertive = (message) => say(region('live-assertive', { role: 'alert' }), message);

let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  clearTimeout(toastTimer);
  el.textContent = message;
  el.hidden = false;
  toastTimer = setTimeout(() => { el.textContent = ''; el.hidden = true; }, 5000);
}

export function focusEl(el) {
  if (el && el.isConnected) el.focus({ preventScroll: false });
}

export function focusHeading(el) {
  if (!el) return;
  el.setAttribute('tabindex', '-1');
  el.focus();
}

// Briefly show "Copied" on a button, then restore its label.
export function flashLabel(button, text, original, ms = 2000) {
  button.textContent = text;
  clearTimeout(button._flash);
  button._flash = setTimeout(() => { button.textContent = original; }, ms);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function selectContents(el) {
  if (typeof el.select === 'function') { el.focus(); el.select(); return; }
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
