// The debrief: result card, flight recorder (replay), root cause, concept, why harmful steps hurt, guide link, text alternative.
// createDebrief(rootEl, { scenario, run, daily, onRetry, onNext, onBoard }) -> { destroy(), handleKey(cmd) }
// run = { seed, actions:[{t,id,node}], result, score, fingerprint, [timeToMitigate, budgetLeft, harmful, hintUsed, scenarioHash] }
import {
  h, s, icon, clear, focusEl,
} from './shell.js';
import { buildDebrief, actionName } from '../core/debrief-model.js';
import { stateHash } from '../engine/fingerprint.js';
import { isAllowedGuide } from '../engine/guides.js';
import { shareText } from '../core/share.js';
import { mmss, percent } from '../core/format.js';
import { nodeLabel, EFFECT_WORD } from '../core/viewmodel.js';
import { createRecorder } from './debrief-recorder.js';

const COPY_FAIL = 'Could not copy. Select the text above and copy it by hand.';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function lampsEl(total, left) {
  const wrap = h('span', { class: 'lamps', testid: 'pager-lamps', role: 'group', 'aria-label': `Pager budget: ${left} of ${total} left` });
  for (let i = 0; i < total; i++) wrap.append(h('span', { class: 'lamp', testid: 'pager-lamp', 'data-state': i < left ? 'on' : 'spent' }));
  return wrap;
}

function stepCell(scenario, m) {
  if (!m) return h('span', { class: 'muted', text: 'none' });
  const where = m.node ? ` on ${nodeLabel(scenario, m.node)}` : '';
  return h('span', null, [`${actionName(m.id)}${where} `, h('span', { class: 'muted mono', text: `at ${mmss(m.t)}` })]);
}

function stepsTable(model) {
  const { scenario } = model;
  const body = h('tbody');
  for (const row of model.steps) {
    const ref = row.you || row.optimal;
    const effectCell = h('td', { 'data-label': 'Effect' }, [EFFECT_WORD[row.effect] || 'No effect']);
    if (row.harmful) effectCell.append(' ', h('span', { class: 'badge badge-harmful', testid: 'harmful-badge', text: 'Harmful' }));
    body.append(h('tr', { testid: 'step-row', 'data-lane': row.lane, 'data-index': row.index, 'data-action-id': ref.id, 'data-effect': row.effect }, [
      h('td', { 'data-label': 'Step', class: 'mono', text: String(row.index + 1) }),
      h('td', { 'data-label': 'You' }, stepCell(scenario, row.you)),
      h('td', { 'data-label': 'Optimal' }, stepCell(scenario, row.optimal)),
      effectCell,
    ]));
  }
  if (!model.steps.length) {
    body.append(h('tr', null, h('td', { colspan: 4, class: 'muted', text: 'No actions were taken.' })));
  }
  return h('div', { class: 'table-wrap' }, h('table', { class: 'steps', testid: 'steps-table' }, [
    h('caption', { class: 'stencil', text: 'What each step did' }),
    h('thead', null, h('tr', null, ['Step', 'You', 'Optimal', 'Effect'].map((t) => h('th', { scope: 'col', text: t })))),
    body,
  ]));
}

