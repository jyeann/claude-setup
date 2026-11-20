// Tiny DOM helpers. Text goes through textContent and text nodes only: nothing here can parse markup.
const SVG_NS = 'http://www.w3.org/2000/svg';

function applyProps(node, props) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.setAttribute('class', v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k === 'testid') node.setAttribute('data-testid', v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(node, children) {
  if (children === undefined || children === null) return;
  for (const c of Array.isArray(children) ? children : [children]) {
    if (c === undefined || c === null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function h(tag, props, children) {
  const node = document.createElement(tag);
  applyProps(node, props);
  append(node, children);
  return node;
}

export function s(tag, props, children) {
  const node = document.createElementNS(SVG_NS, tag);
  applyProps(node, props);
  append(node, children);
  return node;
}

// <svg class="icon-sm"><use href="#ic-ok"/></svg>
export function icon(name, cls = 'icon-sm') {
  const svg = s('svg', { class: cls, 'aria-hidden': 'true', focusable: 'false' });
  svg.append(s('use', { href: `#${name}` }));
  return svg;
}

export function setIcon(svg, name) {
  const use = svg.querySelector('use');
  if (use && use.getAttribute('href') !== `#${name}`) use.setAttribute('href', `#${name}`);
}

// Writes only when the value changed, so a repaint of an unchanged tick costs no DOM work.
export function setText(node, text) {
  const t = String(text);
  if (node.textContent !== t) node.textContent = t;
}

export function setAttr(node, name, value) {
  if (value === null || value === undefined || value === false) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
    return;
  }
  const v = value === true ? '' : String(value);
  if (node.getAttribute(name) !== v) node.setAttribute(name, v);
}

export function setAttrs(node, attrs) {
  for (const [k, v] of Object.entries(attrs)) setAttr(node, k, v);
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
}

export function setHidden(node, hidden) {
  if (node.hidden !== hidden) node.hidden = hidden;
}

// Moves focus to a heading or container that is not normally focusable.
export function focusEl(node) {
  if (!node) return;
  if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
  node.focus({ preventScroll: false });
}

export const $ = (root, sel) => root.querySelector(sel);
export const $$ = (root, sel) => Array.from(root.querySelectorAll(sel));
export const tid = (id) => `[data-testid="${id}"]`;
