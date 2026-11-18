import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLocation, noteUrl, graphUrl, documentTitle, isInternalHref, splitUrl, createRouter } from '../public/js/router.js';
import { makeWindow, Event } from './fake-dom.js';

test('parseLocation: home, graph and notes', () => {
  assert.deepEqual(parseLocation('/'), { name: 'home' });
  assert.deepEqual(parseLocation('/graph'), { name: 'graph', note: null });
  assert.deepEqual(parseLocation('/graph', '?note=Project%20ideas'), { name: 'graph', note: 'Project ideas' });
  assert.deepEqual(parseLocation('/n/Project%20ideas'), { name: 'note', title: 'Project ideas' });
  assert.deepEqual(parseLocation('/n/%C3%A9t%C3%A9'), { name: 'note', title: 'été' });
});

test('parseLocation: a bad note= on the graph is ignored', () => {
  assert.equal(parseLocation('/graph', '?note=..%2Fx').note, null);
  assert.equal(parseLocation('/graph', '?note=').note, null);
});

test('parseLocation: unsafe, malformed and unknown addresses are not found', () => {
  for (const p of ['/n/..', '/n/%2e%2e%2fsecret', '/n/..%2fsecret', '/n/%2e%2e', '/n/', '/n/a/b', '/n/%E0%A4%A', '/n/.hidden', '/n/a%5Cb', '/other', '/graph/', '/n', '/index.html']) {
    assert.deepEqual(parseLocation(p), { name: 'notfound' }, p);
  }
});

test('titles are decoded exactly once', () => {
  assert.deepEqual(parseLocation('/n/100%2525'), { name: 'note', title: '100%25' });
});

test('url builders encode titles', () => {
  assert.equal(noteUrl('A b/c'.replace('/', '')), '/n/A%20bc');
  assert.equal(graphUrl('Project ideas'), '/graph?note=Project%20ideas');
  assert.equal(graphUrl(null), '/graph');
});

test('document titles follow ux.md', () => {
  assert.equal(documentTitle({ name: 'home' }), 'Wiki');
  assert.equal(documentTitle({ name: 'note', title: 'Ideas' }), 'Ideas - Wiki');
  assert.equal(documentTitle({ name: 'note', title: 'ideas' }, 'Ideas'), 'Ideas - Wiki');
  assert.equal(documentTitle({ name: 'graph' }), 'Graph - Wiki');
  assert.equal(documentTitle({ name: 'notfound' }), 'Note not found - Wiki');
});

test('isInternalHref accepts absolute paths only and splitUrl separates the query', () => {
  assert.equal(isInternalHref('/n/A'), true);
  assert.equal(isInternalHref('//evil.example'), false);
  assert.equal(isInternalHref('#'), false);
  assert.equal(isInternalHref('https://x.y'), false);
  assert.equal(isInternalHref(null), false);
  assert.deepEqual(splitUrl('/graph?note=A'), { pathname: '/graph', search: '?note=A' });
  assert.deepEqual(splitUrl('/x'), { pathname: '/x', search: '' });
});

function setup({ dirty = false, leave = true, url = '/' } = {}) {
  const { win, doc } = makeWindow({ url });
  const routes = [];
  const state = { dirty, leave, asked: 0 };
  const router = createRouter({
    win,
    doc,
    onRoute: async (route, meta) => { routes.push({ route, meta }); },
    isDirty: () => state.dirty,
    confirmLeave: async () => { state.asked += 1; return state.leave; },
  });
  return { win, doc, routes, state, router };
}

const link = (doc, href, attrs = {}) => {
  const a = doc.createElement('a');
  a.setAttribute('href', href);
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  const span = doc.createElement('span');
  a.appendChild(span);
  doc.body.appendChild(a);
  return { a, span };
};

test('start dispatches the current location as the initial route', async () => {
  const { router, routes } = setup({ url: '/n/Ideas' });
  await router.start();
  assert.deepEqual(routes[0].route, { name: 'note', title: 'Ideas' });
  assert.equal(routes[0].meta.initial, true);
});