export function createDebrief(rootEl, {
  scenario, run, daily = null, onRetry = () => {}, onNext = null, onBoard = () => {},
}) {
  const model = buildDebrief({ scenario, run, daily });
  // When the replay no longer matches, the saved numbers win (the card still shows what was recorded).
  const saved = model.unavailable;
  const timeToMitigate = saved && run.timeToMitigate !== undefined ? run.timeToMitigate : model.timeToMitigate;
  const budgetLeft = saved && run.budgetLeft !== undefined ? run.budgetLeft : model.budgetLeft;
  const harmful = saved && run.harmful !== undefined ? run.harmful : model.harmful;
  const resolved = saved && run.result ? run.result === 'resolved' : model.resolved;
  const score = typeof run.score === 'number' ? run.score : model.score;
  const tier = model.tier;
  const fp = run.fingerprint || '';
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const inPage = rootEl.classList.contains('page') || (rootEl.closest && rootEl.closest('.page'));
  const view = h('section', {
    class: inPage ? 'debrief' : 'page',
    testid: 'debrief-view',
    'data-scenario': scenario.id,
    'data-seed': run.seed,
    'data-result': resolved ? 'resolved' : 'out-of-budget',
    'data-score': score,
    'data-time-to-mitigate': timeToMitigate === null || timeToMitigate === undefined ? '' : timeToMitigate,
    'data-budget-left': budgetLeft,
    'data-harmful-count': harmful,
    'data-hint-used': model.hintUsed ? 'true' : 'false',
    'data-state-hash': saved ? '' : stateHash(model.you.final),
  });

  // ---------------------------------------------------------------- result card
  const kicker = daily !== null && daily !== undefined ? `Incident #${daily} · ${scenario.title}` : `Seed ${run.seed} · ${scenario.title}`;
  const statusKey = resolved ? 'recovering' : 'crit';
  const title = h('h1', { class: 'result-title', testid: 'result-title', tabindex: '-1' }, [icon(resolved ? 'ic-recv' : 'ic-crit', 'icon-sm'), h('span', { text: resolved ? 'Resolved' : 'Out of pager budget' })]);
  const spent = scenario.budget - budgetLeft;
  const optT = model.optimalTime;
  const card = h('section', { class: 'result-card ticks', testid: 'result-card', 'data-status': statusKey }, [
    h('span', { class: 'result-kicker', text: kicker }),
    h('div', { class: 'result-head' }, [
      title,
      h('div', null, [
        h('span', { class: 'score' }, [h('span', { class: 'score-value', testid: 'score-value', text: String(score) }), h('span', { class: 'score-max', text: '/ 100' })]),
        ' ',
        h('span', { class: 'tier', testid: 'result-tier', text: tier }),
      ]),
    ]),
    h('div', { class: 'stats' }, [
      h('div', { class: 'stat', testid: 'score-time' }, [
        h('span', { class: 'stat-label', text: 'Time to mitigate' }),
        h('span', { class: 'stat-value', text: timeToMitigate === null || timeToMitigate === undefined ? 'Not mitigated' : mmss(timeToMitigate) }),
        h('span', { class: 'stat-detail', text: optT !== null && optT !== undefined ? `Optimal ${mmss(optT)}` : 'Optimal not reached' }),
      ]),
      h('div', { class: 'stat', testid: 'score-pager' }, [
        h('span', { class: 'stat-label', text: 'Pager left' }),
        h('span', { class: 'stat-value' }, [`${budgetLeft} / ${scenario.budget} `, lampsEl(scenario.budget, budgetLeft)]),
        h('span', { class: 'stat-detail', text: `${spent} spent` }),
      ]),
      h('div', { class: 'stat', testid: 'score-collateral' }, [
        h('span', { class: 'stat-label', text: 'Collateral' }),
        h('span', { class: 'stat-value', text: harmful === 0 ? 'No harmful steps' : plural(harmful, 'harmful step', 'harmful steps') }),
        h('span', { class: 'stat-detail', text: `Peak errors ${percent(model.peakError)}${model.hintUsed ? '. Hint used (-5 score)' : ''}` }),
      ]),
    ]),
    h('span', { class: 'fingerprint', testid: 'run-fingerprint' }, ['Run fingerprint ', h('b', { text: fp })]),
  ]);

  // ---------------------------------------------------------------- story column
  const guideOk = isAllowedGuide(scenario.guideUrl);
  const story = h('div', { class: 'story' }, [
    h('section', null, [h('h2', { text: 'Root cause' }), h('p', { testid: 'root-cause', text: scenario.rootCause })]),
    h('section', null, [h('h2', { text: 'The concept' }), h('p', { testid: 'concept', text: scenario.concept })]),
  ]);
  const seenWhy = new Set();
  for (const step of model.steps) {
    if (!step.harmful || seenWhy.has(step.you.id)) continue;
    seenWhy.add(step.you.id);
    story.append(h('section', null, [
      h('h2', null, ['Why that step hurt ', h('span', { class: 'badge badge-harmful', text: 'Harmful' })]),
      h('p', { testid: 'step-why', text: step.why || `${actionName(step.you.id)} made things worse within five seconds.` }),
    ]));
  }
  if (guideOk) {
    story.append(h('a', {
      class: 'btn btn-link', testid: 'guide-link', href: scenario.guideUrl, target: '_blank', rel: 'noopener noreferrer',
    }, [h('span', null, `Read the guide: ${scenario.guideTitle}`), h('span', { class: 'ext', text: '(opens in new tab)' }), icon('ic-external', 'icon-sm')]));
  }
  const copyBtn = h('button', { class: 'btn', type: 'button', testid: 'copy-result', text: 'Copy result' });
  const retryBtn = h('button', { class: 'btn btn-primary', type: 'button', testid: 'retry-seed', text: 'Retry this seed' });
  const nextBtn = onNext ? h('button', { class: 'btn', type: 'button', testid: 'next-incident', text: 'Next incident' }) : null;
  const backBtn = h('button', { class: 'btn', type: 'button', testid: 'back-to-board', text: 'Back to incidents' });
  const letters = model.letters.slice(0, 12);
  const text = shareText({
    daily: daily === undefined ? null : daily, seed: run.seed, scenarioId: scenario.id, letters, left: budgetLeft, budget: scenario.budget,
    timeToMitigate: timeToMitigate === undefined ? null : timeToMitigate, score, optimalTime: scenario.optimalSummary.timeToMitigate, harmful, fp,
  });
  const pre = h('pre', { testid: 'share-text', tabindex: '0', 'aria-label': 'Result text, two lines', text });
  const copyStatus = h('p', { class: 'hint', testid: 'copy-status', role: 'status' });
  story.append(h('div', { class: 'btn-row' }, [copyBtn, retryBtn, nextBtn, backBtn]), pre, copyStatus);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent = 'Copied';
    } catch {
      copyStatus.textContent = COPY_FAIL;
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      pre.focus();
    }
  }
  copyBtn.addEventListener('click', copy);
  retryBtn.addEventListener('click', () => onRetry());
  if (nextBtn) nextBtn.addEventListener('click', () => onNext());
  backBtn.addEventListener('click', () => onBoard());

  // ---------------------------------------------------------------- recorder
  const recorder = createRecorder(model, { reduced });
  const left = h('div', { class: 'recorder-col' }, [recorder.el, h('section', { class: 'panel' }, stepsTable(model))]);
  const grid = h('div', { class: 'debrief-grid' }, [left, story]);
  view.append(card, grid);
  rootEl.append(view);
  if (recorder.start) recorder.start();
  focusEl(title);
  void s;
  void clear;

  return {
    destroy() { recorder.destroy(); view.remove(); },
    // Debrief keys resolved by core/keys.js: c copy, r retry, b back, [ ] previous and next action mark.
    handleKey(cmd) {
      if (cmd === 'copy') { copy(); return true; }
      if (cmd === 'retry') { onRetry(); return true; }
      if (cmd === 'back') { onBoard(); return true; }
      if (cmd === 'mark-prev') { recorder.jump(-1); return true; }
      if (cmd === 'mark-next') { recorder.jump(1); return true; }
      return false;
    },
    get model() { return model; },
  };
}
