'use strict';
// List page: render, optimistic writes, and a non-overlapping 2 s poll.
(function () {
  const L = window.PackingLogic;
  const A = window.PackingApi;
  const POLL_MS = 2000;
  const COPIED_MS = 2000;
  const MSG_LOST = 'Connection lost. Trying again...';
  const MSG_SAVE = 'Could not save that change. Try again.';
  const MSG_COPIED = 'Link copied';

  const $ = (id) => document.getElementById(id);
  const title = $('list-title');
  const shareLink = $('share-link');
  const copyButton = $('copy-button');
  const progress = $('progress');
  const bar = $('progress-bar');
  const fill = $('progress-fill');
  const form = $('add-form');
  const input = $('new-item');
  const formError = $('form-error');
  const status = $('status');
  const empty = $('empty');
  const ul = $('items');

  const listId = window.location.pathname.split('/')[2] || '';
  const listUrl = '/api/lists/' + encodeURIComponent(listId);
  const rows = new Map(); // item id -> {li, box, text, remove}
  const pending = new Map(); // item id -> 'tick' | 'remove' | 'add'
  const tickCounts = new Map();
  const chains = new Map();
  let known = []; // items of the last server view
  let epoch = 0; // bumped when a write starts and settles; a poll that spans a bump is discarded
  let tmpSeq = 0;
  let copyTimer = null;
  let pollTimer = null;
  let stopped = false;

  function itemUrl(id, suffix) { return listUrl + '/items/' + encodeURIComponent(id) + (suffix || ''); }

  function currentItems() {
    return Array.from(ul.children).map((li) => {
      const row = rows.get(li.dataset.itemId);
      return { id: li.dataset.itemId, text: row.text.textContent, ticked: row.box.checked };
    });
  }

  function updateProgress() {
    const items = currentItems();
    const n = items.filter((i) => i.ticked).length;
    const m = items.length;
    progress.textContent = L.progressText(n, m);
    bar.setAttribute('aria-valuemax', String(m));
    bar.setAttribute('aria-valuenow', String(n));
    fill.style.width = L.percent(n, m) + '%';
    empty.hidden = m > 0;
  }

  function setRowText(row, text) {
    row.text.textContent = text;
    row.remove.setAttribute('aria-label', 'Remove ' + text);
  }

  function setRowTicked(row, ticked) {
    row.box.checked = ticked;
    row.li.classList.toggle('done', ticked);
  }

  function createRow(item, temporary) {
    const li = document.createElement('li');
    li.dataset.itemId = item.id;
    const label = document.createElement('label');
    label.className = 'item-label';
    const box = document.createElement('input');
    box.type = 'checkbox';
    const text = document.createElement('span');
    text.className = 'item-text';
    label.append(box, text);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-button';
    remove.textContent = 'Remove';
    li.append(label, remove);
    const row = { li, box, text, remove };
    setRowText(row, item.text);
    setRowTicked(row, item.ticked);
    if (temporary) { box.disabled = true; remove.disabled = true; li.classList.add('saving'); }
    box.addEventListener('change', () => { li.classList.toggle('done', box.checked); onTick(item.id, box.checked); });
    remove.addEventListener('click', () => onRemove(item.id));
    rows.set(item.id, row);
    return row;
  }

  function dropRow(id) {
    const row = rows.get(id);
    if (!row) return;
    row.li.remove();
    rows.delete(id);
  }

  // Bring the DOM in line with server items without touching #new-item, #form-error or focus.
  function applyItems(items) {
    const plan = L.mergeItems(currentItems(), items, pending);
    const active = document.activeElement;
    const focusLost = plan.remove.some((id) => rows.get(id).li.contains(active));
    for (const id of plan.remove) dropRow(id);
    for (const item of plan.upsert) {
      const row = rows.get(item.id) || createRow(item, false);
      if (row.text.textContent !== item.text) setRowText(row, item.text);
      if (row.box.checked !== item.ticked) setRowTicked(row, item.ticked);
    }
    plan.order.forEach((id, index) => {
      const li = rows.get(id).li;
      if (ul.children[index] !== li) ul.insertBefore(li, ul.children[index] || null);
    });
    updateProgress();
    if (focusLost) input.focus();
  }

  function applyView(view) {
    known = view.items.map((i) => ({ id: i.id, text: i.text, ticked: i.ticked }));
    applyItems(known);
  }

  function setStatus(text) { status.textContent = text; }
  function clearStatusIf(text) { if (status.textContent === text) status.textContent = ''; }

  function showFormError(message) {
    formError.textContent = message;
    input.setAttribute('aria-invalid', 'true');
  }

  function clearFormError() {
    formError.textContent = '';
    input.removeAttribute('aria-invalid');
  }

  async function send(method, url, payload) {
    try { return await A.request(method, url, payload); } catch (err) { return null; }
  }

  // Tick: the checkbox already shows the new state; per item, writes run one after another.
  function onTick(id, desired) {
    updateProgress();
    pending.set(id, 'tick');
    tickCounts.set(id, (tickCounts.get(id) || 0) + 1);
    epoch += 1;
    const run = async () => {
      const res = await send('PUT', itemUrl(id, '/ticked'), { ticked: desired });
      epoch += 1;
      const left = tickCounts.get(id) - 1;
      tickCounts.set(id, left);
      if (left === 0) { tickCounts.delete(id); pending.delete(id); chains.delete(id); }
      if (res && res.ok && res.body && Array.isArray(res.body.items)) {
        clearStatusIf(MSG_SAVE);
        applyView(res.body);
      } else if (res && A.errorCode(res) === 'item_not_found') {
        known = known.filter((i) => i.id !== id);
        applyItems(known);
      } else {
        if (left === 0) {
          const was = known.find((i) => i.id === id);
          const row = rows.get(id);
          if (row && was) setRowTicked(row, was.ticked);
          updateProgress();
        }
        setStatus(MSG_SAVE);
      }
    };
    chains.set(id, (chains.get(id) || Promise.resolve()).then(run));
  }

  async function onRemove(id) {
    pending.set(id, 'remove');
    epoch += 1;
    dropRow(id);
    updateProgress();
    input.focus();
    const res = await send('DELETE', itemUrl(id));
    epoch += 1;
    pending.delete(id);
    if (res && res.ok && res.body && Array.isArray(res.body.items)) {
      clearStatusIf(MSG_SAVE);
      applyView(res.body);
    } else if (res && A.errorCode(res) === 'item_not_found') {
      known = known.filter((i) => i.id !== id);
      applyItems(known);
    } else {
      applyItems(known);
      setStatus(MSG_SAVE);
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const check = L.checkItem(input.value, rows.size);
    if (!check.ok) { showFormError(check.message); input.focus(); return; }
    clearFormError();
    const text = check.value;
    input.value = '';
    input.focus();
    tmpSeq += 1;
    const tmpId = 'tmp-' + tmpSeq;
    pending.set(tmpId, 'add');
    ul.append(createRow({ id: tmpId, text, ticked: false }, true).li);
    updateProgress();
    epoch += 1;
    const res = await send('POST', listUrl + '/items', { text });
    epoch += 1;
    pending.delete(tmpId);
    dropRow(tmpId);
    if (res && res.ok && res.body && Array.isArray(res.body.items)) {
      clearStatusIf(MSG_SAVE);
      applyView(res.body);
      return;
    }
    updateProgress();
    if (input.value === '') input.value = text;
    showFormError(A.errorMessage(res, MSG_SAVE));
  });

  function showNotFound() {
    stopped = true;
    clearTimeout(pollTimer);
    const main = $('main');
    const h1 = document.createElement('h1');
    h1.textContent = 'List not found';
    const p = document.createElement('p');
    p.textContent = 'That link does not match any list. Check it for typos.';
    const link = document.createElement('a');
    link.href = '/';
    link.textContent = 'Create a new list';
    const p2 = document.createElement('p');
    p2.append(link);
    const live = document.createElement('div');
    live.id = 'status';
    live.setAttribute('role', 'status');
    main.replaceChildren(h1, p, p2, live);
    document.title = 'List not found - Packing list';
  }

  function showName(view) {
    if (title.textContent !== view.name) title.textContent = view.name;
    const t = view.name + ' - Packing list';
    if (document.title !== t) document.title = t;
  }

  function handle(res, fresh) {
    if (res && res.ok && res.body && Array.isArray(res.body.items)) {
      showName(res.body);
      if (fresh) applyView(res.body);
      clearStatusIf(MSG_LOST);
      return;
    }
    if (res && A.errorCode(res) === 'list_not_found') { showNotFound(); return; }
    setStatus(MSG_LOST);
  }

  async function poll() {
    if (stopped) return;
    const startEpoch = epoch;
    const res = await send('GET', listUrl);
    handle(res, startEpoch === epoch);
    if (!stopped) pollTimer = setTimeout(poll, POLL_MS);
  }

  function copyText(text) {
    const legacy = () => {
      try { shareLink.select(); return document.execCommand('copy'); } catch (err) { return false; }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, legacy);
    }
    return Promise.resolve(legacy());
  }

  copyButton.addEventListener('click', async () => {
    const ok = await copyText(shareLink.value);
    if (!ok) { shareLink.select(); setStatus('Select the link and copy it.'); return; }
    copyButton.textContent = 'Copied';
    setStatus(MSG_COPIED);
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copyButton.textContent = 'Copy';
      clearStatusIf(MSG_COPIED);
    }, COPIED_MS);
  });

  function start() {
    shareLink.value = window.location.href;
    updateProgress();
    handle(A.getSync(listUrl), true);
    let focusTitle = false;
    try {
      focusTitle = sessionStorage.getItem('packing-created') === listId;
      sessionStorage.removeItem('packing-created');
    } catch (err) { /* no storage: skip the focus hint */ }
    if (focusTitle && !stopped) title.focus();
    if (!stopped) pollTimer = setTimeout(poll, POLL_MS);
  }

  start();
}());
