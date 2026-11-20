// Your data: summary, export, import (strict importer, confirm on overwrite), clear.
import { h, icon, clear } from './dom.js';
import { openDialog } from './dialogs.js';
import {
  bests, resolvedCount, parseProgress, serialiseProgress, exportFilename, MAX_BYTES,
} from '../core/progress.js';
import { mmss } from '../core/format.js';

export const incidentCount = (progress) => new Set(progress.runs.map((r) => r.scenario)).size;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const localDate = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function download(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, class: 'sr-only', tabindex: '-1' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function mountData(root, app) {
  const summary = h('p', { testid: 'data-summary' });
  const empty = h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/incidents', text: 'Go to the incident board' }));
  const rows = h('div', { class: 'data-rows' });
  const exportBtn = h('button', { type: 'button', class: 'btn btn-primary', testid: 'export-button', text: 'Export progress' });
  const clearBtn = h('button', { type: 'button', class: 'btn', testid: 'clear-button', text: 'Clear progress' });

  const fileInput = h('input', { class: 'input', id: 'import-input', type: 'file', accept: '.json,application/json', testid: 'import-input', 'aria-describedby': 'import-hint' });
  const statusP = h('p', { testid: 'import-status', role: 'status' });
  const statusBox = h('div', { class: 'banner', 'data-kind': 'success', hidden: true }, [icon('ic-recv'), h('div', { class: 'banner-body' }, [h('span', { class: 'banner-kicker', text: 'Done' }), statusP])]);
  const errorP = h('p', { testid: 'import-error', role: 'alert' });
  const errorBox = h('div', { class: 'banner', 'data-kind': 'error', hidden: true }, [icon('ic-crit'), h('div', { class: 'banner-body' }, [h('span', { class: 'banner-kicker', text: 'Error' }), errorP])]);

  const showStatus = (text) => {
    errorBox.hidden = true;
    errorP.textContent = '';
    statusBox.hidden = !text;
    statusP.textContent = text || '';
    if (text) app.live.polite(text);
  };
  const showError = (reason) => {
    statusBox.hidden = true;
    statusP.textContent = '';
    errorP.textContent = `Import rejected: ${reason} Your saved progress was not changed.`;
    errorBox.hidden = false;
  };

  function render() {
    const p = app.progress;
    const n = resolvedCount(p);
    summary.textContent = n === 0 ? 'No incidents resolved yet. Your first one is a click away.' : `${plural(n, 'incident', 'incidents')} resolved.`;
    empty.hidden = n !== 0 || p.runs.length > 0;
    clear(rows);
    const table = bests(p);
    for (const id of Object.keys(table).sort()) {
      const b = table[id];
      if (b.runs === 0) continue;
      const sc = app.scenarios.get(id);
      rows.append(h('div', {
        class: 'data-row', testid: 'data-run-row', 'data-scenario': id, 'data-best-time': b.bestTime === null ? '' : String(b.bestTime), 'data-score': b.bestScore === null ? '' : String(b.bestScore),
      }, [
        h('span', { text: sc ? sc.title : id }),
        h('span', { class: 'mono', text: b.bestTime === null ? 'Not mitigated' : mmss(b.bestTime) }),
        h('span', { class: 'mono', text: b.bestScore === null ? '-' : String(b.bestScore) }),
      ]));
    }
    clearBtn.hidden = p.runs.length === 0;
  }

  exportBtn.addEventListener('click', () => {
    download(serialiseProgress(app.progress), exportFilename(localDate()));
    app.live.polite('Progress exported.');
  });

  clearBtn.addEventListener('click', async () => {
    const n = incidentCount(app.progress);
    const ok = await openDialog({
      testid: 'clear-dialog', title: 'Clear all saved progress?', opener: clearBtn, focus: 'clear-cancel',
      body: h('p', { text: `This deletes ${plural(n, 'saved incident', 'saved incidents')} from this browser. Export first if you want a copy.` }),
      buttons: [{ id: 'clear-cancel', label: 'Cancel', value: 'no' }, { id: 'clear-confirm', label: 'Clear progress', value: 'yes', primary: true }],
    });
    if (ok !== 'yes') return;
    app.clearProgress();
    render();
    showStatus('');
    app.live.polite('Progress cleared.');
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    // A file far beyond the limit is never read; the reason uses the same words as the parser's.
    let result;
    if (file.size > MAX_BYTES * 4) result = { ok: false, reason: `the file is ${Math.ceil(file.size / 1024)} KB and the limit is 256 KB.` };
    else result = parseProgress(await file.text(), { knownScenarios: Array.from(app.scenarios.keys()) });
    fileInput.value = '';
    if (!result.ok) { showError(result.reason); return; }
    const incoming = result.progress;
    if (app.progress.runs.length > 0) {
      const ok = await openDialog({
        testid: 'import-confirm-dialog', title: 'Replace saved progress?', opener: fileInput, focus: 'import-cancel',
        body: h('p', { text: `This replaces ${plural(incidentCount(app.progress), 'saved incident', 'saved incidents')} with ${incidentCount(incoming)} from the file. This cannot be undone.` }),
        buttons: [{ id: 'import-cancel', label: 'Cancel', value: 'no' }, { id: 'import-confirm', label: 'Replace progress', value: 'yes', primary: true }],
      });
      if (ok !== 'yes') return;
    }
    app.replaceProgress(incoming);
    render();
    showStatus(`Imported ${plural(incidentCount(incoming), 'incident', 'incidents')}.`);
  });

  root.append(h('div', { class: 'page', testid: 'data-view' }, [
    h('h1', { text: 'Your data' }),
    h('p', { class: 'page-lead', text: 'Progress lives in this browser only. Export it before clearing site data.' }),
    h('section', { class: 'panel', 'aria-labelledby': 'saved-title' }, [
      h('div', { class: 'panel-head' }, h('h2', { id: 'saved-title', text: 'Saved runs' })),
      summary, empty, rows,
      h('div', { class: 'btn-row' }, [exportBtn, clearBtn]),
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'import-input', text: 'Import progress file' }),
      fileInput,
      h('p', { class: 'hint', id: 'import-hint', text: 'JSON file up to 256 KB, exported from this page.' }),
    ]),
    statusBox,
    errorBox,
  ]));
  render();
  app.shell.setTitle('Your data - incident-sim');
  return { destroy() {} };
}
