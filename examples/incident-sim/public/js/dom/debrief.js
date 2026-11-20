// PLACEHOLDER written by builder P2 so routes work before builder P3's real debrief lands. P3 overwrites this file.
// Contract: createDebrief(rootEl, { scenario, run, daily, onRetry, onNext, onBoard }) -> { destroy() }.
export function createDebrief(rootEl, { scenario, run, onRetry, onBoard }) {
  const view = document.createElement('section');
  view.setAttribute('data-testid', 'debrief-view');
  view.setAttribute('data-result', run.result);
  view.setAttribute('data-score', String(run.score));
  const h = document.createElement('h1');
  h.setAttribute('data-testid', 'result-title');
  h.tabIndex = -1;
  h.textContent = run.result === 'resolved' ? 'Resolved' : 'Out of pager budget';
  const p = document.createElement('p');
  p.textContent = scenario.rootCause;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.setAttribute('data-testid', 'retry-seed');
  retry.textContent = 'Retry this seed';
  retry.addEventListener('click', onRetry);
  const back = document.createElement('a');
  back.setAttribute('data-testid', 'back-to-board');
  back.href = '#/incidents';
  back.textContent = 'Back to incidents';
  back.addEventListener('click', (e) => { e.preventDefault(); onBoard(); });
  view.append(h, p, retry, back);
  rootEl.append(view);
  return { destroy() { view.remove(); } };
}
