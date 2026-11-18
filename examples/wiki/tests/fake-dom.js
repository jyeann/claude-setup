// A small DOM for unit tests: enough of Document, Element, events, focus, <dialog> and selectors for the UI modules.
// Not a test file (no .test.js suffix), so the runner does not execute it.
const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'hr']);

class Node {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; this.listeners = new Map(); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  appendChild(n) {
    if (n instanceof Fragment) { for (const c of [...n.childNodes]) this.appendChild(c); return n; }
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this; this.childNodes.push(n); return n;
  }
  removeChild(n) {
    const i = this.childNodes.indexOf(n);
    if (i === -1) throw new Error('not a child');
    this.childNodes.splice(i, 1); n.parentNode = null; return n;
  }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener(type, fn) { const l = this.listeners.get(type); if (l) this.listeners.set(type, l.filter((f) => f !== fn)); }
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    for (let n = this; n; n = n.parentNode) {
      ev.currentTarget = n;
      for (const fn of [...(n.listeners.get(ev.type) || [])]) fn(ev);
      if (!ev.bubbles || ev.stopped) break;
    }
    return !ev.defaultPrevented;
  }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.childNodes = []; if (v !== '') this.appendChild(new Text(this.ownerDocument, String(v))); }
}

class Text extends Node {
  constructor(doc, data) { super(doc); this.data = data; this.nodeType = 3; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

class Fragment extends Node { constructor(doc) { super(doc); this.nodeType = 11; } }

export class Event {
  constructor(type, init = {}) { this.type = type; this.bubbles = init.bubbles !== false; this.defaultPrevented = false; Object.assign(this, init); }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
}

function parseSelector(sel) {
  return sel.split(',').map((part) => part.trim().split(/\s+/).map((compound) => {
    const c = { tag: null, id: null, classes: [], attrs: [], nots: [] };
    let s = compound;
    const not = /:not\(([^)]*)\)/g;
    for (let m = not.exec(s); m; m = not.exec(s)) c.nots.push(parseSelector(m[1])[0][0]);
    s = s.replace(not, '');
    const re = /^([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|([^\]]*)))?\]/g;
    for (let m = re.exec(s); m; m = re.exec(s)) {
      if (m[1]) c.tag = m[1].toLowerCase();
      else if (m[2]) c.id = m[2];
      else if (m[3]) c.classes.push(m[3]);
      else c.attrs.push([m[4], m[5] ?? m[6] ?? null]);
    }
    return c;
  }));
}

function matchCompound(el, c) {
  if (c.tag && el.localName !== c.tag) return false;
  if (c.id && el.getAttribute('id') !== c.id) return false;
  const cls = (el.getAttribute('class') || '').split(/\s+/);
  if (!c.classes.every((k) => cls.includes(k))) return false;
  if (!c.attrs.every(([k, v]) => (v === null ? el.hasAttribute(k) : el.getAttribute(k) === v))) return false;
  return !c.nots.some((n) => matchCompound(el, n));
}

function matches(el, sel) {
  return parseSelector(sel).some((chain) => {
    if (!matchCompound(el, chain[chain.length - 1])) return false;
    let cur = el.parentNode;
    for (let i = chain.length - 2; i >= 0; i -= 1) {
      while (cur && !(cur.localName && matchCompound(cur, chain[i]))) cur = cur.parentNode;
      if (!cur) return false;
      cur = cur.parentNode;
    }
    return true;
  });
}

