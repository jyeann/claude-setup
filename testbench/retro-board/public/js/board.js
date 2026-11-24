import { boardApi, ApiError } from './api.js';
import {
  COLUMNS, MAX_CARD, columnLabel, counterText, validateCardText, votesLeftLabel, voteButtonLabel,
  sortCards, withPageRole, withPendingVotes, pollAnnouncements, nextDelay, parseBoardPath, addFailureOutcome, pollFailureKind, shareStartsOpen,
} from './logic.js';
import { announcePolite, announceAssertive, toast, focusEl, focusHeading, flashLabel, copyText, selectContents } from './live.js';

const route = parseBoardPath(window.location.pathname);
const $ = (id) => document.getElementById(id);

// ---- small DOM helpers (createElement and textContent only) -----------------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'testid') el.setAttribute('data-testid', v);
    else if (k === 'data') for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = dv;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

// ---- state -----------------------------------------------------------------

const state = {
  view: null,
  etag: '',
  version: 0,
  byVotes: store.get('retroBoard.sort') === '1',
  pending: 0,
  failures: 0,
  offline: false,
  polling: false,
  timer: 0,
  retryAfter: 0,
  tmp: 0,
  built: false,
  rescued: {},
  votes: [], // vote writes not answered yet, oldest first: {id, voted}
};
let voteTurn = Promise.resolve(); // vote writes go out one at a time, in click order
let api = route ? boardApi(route.p, route.f) : null;
const cols = {}; // key -> {section, h2, count, list, empty, form, ta, counter, error, btn, cardEls: Map, temps: Set}
const ui = {};

const isFac = () => state.view && state.view.role === 'facilitator';
const clone = (v) => structuredClone(v);

// ---- boot ------------------------------------------------------------------

async function load(isRetry = false) {
  $('load-error')?.remove();
  $('loading').hidden = false;
  try {
    const r = await api.get();
    state.view = r.data;
    state.role = r.data.role;
    state.etag = r.etag;
    state.version = r.data.version;
    if (r.data.role !== 'facilitator') api = boardApi(route.p, null);
    $('loading').hidden = true;
    if (!state.built) build();
    render(null);
    if (store.get('retroBoard.justCreated') === '1') { store.del('retroBoard.justCreated'); focusHeading($('board-title')); }
    else if (isRetry) focusHeading($('board-title'));
    schedule(nextDelay(0));
  } catch {
    $('loading').hidden = true;
    showLoadError(isRetry);
  }
}

function showLoadError(focusRetry) {
  $('load-error')?.remove();
  const retry = h('button', { id: 'retry-load', class: 'btn', type: 'button', text: 'Try again' });
  retry.addEventListener('click', () => load(true));
  $('status-region').append(h('div', { id: 'load-error', class: 'banner banner-danger', role: 'alert' },
    h('p', { text: 'Could not load this board. Check your connection and try again.' }), retry));
  if (focusRetry) retry.focus();
}

// ---- building the static structure once ------------------------------------

