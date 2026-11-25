/**
 * Bid comparison (BRD §4.4). Plain, fixed rules — no AI decides the money.
 *
 * Score = 40% price + 30% on-time record + 20% POD speed + 10% acceptance rate.
 * The weights are an assumption awaiting business confirmation (IMPLEMENTATION_PLAN §7.2).
 */
export const WEIGHTS = { price: 0.4, onTime: 0.3, pod: 0.2, accept: 0.1 };

/** Carriers with no track record are scored at this level, and the reason says so. */
const NEUTRAL = { onTimePct: 70, podDays: 3, acceptPct: 70 };

export interface QuoteInput {
  id: string;
  carrierId: string;
  carrierName: string;
  amount: number;
  perf: { trips: number; onTimePct: number; podDays: number; acceptPct: number } | null;
}

export interface ScoredQuote extends QuoteInput {
  score: number;
  vsBudget: number | null; // negative = under budget
  overBudget: boolean;
}

export const podScore = (days: number) => Math.max(0, Math.min(100, 100 - (days - 1) * 20));

export function scoreQuotes(quotes: QuoteInput[], budget: number | null): ScoredQuote[] {
  if (!quotes.length) return [];
  const cheapest = Math.min(...quotes.map((q) => q.amount));
  return quotes
    .map((q) => {
      const p = q.perf ?? { trips: 0, ...NEUTRAL };
      const score =
        WEIGHTS.price * ((cheapest / q.amount) * 100) +
        WEIGHTS.onTime * p.onTimePct +
        WEIGHTS.pod * podScore(p.podDays) +
        WEIGHTS.accept * p.acceptPct;
      return {
        ...q,
        score: Math.round(score),
        vsBudget: budget != null ? q.amount - budget : null,
        overBudget: budget != null && q.amount > budget,
      };
    })
    .sort((a, b) => b.score - a.score || a.amount - b.amount);
}

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

/** One or two plain sentences: why the top quote is recommended, and what the cheapest alternative trades off. */
export function recommendationReason(scored: ScoredQuote[]): string {
  if (!scored.length) return '';
  const top = scored[0];
  const cheapest = [...scored].sort((a, b) => a.amount - b.amount)[0];
  const parts: string[] = [];
  const record = top.perf
    ? `${top.perf.onTimePct}% on time and PODs in ${top.perf.podDays} days over ${top.perf.trips} trips`
    : 'no track record on DigitRell yet';
  if (top.id === cheapest.id) parts.push(`Cheapest quote, with ${record}.`);
  else parts.push(`${inr(top.amount - cheapest.amount)} more than the cheapest quote, but ${record}.`);
  if (top.vsBudget != null) parts.push(top.vsBudget <= 0 ? `${inr(-top.vsBudget)} under budget.` : `${inr(top.vsBudget)} over budget.`);
  if (top.id !== cheapest.id) {
    const c = cheapest.perf;
    parts.push(`${cheapest.carrierName} is cheapest at ${inr(cheapest.amount)}${c ? `, but ${c.onTimePct}% on time with PODs in ${c.podDays} days` : ', with no track record yet'}.`);
  }
  return parts.join(' ');
}
