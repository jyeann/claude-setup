// The static shell from index.html: header, nav, notices, main. Screens mount into <main>.
import {
  h, icon, clear, focusEl, tid,
} from './dom.js';

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