function build() {
  const header = $('board-header');
  ui.badge = h('span', { id: 'role-badge', testid: 'role-badge', class: 'badge badge-role' });
  header.append(ui.badge);

  const root = $('board-root');
  if (isFac()) root.append(buildShare());

  ui.votesLeft = h('p', { id: 'votes-left', testid: 'votes-left' });
  ui.votesHint = h('p', { id: 'votes-hint', class: 'hint', text: 'Remove a vote to vote on another card.', hidden: true });
  ui.sort = h('button', { id: 'sort-toggle', testid: 'sort-toggle', class: 'btn', type: 'button', 'aria-pressed': 'false', text: 'Sort by votes' });
  ui.sort.addEventListener('click', () => {
    state.byVotes = !state.byVotes;
    store.set('retroBoard.sort', state.byVotes ? '1' : '0');
    render(state.view);
  });
  const toolbar = h('div', { id: 'board-toolbar', class: 'toolbar' },
    h('div', { class: 'votes-wrap' }, ui.votesLeft, ui.votesHint), ui.sort);
  if (isFac()) {
    ui.close = h('button', { class: 'btn', type: 'button' });
    ui.close.addEventListener('click', toggleClosed);
    ui.export = h('a', { id: 'export-link', testid: 'export-link', class: 'btn', 'data-role': 'facilitator', href: `/b/${route.p}/f/${route.f}/export`, text: 'Export markdown' });
    ui.close.setAttribute('data-role', 'facilitator');
    toolbar.append(ui.close, ui.export);
  }
  root.append(toolbar);

  const columns = h('div', { id: 'columns', testid: 'columns' });
  for (const { key, label, hint } of COLUMNS) columns.append(buildColumn(key, label, hint));
  root.append(columns);
  if (!isFac()) root.append(h('p', { id: 'participant-note', class: 'hint', text: 'Cards are anonymous. Your 3 votes are tied to this browser.' }));
  state.built = true;
}

function buildColumn(key, label, hint) {
  const count = h('span', { class: 'count', testid: `count-${key}`, text: '0' });
  const h2 = h('h2', { id: `col-${key}-title`, tabindex: '-1' }, document.createTextNode(`${label} `), count);
  const list = h('ul', { class: 'card-list', id: `cards-${key}`, testid: `cards-${key}` });
  const empty = h('p', { class: 'empty-hint', id: `empty-${key}`, testid: `empty-${key}`, text: hint });
  const section = h('section', { class: 'column', id: `col-${key}`, 'aria-labelledby': `col-${key}-title`, data: { column: key } }, h2, list, empty);
  cols[key] = { key, section, h2, count, list, empty, form: null, cardEls: new Map(), temps: new Set() };
  return section;
}

function buildAddForm(key) {
  const c = cols[key];
  const label = columnLabel(key);
  const ta = h('textarea', {
    id: `new-${key}`, testid: `new-${key}`, rows: '3', 'aria-describedby': `counter-${key} error-${key}`,
  });
  const counter = h('span', { id: `counter-${key}`, class: 'counter', text: counterText(0) });
  const error = h('p', { id: `error-${key}`, testid: `error-${key}`, class: 'field-error', hidden: true });
  const btn = h('button', { id: `add-${key}`, testid: `add-${key}`, class: 'btn btn-primary', type: 'submit', text: 'Add card' });
  const form = h('form', { class: 'add-form', novalidate: true, data: { column: key } },
    h('label', { for: `new-${key}`, class: 'sr-only', text: `Add a card to ${label}` }), ta,
    h('div', { class: 'form-row' }, counter, btn), error);
  c.form = form; c.ta = ta; c.counter = counter; c.error = error; c.btn = btn;
  ta.addEventListener('input', () => {
    counter.textContent = counterText(Array.from(ta.value.trim()).length);
    counter.classList.toggle('over', Array.from(ta.value.trim()).length > MAX_CARD);
    clearError(key);
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); addCard(key); });
  c.h2.after(form);
}

