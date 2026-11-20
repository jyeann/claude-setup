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

// ---------------------------------------------------------------- shell
// The static shell from index.html: header, nav, notices, main. Screens mount into <main>.

export function createShell() {
  const main = document.getElementById('main');
  const header = document.getElementById('app-header');
  const spacer = document.getElementById('mission-slot');
  const notices = document.getElementById('notices');
  const navLinks = Array.from(header.querySelectorAll('[data-nav]'));
  let mission = null;

  const bannerNode = (kind, kicker, iconName, text, testid, role) => h('div', { class: 'banner', 'data-kind': kind }, [
    icon(iconName),
    h('div', { class: 'banner-body' }, [h('span', { class: 'banner-kicker', text: kicker }), h('p', { text, testid, role })]),
  ]);

  return {
    main,
    // Replaces the content of <main>. Returns the container.
    reset() {
      clear(main);
      return main;
    },
    setNav(name) {
      for (const a of navLinks) {
        if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
    },
    setTitle(text) { document.title = text; },
    // Mission bar of the play screen (clock, pager, pause). null removes it.
    setMission(node) {
      if (mission) mission.remove();
      mission = node;
      spacer.hidden = Boolean(node);
      if (node) header.append(node);
    },
    // id -> notice. A second call with the same id replaces it.
    setNotice(id, spec) {
      const old = notices.querySelector(`[data-notice="${id}"]`);
      if (old) old.remove();
      if (!spec) return;
      const wrap = spec.banner
        ? h('div', { class: 'test-banner', testid: spec.testid, text: spec.text })
        : h('div', { class: 'notice-wrap' }, bannerNode(spec.kind || 'note', spec.kicker || 'Note', spec.icon || 'ic-warn', spec.text, spec.testid, spec.role || 'status'));
      wrap.setAttribute('data-notice', id);
      notices.append(wrap);
    },
    focusHeading() {
      const h1 = main.querySelector('h1');
      if (h1) focusEl(h1);
      else focusEl(main);
      window.scrollTo(0, 0);
    },
    hasHeading: () => Boolean(main.querySelector('h1')),
    query: (id) => document.querySelector(tid(id)),
  };
}

export function appErrorBanner({ text, buttonLabel, buttonTestid, onClick, testid = 'app-error' }) {
  const message = h('p', { text });
  const root = h('div', { class: 'banner', 'data-kind': 'error', role: 'alert', testid, tabindex: '-1' }, [
    icon('ic-crit'),
    h('div', { class: 'banner-body' }, [h('span', { class: 'banner-kicker', text: 'Error' }), message]),
    h('button', { type: 'button', class: 'btn btn-primary', testid: buttonTestid, text: buttonLabel, on: { click: onClick } }),
  ]);
  return root;
}