test('clicking an internal link pushes history and routes without a page load', async () => {
  const { router, routes, doc, win } = setup();
  await router.start();
  const { span } = link(doc, '/n/Ideas');
  const ev = new Event('click', { button: 0 });
  span.dispatchEvent(ev);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(ev.defaultPrevented, true);
  assert.equal(win.location.pathname, '/n/Ideas');
  assert.equal(win.history.entries.length, 2);
  assert.deepEqual(routes.at(-1).route, { name: 'note', title: 'Ideas' });
});

test('modified clicks, new-tab links, external links and prevented clicks are left alone', async () => {
  const { router, routes, doc } = setup();
  await router.start();
  const n = routes.length;
  const cases = [
    [link(doc, '/n/A').a, { ctrlKey: true }],
    [link(doc, '/n/A').a, { metaKey: true }],
    [link(doc, '/n/A').a, { button: 1 }],
    [link(doc, '/n/A', { target: '_blank' }).a, {}],
    [link(doc, 'https://example.com').a, {}],
    [link(doc, '#').a, {}],
    [link(doc, '/n/A').a, { defaultPrevented: true }],
  ];
  for (const [a, init] of cases) {
    const ev = new Event('click', { button: 0, ...init });
    a.dispatchEvent(ev);
    if (!init.defaultPrevented) assert.equal(ev.defaultPrevented, false, JSON.stringify(init));
  }
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(routes.length, n);
});

test('a dirty note asks before leaving and stays put when the answer is no', async () => {
  const { router, routes, state, win } = setup({ dirty: true, leave: false, url: '/n/A' });
  await router.start();
  const moved = await router.navigate('/n/B');
  assert.equal(moved, false);
  assert.equal(state.asked, 1);
  assert.equal(win.location.pathname, '/n/A');
  assert.equal(routes.length, 1);
});

test('a dirty note moves on after discard, and force skips the question', async () => {
  const { router, routes, state, win } = setup({ dirty: true, leave: true, url: '/n/A' });
  await router.start();
  assert.equal(await router.navigate('/n/B'), true);
  assert.equal(win.location.pathname, '/n/B');
  assert.equal(await router.navigate('/n/C', { force: true }), true);
  assert.equal(state.asked, 1);
  assert.equal(routes.length, 3);
});

test('navigating to the same address of a dirty note does nothing, a clean one reloads', async () => {
  const dirty = setup({ dirty: true, url: '/n/A' });
  await dirty.router.start();
  assert.equal(await dirty.router.navigate('/n/A'), false);
  assert.equal(dirty.state.asked, 0);
  const clean = setup({ url: '/n/A' });
  await clean.router.start();
  assert.equal(await clean.router.navigate('/n/A'), true);
  assert.equal(clean.routes.length, 2);
  assert.equal(clean.win.history.entries.length, 1);
});

test('replace swaps the history entry instead of adding one', async () => {
  const { router, win } = setup({ url: '/n/A' });
  await router.start();
  await router.navigate('/n/B', { replace: true });
  assert.deepEqual(win.history.entries, ['/n/B']);
});

test('back button routes, and a dirty note puts the address back until the guard answers', async () => {
  const clean = setup({ url: '/n/A' });
  await clean.router.start();
  clean.win.popTo('/n/B');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(clean.routes.at(-1).route, { name: 'note', title: 'B' });

  const stay = setup({ dirty: true, leave: false, url: '/n/A' });
  await stay.router.start();
  stay.win.popTo('/n/B');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(stay.win.location.pathname, '/n/A');
  assert.equal(stay.routes.length, 1);

  const go = setup({ dirty: true, leave: true, url: '/n/A' });
  await go.router.start();
  go.win.popTo('/n/B');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(go.win.location.pathname, '/n/B');
  assert.deepEqual(go.routes.at(-1).route, { name: 'note', title: 'B' });
});

test('a popstate to the address already shown (hash change) is ignored', async () => {
  const { router, routes, win } = setup({ url: '/n/A' });
  await router.start();
  win.popTo('/n/A');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(routes.length, 1);
});

test('beforeunload warns only while the note is dirty', async () => {
  const dirty = setup({ dirty: true });
  await dirty.router.start();
  const ev = dirty.win.emit('beforeunload');
  assert.equal(ev.defaultPrevented, true);
  assert.equal(ev.returnValue, '');
  const clean = setup();
  await clean.router.start();
  assert.equal(clean.win.emit('beforeunload').defaultPrevented, false);
});