function buildShare() {
  const origin = window.location.origin;
  const pUrl = `${origin}/b/${route.p}`;
  const fUrl = `${origin}/b/${route.p}/f/${route.f}`;
  const open = shareStartsOpen({
    stored: store.get(`retroBoard.share.${route.p}`),
    narrow: typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 759px)').matches,
    justCreated: store.get('retroBoard.justCreated') === '1',
  });

  const toggle = h('button', { id: 'share-toggle', class: 'btn', type: 'button', 'aria-expanded': String(open), 'aria-controls': 'share-blocks', text: open ? 'Hide links' : 'Show links' });
  const blocks = h('div', { id: 'share-blocks', class: 'share-blocks', hidden: !open });
  toggle.addEventListener('click', () => {
    const now = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(now));
    toggle.textContent = now ? 'Hide links' : 'Show links';
    blocks.hidden = !now;
    store.set(`retroBoard.share.${route.p}`, now ? 'shown' : 'hidden');
  });

  const linkBlock = (opts) => {
    const input = h('input', { id: opts.inputId, testid: opts.inputId, class: 'link-input', type: 'text', readonly: true, value: opts.url });
    input.value = opts.url;
    const btn = h('button', { id: opts.btnId, testid: opts.btnId, class: 'btn', type: 'button', 'aria-label': opts.btnLabel, text: opts.btnText });
    const fail = h('p', { class: 'field-error', hidden: true });
    btn.addEventListener('click', async () => {
      if (await copyText(opts.url)) {
        fail.hidden = true;
        flashLabel(btn, 'Copied', opts.btnText);
        announcePolite(opts.done);
      } else {
        fail.textContent = 'Could not copy. Select the link and copy it by hand.';
        fail.hidden = false;
        announcePolite(fail.textContent);
        selectContents(input);
      }
    });
    return h('div', { id: opts.blockId, testid: opts.blockId, class: `link-block ${opts.cls}` },
      h('span', { class: `badge ${opts.badgeCls}`, text: opts.badge }),
      h('h2', { text: opts.heading }),
      h('p', { text: opts.text }),
      h('label', { for: opts.inputId, text: opts.label }),
      h('div', { class: 'link-row' }, input, btn), fail);
  };

  blocks.append(
    linkBlock({
      blockId: 'participant-link-block', cls: 'share', badge: 'Share this', badgeCls: 'badge-share', heading: 'Participant link',
      text: 'Send this link to your team. Anyone with it can read the board, add cards and vote.',
      label: 'Participant link (share this)', inputId: 'participant-link', url: pUrl, btnId: 'copy-participant', btnText: 'Copy', btnLabel: 'Copy participant link', done: 'Participant link copied',
    }),
    linkBlock({
      blockId: 'facilitator-link-block', cls: 'private', badge: 'Private (locked)', badgeCls: 'badge-private', heading: 'Facilitator link',
      text: 'Keep this private. Do not share it. Anyone with it can close the retro, delete any card and export. We cannot recover it for you, so bookmark it now.',
      label: 'Facilitator link (keep private)', inputId: 'facilitator-link', url: fUrl, btnId: 'copy-facilitator', btnText: 'Copy private link', btnLabel: 'Copy facilitator link', done: 'Facilitator link copied',
    }),
  );
  return h('section', { id: 'share-panel', testid: 'share-panel', class: 'share-panel', 'data-role': 'facilitator', 'aria-label': 'Share links' }, toggle, blocks);
}

// ---- rendering (in place merge) --------------------------------------------

function render(prev) {
  const v = state.view;
  document.body.dataset.state = v.closed ? 'closed' : 'open';
  document.title = `${v.title} - Retro board`;
  $('board-title').textContent = v.title;
  ui.badge.textContent = isFac() ? 'Facilitator view' : 'Participant view';

  renderBanner(v);
  if (prev && v.closed && !prev.closed) rescueDrafts();
  if (prev && !v.closed && prev.closed) restoreDrafts();

  ui.votesLeft.textContent = votesLeftLabel(v.votesLeft);
  showVotesSaving();
  ui.votesLeft.hidden = v.closed;
  ui.votesHint.hidden = v.closed || v.votesLeft > 0;
  ui.sort.setAttribute('aria-pressed', String(state.byVotes));
  ui.sort.textContent = state.byVotes ? 'Sorted by votes' : 'Sort by votes';
  if (ui.close) {
    const id = v.closed ? 'reopen-retro' : 'close-retro';
    ui.close.id = id;
    ui.close.setAttribute('data-testid', id);
    ui.close.textContent = v.closed ? 'Reopen retro' : 'Close retro';
  }

  const active = document.activeElement;
  const known = new Set(prev ? prev.cards.map((c) => c.id) : []);
  for (const { key } of COLUMNS) {
    const c = cols[key];
    if (v.closed && c.form) { c.form.remove(); c.form = null; }
    if (!v.closed && !c.form) buildAddForm(key);
    const cards = v.cards.filter((x) => x.column === key);
    c.count.textContent = String(cards.length);
    syncCards(c, sortCards(cards, state.byVotes), v, prev ? known : null);
    c.empty.hidden = cards.length + c.temps.size > 0;
  }
  if (active && active.isConnected && document.activeElement !== active) active.focus();
}

