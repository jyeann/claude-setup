// Tiny DOM-building helpers. The document is always passed in, so nothing here touches globals.
const SVG_NS = 'http://www.w3.org/2000/svg';

// h(doc, 'button', {testid: 'save-button', class: 'btn', text: 'Save', on: {click}}, [children])
export function h(doc, tag, props = {}, children = []) {
  const el = props.svg ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false || key === 'svg') continue;
    if (key === 'text') el.textContent = value;
    else if (key === 'testid') el.setAttribute('data-testid', value);
    else if (key === 'on') for (const [name, fn] of Object.entries(value)) el.addEventListener(name, fn);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replaceChildren(el, ...nodes) {
  clear(el);
  for (const n of nodes) if (n) el.appendChild(n);
  return el;
}

export function byTestId(root, id) {
  return root.querySelector(`[data-testid="${id}"]`);
}

// Text that only assistive technology reads.
export function srOnly(doc, text) {
  return h(doc, 'span', { class: 'sr-only', text });
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
