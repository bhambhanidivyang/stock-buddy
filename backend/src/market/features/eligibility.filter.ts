import { RecommendationConfig } from '../../config/recommendation.config';
import { averageDailyTradedValue } from '../indicators';
import type { DailyBar } from '../yahoo.service';
import type { EligibilityRejection } from './candidate.types';

export type EligibilityInput = {
  symbol: string;
  price: number;
  bars: DailyBar[];
};

export type EligibilityResult = {
  ok: boolean;
  reason?: string;
};

/** Data-quality / tradability only — never RSI/trend/PE alpha filters. */
export function evaluateEligibility(
  input: EligibilityInput,
  config: RecommendationConfig,
): EligibilityResult {
  if (!(input.price >= config.minPrice)) {
    return {
      ok: false,
      reason: `price ${input.price} < min ${config.minPrice}`,
    };
  }
  if (input.bars.length < config.minHistoryBars) {
    return {
      ok: false,
      reason: `history ${input.bars.length} < min ${config.minHistoryBars}`,
    };
  }
  const adtv = averageDailyTradedValue(
    input.bars.map((b) => ({ close: b.close, volume: b.volume })),
    config.adtvLookbackDays,
  );
  if (adtv == null || adtv < config.minAdtvInr) {
    return {
      ok: false,
      reason: `ADTV ${adtv == null ? 'n/a' : Math.round(adtv)} < min ${config.minAdtvInr}`,
    };
  }
  return { ok: true };
}

export function filterEligible(
  inputs: EligibilityInput[],
  config: RecommendationConfig,
): {
  eligible: EligibilityInput[];
  rejected: EligibilityRejection[];
} {
  const eligible: EligibilityInput[] = [];
  const rejected: EligibilityRejection[] = [];
  for (const input of inputs) {
    const result = evaluateEligibility(input, config);
    if (result.ok) {
      eligible.push(input);
    } else {
      rejected.push({ symbol: input.symbol, reason: result.reason ?? 'rejected' });
    }
  }
  return { eligible, rejected };
}