function renderBanner(v) {
  let banner = $('closed-banner');
  if (v.closed && !banner) {
    banner = h('div', { id: 'closed-banner', testid: 'closed-banner', class: 'banner banner-info', text: 'This retro is closed. No more cards or votes.' });
    $('status-region').prepend(banner);
  } else if (!v.closed && banner) {
    banner.remove();
  }
}

function syncCards(c, sorted, v, known) {
  const ids = new Set(sorted.map((x) => x.id));
  for (const [id, el] of c.cardEls) {
    if (!ids.has(id)) { el.remove(); c.cardEls.delete(id); }
  }
  const desired = [];
  for (const card of sorted) {
    let el = c.cardEls.get(card.id);
    if (!el) {
      el = buildCard(card);
      c.cardEls.set(card.id, el);
      if (known && !known.has(card.id) && !card.own) el.classList.add('is-new');
    }
    updateCard(el, card, v);
    desired.push(el);
  }
  desired.push(...c.temps);
  desired.forEach((el, i) => {
    if (c.list.children[i] !== el) c.list.insertBefore(el, c.list.children[i] || null);
  });
}

function buildCard(card) {
  const count = h('span', { class: 'vote-count', testid: 'vote-count' });
  count.append(document.createTextNode('0'), h('span', { class: 'sr-only', text: ' votes' }));
  const text = h('p', { class: 'card-text', testid: 'card-text' });
  const actions = h('div', { class: 'card-actions' }, count);
  const el = h('li', { class: 'card', testid: 'card', data: { cardId: card.id, column: card.column, votes: '0', own: 'false' } }, text, actions);
  el._parts = { text, count, actions, vote: null, del: null, confirm: null };
  return el;
}

function updateCard(el, card, v) {
  const p = el._parts;
  el.dataset.votes = String(card.votes);
  el.dataset.own = String(card.own);
  if (p.text.textContent !== card.text) p.text.textContent = card.text;
  p.count.firstChild.nodeValue = String(card.votes);
  p.count.lastChild.textContent = card.votes === 1 ? ' vote' : ' votes';

  if (v.closed) {
    if (p.vote) { p.vote.remove(); p.vote = null; }
  } else {
    if (!p.vote) {
      p.vote = h('button', { class: 'btn vote-btn', testid: 'vote-btn', type: 'button' });
      p.vote.addEventListener('click', () => toggleVote(card.id));
      p.count.after(p.vote);
    }
    p.vote.setAttribute('aria-pressed', String(card.voted));
    p.vote.textContent = card.voted ? 'Remove vote' : 'Vote';
    p.vote.setAttribute('aria-label', voteButtonLabel(card.voted, card.text));
    const blocked = !card.voted && v.votesLeft <= 0;
    p.vote.disabled = blocked;
    if (blocked) { p.vote.setAttribute('aria-disabled', 'true'); p.vote.setAttribute('aria-describedby', 'votes-hint'); }
    else { p.vote.removeAttribute('aria-disabled'); p.vote.removeAttribute('aria-describedby'); }
  }

  const canDelete = v.role === 'facilitator' || (card.own && !v.closed);
  if (canDelete && !p.del) {
    p.del = h('button', { class: 'btn delete-btn', testid: 'delete-btn', type: 'button', text: 'Delete' });
    p.del.setAttribute('aria-label', `Delete card: ${Array.from(card.text).slice(0, 40).join('')}`);
    p.del.addEventListener('click', () => openConfirm(el));
    p.actions.append(p.del);
  } else if (!canDelete && p.del) {
    p.del.remove(); p.del = null;
    if (p.confirm) { p.confirm.remove(); p.confirm = null; }
  }
}

