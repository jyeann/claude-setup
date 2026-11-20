// Score and tier (design.md section 8).
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function score({ result, timeToMitigate, optimalTime, budgetLeft, budget, optimalCost, harmful, hintUsed }) {
  const tYou = timeToMitigate;
  const time = tYou ? 50 * Math.min(1, optimalTime / tYou) : 0;
  const pager = tYou ? 30 * Math.min(1, budgetLeft / Math.max(1, budget - optimalCost)) : 0;
  const collateral = Math.max(0, 20 - 10 * harmful);
  const hintCost = hintUsed ? 5 : 0;
  const total = clamp(Math.round(time + pager + collateral - hintCost), 0, 100);
  const tier = result === 'out-of-budget' ? 'Escalated' : total >= 90 ? 'Textbook' : total >= 70 ? 'Solid' : 'Survived';
  return { score: total, tier, parts: { time, pager, collateral, hintCost } };
}
