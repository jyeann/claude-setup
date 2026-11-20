// Incident board, not-found and the shared banner pieces of the non-play screens.
import { h, icon } from './dom.js';
import { bests } from '../core/progress.js';
import { parseSeed } from '../core/routes.js';
import { mmss } from '../core/format.js';
import { errorLine, sortScenarios } from './scenarios.js';

const STATE_TEXT = { new: 'New', resolved: 'Resolved', 'out-of-budget': 'Out of budget' };

export function difficulty(n) {
  const text = `Difficulty ${n} of 3`;
  return h('span', { class: 'diff' }, [
    ...[1, 2, 3].map((i) => h('i', { 'data-on': String(i <= n) })),
    h('span', { class: 'sr-only', text }),
  ]);
}

export function banner({ kind, kicker, iconName, text, testid, actions, role }) {
  return h('div', { class: 'banner', 'data-kind': kind, testid, role }, [
    icon(iconName),
    h('div', { class: 'banner-body' }, [h('span', { class: 'banner-kicker', text: kicker }), h('p', { text })]),
    ...(actions || []),
  ]);
}

export function mountNotFound(root, app) {
  const back = h('a', { class: 'btn btn-primary', href: '#/incidents', testid: 'not-found-back', text: 'Back to the incident board' });
  const section = h('section', { class: 'page', testid: 'not-found' }, [
    h('h1', { text: 'That incident is not on the board.' }),
    ' ',
    h('p', { class: 'page-lead', text: 'It may have been renamed, or its file failed validation.' }),
    h('div', { class: 'btn-row' }, back),
  ]);
  root.append(section);
  app.shell.setTitle('Not found - incident-sim');
  return { destroy() {} };
}

export function mountBoard(root, app, { seedError } = {}) {
  const list = sortScenarios(app.scenarios);
  const table = bests(app.progress);
  const daily = app.daily();
  const hasAny = list.length > 0;

  // ---- seed field
  const input = h('input', {
    class: 'input', id: 'seed-input', type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', testid: 'seed-input',
    'aria-describedby': 'seed-err seed-hint',
  });
  const errorEl = h('p', { class: 'field-error', id: 'seed-err', testid: 'seed-error' });
  const field = h('div', { class: 'field' }, [
    h('label', { for: 'seed-input', text: 'Seed (optional)' }),
    input,
    errorEl,
    h('p', { class: 'hint', id: 'seed-hint', text: 'Leave blank for the standard seed. Share a number to replay the same incident with a team.' }),
  ]);
  const showError = (msg) => {
    errorEl.textContent = '';
    if (msg) errorEl.append(icon('ic-crit'), msg);
    if (msg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };
  if (seedError) showError(seedError);
  input.addEventListener('input', () => showError(''));

  function begin(id, fallbackSeed) {
    const v = input.value.trim();
    if (v !== '') {
      const r = parseSeed(v);
      if (!r.ok) { showError(r.error); input.focus(); return; }
      app.go(`#/play/${id}?seed=${r.seed}`);
      return;
    }
    showError('');
    app.go(fallbackSeed === undefined ? `#/play/${id}` : `#/play/${id}?seed=${fallbackSeed}`);
  }

  // ---- daily card
  let dailyCard = null;
  if (hasAny && daily && app.scenarios.has(daily.scenarioId)) {
    const sc = app.scenarios.get(daily.scenarioId);
    dailyCard = h('section', {
      class: 'daily-card', testid: 'daily-card', 'aria-labelledby': 'daily-title',
      'data-scenario': daily.scenarioId, 'data-seed': String(daily.seed), 'data-date': daily.date, 'data-number': String(daily.number),
    }, [
      h('span', { class: 'stencil', text: `Today · ${daily.date} · #${daily.number}` }),
      h('h2', { id: 'daily-title', text: sc.title }),
      h('div', { class: 'daily-meta' }, [difficulty(sc.difficulty), h('span', { class: 'mono', text: `Seed ${daily.seed}` })]),
      h('p', { class: 'muted', text: 'Same incident and seed for everyone on this date.' }),
      h('div', { class: 'btn-row' }, h('button', {
        type: 'button', class: 'btn btn-primary', testid: 'daily-start', text: "Start today's incident", on: { click: () => begin(daily.scenarioId, daily.seed) },
      })),
    ]);
  }

  // ---- incident rows
  const rows = list.map((sc) => {
    const b = table[sc.id] || { state: 'new', bestTime: null, bestScore: null, runs: 0 };
    const chipStatus = b.state === 'resolved' ? 'recovering' : b.state === 'out-of-budget' ? 'crit' : null;
    const chipIcon = b.state === 'resolved' ? 'ic-recv' : b.state === 'out-of-budget' ? 'ic-crit' : 'ic-note';
    const bestText = b.state === 'new' ? 'Not tried' : b.bestTime === null ? 'Best not mitigated' : `Best ${mmss(b.bestTime)}`;
    const start = h('a', {
      class: 'btn', href: `#/play/${sc.id}`, testid: 'incident-start', 'aria-label': `Start ${sc.title}`, text: 'Start',
      on: { click: (e) => { if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; e.preventDefault(); begin(sc.id); } },
    });
    return h('li', {
      class: 'incident-row', testid: 'incident-row', 'data-scenario': sc.id, 'data-difficulty': String(sc.difficulty), 'data-state': b.state,
      'data-best-time': b.bestTime === null ? '' : String(b.bestTime),
    }, [
      h('div', { class: 'incident-title-block' }, [h('span', { class: 'incident-title', text: sc.title }), h('span', { class: 'incident-concept', text: sc.summary })]),
      difficulty(sc.difficulty),
      h('span', { class: 'state-chip', 'data-status': chipStatus }, [icon(chipIcon), STATE_TEXT[b.state]]),
      h('span', { class: 'best', text: bestText }),
      start,
    ]);
  });

  // ---- scenario problems
  const errs = app.errors;
  const problems = errs.length === 0 ? null : h('details', { class: 'scenario-errors', testid: 'scenario-errors', open: true }, [
    h('summary', { text: `${errs.length} scenario file${errs.length === 1 ? '' : 's'} could not be loaded` }),
    h('ul', null, errs.map((e) => h('li', { testid: 'scenario-error-item', 'data-file': e.file, 'data-field': e.field, text: errorLine(e) }))),
  ]);

  const empty = hasAny ? null : banner({
    kind: 'empty', kicker: 'Empty', iconName: 'ic-note', testid: 'picker-empty', role: 'status',
    text: 'No incidents on the board. Every scenario file failed validation, so there is nothing to run. Open Scenario problems to see which file and field to fix, then restart the server.',
  });

  const page = h('div', { class: 'page', testid: 'picker-view' }, [
    h('h1', { text: 'Incident board' }),
    empty,
    hasAny ? h('div', { class: 'board-grid' }, [dailyCard, field]) : null,
    hasAny ? h('ul', { class: 'incident-list', testid: 'incident-list', 'aria-label': 'All incidents' }, rows) : null,
    problems,
  ]);
  root.append(page);
  app.shell.setTitle('Incident board - incident-sim');
  return { destroy() {} };
}