// ---- add card ----------------------------------------------------------------

function showError(key, message) {
  const c = cols[key];
  if (!c.form) return;
  c.error.textContent = message;
  c.error.hidden = false;
  c.ta.setAttribute('aria-invalid', 'true');
  announceAssertive(message);
}
function clearError(key) {
  const c = cols[key];
  if (!c.form) return;
  c.error.textContent = '';
  c.error.hidden = true;
  c.ta.removeAttribute('aria-invalid');
}

function tempCard(text, key) {
  const t = h('li', { class: 'card is-saving', testid: 'card', data: { cardId: `tmp-${++state.tmp}`, column: key, votes: '0', own: 'true' } },
    h('p', { class: 'card-text', testid: 'card-text', text }), h('p', { class: 'saving', text: 'Saving...' }));
  return t;
}

async function addCard(key) {
  const c = cols[key];
  if (!c.form) return;
  const text = c.ta.value;
  const problem = validateCardText(text);
  if (problem) { showError(key, problem); c.ta.focus(); return; }
  clearError(key);
  c.ta.value = '';
  c.counter.textContent = counterText(0);
  c.counter.classList.remove('over');
  const temp = tempCard(text.trim(), key);
  c.temps.add(temp);
  c.list.append(temp);
  c.empty.hidden = true;
  c.inflight = (c.inflight || 0) + 1;
  c.btn.disabled = true;
  c.ta.focus();
  const form = c.form;
  state.pending++;
  try {
    const r = await api.addCard(key, text);
    c.temps.delete(temp); temp.remove();
    applyOwn(r);
    announcePolite(`Card added to ${columnLabel(key)}`);
  } catch (err) {
    c.temps.delete(temp); temp.remove();
    const alive = c.form === form;
    const out = addFailureOutcome(err, text, alive ? c.ta.value : '');
    if (alive && out.restore) { c.ta.value = text; c.ta.dispatchEvent(new Event('input')); }
    if (!alive || out.rescue) rescueText(text);
    if (out.applyBoard) applyView(withPageRole(out.applyBoard, state.role), { announce: true });
    if (out.message) showError(key, out.message);
    if (cols[key].form === form) c.ta.focus();
    render(state.view);
  } finally {
    state.pending--;
    c.inflight -= 1;
    if (c.form === form) { c.btn.disabled = c.inflight > 0; c.empty.hidden = c.cardEls.size + c.temps.size > 0; }
  }
}

// ---- mutations with optimistic update ----------------------------------------

function applyOwn(r) {
  if (r.data.version >= state.version) {
    state.version = r.data.version;
    state.etag = r.etag;
    const prev = state.view;
    state.view = withPendingVotes(withPageRole(r.data, state.role), state.votes);
    render(prev);
  }
}

function applyView(view, { announce = false, etag } = {}) {
  if (view.version < state.version) return;
  const prev = state.view;
  state.view = withPendingVotes(view, state.votes);
  state.version = view.version;
  if (etag !== undefined) state.etag = etag;
  render(prev);
  if (announce) {
    const msgs = pollAnnouncements(prev, view);
    if (msgs.length) announcePolite(msgs.join('. '));
  }
}

// Until the server has answered, #votes-left says so (aria-busy), so nothing reads a vote as saved too early.
function showVotesSaving() {
  if (ui.votesLeft) ui.votesLeft.setAttribute('aria-busy', String(state.votes.length > 0));
}

