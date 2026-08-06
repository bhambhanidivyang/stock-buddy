import type { RankingConfig } from '../../config/ranking.config';
import { ema, trendFromEmas, type TrendLabel } from '../indicators';

export type MarketRegimeLabel =
  | 'Aggressive'
  | 'Balanced'
  | 'Defensive'
  | 'No-trade';

export type RegimeInput = {
  niftyTrend: TrendLabel;
  bankNiftyTrend: TrendLabel;
  /** Fraction of liquid names with close > prior close over last session (0–1). */
  advanceDecline1d: number | null;
  /** Fraction up over majority of last 5 sessions (0–1). */
  advanceDecline5d: number | null;
  /** Fraction of sectors with SectorRS20 > 1 (0–1). */
  sectorBreadth: number | null;
  indiaVixPrice: number | null;
  indiaVixChangePercent: number | null;
};

export type RegimeResult = {
  label: MarketRegimeLabel;
  score: number;
  reasons: string[];
};

function trendPoints(t: TrendLabel, up: number, side: number): number {
  if (t === 'UP') return up;
  if (t === 'SIDEWAYS') return side;
  return 0;
}

/**
 * Deterministic regime classifier (risk dial).
 * No-trade hard-skip is gated by RANK_REGIME_NOTRADE_ENABLED in the orchestrator.
 */
export function classifyMarketRegime(
  input: RegimeInput,
  _config: RankingConfig,
): RegimeResult {
  const reasons: string[] = [];
  let score = 0;

  const nPts = trendPoints(input.niftyTrend, 25, 10);
  score += nPts;
  reasons.push(`Nifty ${input.niftyTrend}`);

  const bPts = trendPoints(input.bankNiftyTrend, 15, 5);
  score += bPts;
  reasons.push(`BankNifty ${input.bankNiftyTrend}`);

  if (input.advanceDecline5d != null) {
    const ad = input.advanceDecline5d;
    if (ad >= 0.55) score += 20;
    else if (ad >= 0.45) score += 10;
    reasons.push(`A/D5d ${(ad * 100).toFixed(0)}%`);
  }

  if (input.sectorBreadth != null) {
    const sb = input.sectorBreadth;
    if (sb >= 0.5) score += 20;
    else if (sb >= 0.35) score += 10;
    reasons.push(`sectorBreadth ${(sb * 100).toFixed(0)}%`);
  }

  if (input.indiaVixPrice != null) {
    const v = input.indiaVixPrice;
    if (v <= 14) score += 20;
    else if (v <= 18) score += 12;
    else if (v <= 22) score += 5;
    reasons.push(`VIX ${v.toFixed(1)}`);
    if (
      input.indiaVixChangePercent != null &&
      input.indiaVixChangePercent > 15
    ) {
      score -= 10;
      reasons.push(`VIX spike ${input.indiaVixChangePercent.toFixed(1)}%`);
    }
  }

  score = Math.max(0, Math.min(100, score));

  let label: MarketRegimeLabel;
  if (score >= 70) label = 'Aggressive';
  else if (score >= 45) label = 'Balanced';
  else if (score >= 25) label = 'Defensive';
  else label = 'No-trade';

  return { label, score, reasons };
}

export function indexTrendFromCloses(closes: number[]): TrendLabel {
  return trendFromEmas(ema(closes, 20), ema(closes, 50));
}
