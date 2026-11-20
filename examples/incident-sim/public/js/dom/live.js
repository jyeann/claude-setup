// Live regions. Messages are cleared and then set after 50 ms so a repeated message is read again.
import { tid } from './dom.js';

export function createLive(doc = document) {
  const polite = doc.querySelector(tid('status-live'));
  const assertive = doc.querySelector(tid('alert-live'));
  const timers = new Map();
  const put = (node, text) => {
    if (!node || !text) return;
    node.textContent = '';
    clearTimeout(timers.get(node));
    timers.set(node, setTimeout(() => { node.textContent = text; }, 50));
  };
  return {
    polite: (text) => put(polite, text),
    assertive: (text) => put(assertive, text),
  };
}