// The vote shows at once. Its request waits for the previous vote's answer: two requests in flight can reach
// the server in either order (a "remove vote" before its "vote"), and every answer is laid under the votes
// still waiting (withPendingVotes), so an earlier answer never flips a later click back.
async function toggleVote(id) {
  const card = state.view.cards.find((c) => c.id === id);
  if (!card) return;
  const voted = !card.voted;
  if (voted && state.view.votesLeft <= 0) return;
  const op = { id, voted };
  const before = state.view;
  state.votes.push(op);
  state.view = withPendingVotes(state.view, [op]);
  render(before);
  state.pending++;
  const myTurn = voteTurn;
  let done;
  voteTurn = new Promise((resolve) => { done = resolve; });
  const settle = () => { const i = state.votes.indexOf(op); if (i >= 0) state.votes.splice(i, 1); };
  try {
    await myTurn;
    const r = await (voted ? api.vote(id) : api.unvote(id));
    settle();
    applyOwn(r);
    announcePolite(votesLeftLabel(state.view.votesLeft));
  } catch (err) {
    settle();
    const shown = state.view;
    const undone = withPendingVotes(shown, [{ id, voted: !voted }]);
    if (err instanceof ApiError && err.status === 404) {
      state.view = { ...undone, cards: undone.cards.filter((c) => c.id !== id) };
      render(shown);
      toast('That card was removed.');
      announcePolite('That card was removed.');
    } else if (err instanceof ApiError && err.board) {
      state.version = Math.min(state.version, err.board.version);
      applyView(withPageRole(err.board, state.role));
      toast('Could not save your vote. Try again.');
      announceAssertive('Could not save your vote. Try again.');
    } else {
      state.view = undone;
      render(shown);
      toast('Could not save your vote. Try again.');
      announceAssertive('Could not save your vote. Try again.');
      pollSoon();
    }
  } finally {
    state.pending--;
    showVotesSaving();
    done();
  }
}

// ---- delete ------------------------------------------------------------------

function openConfirm(el) {
  const p = el._parts;
  if (p.confirm) return;
  const yes = h('button', { class: 'btn btn-danger', testid: 'delete-confirm-yes', type: 'button', text: 'Delete' });
  const no = h('button', { class: 'btn', testid: 'delete-confirm-no', type: 'button', text: 'Cancel' });
  const confirm = h('div', { class: 'confirm', testid: 'delete-confirm', role: 'group', 'aria-label': 'Confirm delete' },
    h('p', { text: 'Delete this card?' }), yes, no);
  p.confirm = confirm;
  p.del.hidden = true;
  el.append(confirm);
  const close = () => { confirm.remove(); p.confirm = null; if (p.del) { p.del.hidden = false; focusEl(p.del); } };
  no.addEventListener('click', close);
  confirm.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  yes.addEventListener('click', () => confirmDelete(el));
  no.focus();
}

async function confirmDelete(el) {
  const id = el.dataset.cardId;
  const key = el.dataset.column;
  const c = cols[key];
  const nextEl = el.nextElementSibling && el.nextElementSibling._parts ? el.nextElementSibling : null;
  const before = clone(state.view);
  const next = clone(state.view);
  next.cards = next.cards.filter((x) => x.id !== id);
  state.view = next;
  render(before);
  if (c.ta && c.form) c.ta.focus();
  else if (nextEl && nextEl.isConnected && nextEl._parts.del) nextEl._parts.del.focus();
  else focusHeading(c.h2);
  state.pending++;
  try {
    const r = await api.deleteCard(id);
    applyOwn(r);
    announcePolite('Card deleted');
  } catch (err) {
    if (err instanceof ApiError && err.status === 404 && err.code === 'card_not_found') {
      announcePolite('Card deleted');
    } else {
      state.view = before;
      if (err instanceof ApiError && err.board) applyView(withPageRole(err.board, state.role)); else render(next);
      toast('Could not delete the card. Try again.');
      announceAssertive('Could not delete the card. Try again.');
      pollSoon();
    }
  } finally {
    state.pending--;
  }
}

// ---- close / reopen -------------------------------------------------------------

