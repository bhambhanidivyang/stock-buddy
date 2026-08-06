import type { RecommendationConfig } from '../../config/recommendation.config';

export type PriorityInput = {
  symbol: string;
  changePercent: number | null;
  gapPercent: number | null;
  volume: number | null;
  /** Average daily traded value from bhav (INR). */
  adtv: number | null;
  /** Today's traded value proxy: price * volume when available. */
  dayValue: number | null;
};

export type PriorityResult = {
  symbol: string;
  score: number;
  reasons: string[];
};

/**
 * Activity-only shortlist. Does NOT predict winners / profitability.
 */
export function prioritizeForResearch(
  inputs: PriorityInput[],
  config: RecommendationConfig,
): PriorityResult[] {
  const scored = inputs.map((row) => scoreOne(row, config));
  scored.sort((a, b) => b.score - a.score);
  const pool = Math.max(config.candidateLimit, config.priorityPool);
  return scored.slice(0, pool);
}

function scoreOne(
  row: PriorityInput,
  config: RecommendationConfig,
): PriorityResult {
  const reasons: string[] = [];
  let score = 0;

  const absRet = row.changePercent != null ? Math.abs(row.changePercent) : 0;
  if (absRet > 0) {
    score += config.priorityWeightAbsReturn * absRet;
    if (absRet >= config.priorityChangeTagMin) {
      reasons.push(`|change| ${absRet.toFixed(2)}%`);
    }
  }

  const absGap = row.gapPercent != null ? Math.abs(row.gapPercent) : 0;
  if (absGap > 0) {
    score += config.priorityWeightGap * absGap;
    if (absGap >= config.priorityGapTagMin) {
      reasons.push(`|gap| ${absGap.toFixed(2)}%`);
    }
  }

  let rvol = 0;
  if (
    row.dayValue != null &&
    row.adtv != null &&
    row.adtv > 0 &&
    row.dayValue > 0
  ) {
    rvol = row.dayValue / row.adtv;
    score +=
      config.priorityWeightRvol *
      Math.min(rvol, config.priorityRvolScoreCap) *
      2;
    if (rvol >= config.priorityRvolTagMin) {
      reasons.push(`RVOL ${rvol.toFixed(2)}x`);
    }
  } else if (
    row.volume != null &&
    row.volume > config.priorityVolumeFallbackMin
  ) {
    score += config.priorityWeightRvol * Math.log10(row.volume);
    reasons.push(`volume ${row.volume}`);
  }

  if (reasons.length === 0) {
    reasons.push('baseline liquidity');
  }

  return { symbol: row.symbol, score, reasons };
}