export class Element extends Node {
  constructor(doc, tag) {
    super(doc);
    this.nodeType = 1; this.localName = tag.toLowerCase(); this.tagName = tag.toUpperCase();
    this.attrs = new Map(); this._value = ''; this.open = false; this.scroll = 0;
  }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get id() { return this.getAttribute('id') || ''; }
  get value() { return this._value; }
  set value(v) { this._value = String(v); }
  get disabled() { return this.hasAttribute('disabled'); }
  select() { this.selected = true; }
  descendants() { const out = []; const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 1) { out.push(c); walk(c); } } }; walk(this); return out; }
  querySelectorAll(sel) { return this.descendants().filter((e) => matches(e, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  matches(sel) { return matches(this, sel); }
  closest(sel) { for (let e = this; e && e.nodeType === 1; e = e.parentNode) if (matches(e, sel)) return e; return null; }
  focus() {
    if (this.disabled) return;
    const doc = this.ownerDocument;
    if (doc.activeElement === this) return;
    const prev = doc.activeElement;
    doc.activeElement = this;
    if (prev && prev !== this) prev.dispatchEvent(new Event('blur', { bubbles: false }));
    this.dispatchEvent(new Event('focus', { bubbles: false }));
  }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click', { button: 0 })); }
  getBoundingClientRect() { return { width: 800, height: 600, x: 0, y: 0, top: 0, left: 0 }; }
  showModal() {
    this.open = true; this.setAttribute('open', ''); this.opener = this.ownerDocument.activeElement;
    const first = this.querySelector('input, button, textarea');
    if (first) first.focus();
  }
  close() {
    if (!this.open) return;
    this.open = false; this.removeAttribute('open');
    if (this.opener && this.opener.focus) this.opener.focus();
    this.dispatchEvent(new Event('close', { bubbles: false }));
  }
  submit() { return this.dispatchEvent(new Event('submit', { cancelable: true })); }
}

export class Doc extends Node {
  constructor() {
    super(null);
    this.ownerDocument = this; this.title = ''; this.activeElement = null;
    this.body = new Element(this, 'body'); this.body.parentNode = this; this.childNodes = [this.body];
  }
  createElement(tag) { return new Element(this, tag); }
  createElementNS(ns, tag) { const e = new Element(this, tag); e.namespaceURI = ns; return e; }
  createTextNode(d) { return new Text(this, d); }
  createDocumentFragment() { return new Fragment(this); }
  querySelector(sel) { return this.body.querySelector(sel); }
  querySelectorAll(sel) { return this.body.querySelectorAll(sel); }
  get textContent() { return this.body.textContent; }
}

// Parse the body of a simple HTML document (like public/index.html) into the fake document.
export function loadBody(doc, html) {
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)[1].replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+)/g;
  const stack = [doc.body];
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) { if (m[4].trim() !== '') top.appendChild(doc.createTextNode(m[4].replace(/\s+/g, ' '))); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) { stack.pop(); continue; }
    const el = doc.createElement(tag);
    const attrRe = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    for (let a = attrRe.exec(m[3]); a; a = attrRe.exec(m[3])) el.setAttribute(a[1], a[2] ?? a[3] ?? a[4] ?? '');
    top.appendChild(el);
    if (!VOID.has(tag)) stack.push(el);
  }
  return doc;
}

// A window-like object backed by real timers. `fetchFn` receives root-relative URLs.
export function makeWindow({ html, url = '/', fetchFn, reduced = false, width = 1280, clipboard } = {}) {
  const doc = new Doc();
  if (html) loadBody(doc, html);
  const [pathname, ...rest] = url.split('?');
  const loc = { pathname, search: rest.length ? `?${rest.join('?')}` : '' };
  const listeners = new Map();
  const history = { entries: [url], pushes: 0 };
  const setUrl = (u) => { const [p, ...r] = u.split('?'); loc.pathname = p; loc.search = r.length ? `?${r.join('?')}` : ''; };
  const win = {
    document: doc,
    location: loc,
    history: {
      pushState: (_s, _t, u) => { history.entries.push(u); history.pushes += 1; setUrl(u); },
      replaceState: (_s, _t, u) => { history.entries[history.entries.length - 1] = u; setUrl(u); },
      get entries() { return history.entries; },
    },
    addEventListener: (t, fn) => { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(fn); },
    emit: (t, ev = new Event(t)) => { for (const fn of listeners.get(t) || []) fn(ev); return ev; },
    popTo: (u) => { history.entries.push(u); setUrl(u); return win.emit('popstate'); },
    setTimeout: (...a) => setTimeout(...a),
    clearTimeout: (id) => clearTimeout(id),
    requestAnimationFrame: (fn) => setTimeout(() => fn(), 0),
    performance: { now: () => performance.now() },
    matchMedia: () => ({ matches: reduced }),
    navigator: { platform: 'Linux x86_64', clipboard: clipboard || { writeText: async () => {} } },
    AbortController,
    innerWidth: width,
    fetch: (u, init) => fetchFn(u, init),
  };
  doc.defaultView = win;
  return { win, doc };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll until fn() is truthy or time runs out; returns the value so assertions can use it.
export async function waitFor(fn, { timeout = 3000, step = 10 } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`waitFor timed out: ${fn}`);
    await sleep(step);
  }
}

export const byId = (root, id) => root.querySelector(`[data-testid="${id}"]`);
export const allById = (root, id) => root.querySelectorAll(`[data-testid="${id}"]`);
export const key = (type, init) => new Event(type, init);