async function toggleClosed() {
  if (ui.close.disabled) return;
  const target = !state.view.closed;
  ui.close.disabled = true;
  state.pending++;
  try {
    const r = await api.setClosed(target);
    const prev = state.view;
    applyOwn(r);
    announcePolite(pollAnnouncements(prev, state.view).join('. ') || (target ? 'This retro is closed.' : 'The retro is open again.'));
  } catch {
    const msg = 'Could not close the retro. Try again.';
    toast(target ? msg : 'Could not reopen the retro. Try again.');
    announceAssertive(target ? msg : 'Could not reopen the retro. Try again.');
  } finally {
    state.pending--;
    ui.close.disabled = false;
    focusEl(ui.close);
  }
}

// ---- drafts kept when the retro closes ----------------------------------------

function rescueDrafts() {
  const drafts = [];
  for (const { key } of COLUMNS) {
    const c = cols[key];
    if (c.form && c.ta.value.trim()) { state.rescued[key] = c.ta.value; drafts.push(c.ta.value); }
  }
  // note: forms are removed after this call by the column loop, the text is already copied
  if (!drafts.length) return;
  let box = $('draft-rescue');
  if (!box) {
    box = h('div', { id: 'draft-rescue', testid: 'draft-rescue', class: 'banner banner-info' });
    $('status-region').append(box);
  }
  for (const d of drafts) box.append(h('p', { text: `The retro was closed. Your unsent card: ${d}` }));
}

function rescueText(text) {
  let box = $('draft-rescue');
  if (!box) {
    box = h('div', { id: 'draft-rescue', testid: 'draft-rescue', class: 'banner banner-info' });
    $('status-region').append(box);
  }
  box.append(h('p', { text: `Not saved. Your card text: ${text}` }));
}

function restoreDrafts() {
  $('draft-rescue')?.remove();
  queueMicrotask(() => {
    for (const [key, text] of Object.entries(state.rescued)) {
      const c = cols[key];
      if (c.form && !c.ta.value) { c.ta.value = text; c.ta.dispatchEvent(new Event('input')); }
    }
    state.rescued = {};
  });
}

// ---- polling -------------------------------------------------------------------

function schedule(delay) {
  clearTimeout(state.timer);
  state.timer = setTimeout(poll, delay);
}
const pollSoon = () => { state.etag = ''; schedule(300); };

function setOffline(on) {
  state.offline = on;
  let banner = $('offline-banner');
  if (on && !banner) {
    banner = h('div', { id: 'offline-banner', testid: 'offline-banner', role: 'status', class: 'banner banner-warn', text: 'You are offline or the server is not reachable. Showing the last version. Trying again...' });
    $('status-region').append(banner);
  } else if (!on && banner) {
    banner.remove();
  }
}

async function poll() {
  if (state.polling) return;
  if (state.pending > 0) { schedule(500); return; }
  state.polling = true;
  let retryAfter = 0;
  let stop = false;
  try {
    let r;
    try {
      r = await api.get(state.etag);
    } catch (err) {
      const kind = pollFailureKind(err);
      if (kind === 'offline') {
        state.failures += 1;
        retryAfter = err.retryAfter || 0;
        setOffline(true);
      } else if (kind === 'not-found') {
        stop = true;
        setOffline(false);
        showLoadError(false);
      } else {
        console.error(err);
      }
      return;
    }
    if (state.pending > 0) return;
    state.failures = 0;
    try {
      const wasOffline = state.offline;
      if (r.status !== 304) { state.role = r.data.role; applyView(r.data, { announce: !wasOffline, etag: r.etag }); }
      if (wasOffline) { setOffline(false); announcePolite('Back online. Board updated.'); }
    } catch (err) {
      console.error(err);
    }
  } finally {
    state.polling = false;
    if (!stop) schedule(nextDelay(state.failures, retryAfter));
  }
}

// ---- go ------------------------------------------------------------------------

if (!route) {
  $('loading').hidden = true;
  window.location.replace('/');
} else {
  load();
}
