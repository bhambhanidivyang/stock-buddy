import type { LevelsConfig } from './levels.config';
import type { RejectionCode } from './types';

export type StrategyGeometryInput = {
  buyHigh: number;
  stopLoss: number;
  /** Best structural target considered (accepted or skipped-as-far). */
  sellTarget: number | null;
  atr: number;
  config: LevelsConfig;
};

export type StrategyGeometryResult =
  | { ok: true; riskPct: number; rewardPct: number | null; rewardAtr: number | null }
  | {
      ok: false;
      code: RejectionCode;
      message: string;
      riskPct: number;
      rewardPct: number | null;
      rewardAtr: number | null;
    };

/**
 * Stock Buddy 1–5 day book: setup/stop/target prices stay structural.
 * This only accepts or rejects. It never tightens a stop or clamps a target.
 */
export function assertStrategyGeometry(
  input: StrategyGeometryInput,
): StrategyGeometryResult {
  const { buyHigh, stopLoss, sellTarget, atr, config } = input;
  const riskPct = buyHigh > 0 ? (buyHigh - stopLoss) / buyHigh : 0;
  const rewardPct =
    sellTarget != null && buyHigh > 0 ? (sellTarget - buyHigh) / buyHigh : null;
  const rewardAtr =
    sellTarget != null && atr > 0 ? (sellTarget - buyHigh) / atr : null;

  const tooWide = riskPct > config.maxRiskPct + 1e-12;
  const tooFar =
    rewardPct != null &&
    rewardAtr != null &&
    (rewardPct > config.maxTargetPct + 1e-12 ||
      rewardAtr > config.maxTargetAtr + 1e-12);

  if (tooWide && tooFar) {
    return {
      ok: false,
      code: 'STOP_TOO_WIDE_PCT',
      message: `riskPct ${riskPct.toFixed(3)} > strategy max ${config.maxRiskPct}; also TARGET_TOO_FAR rewardPct ${rewardPct!.toFixed(3)} (cap ${config.maxTargetPct}) / ${rewardAtr!.toFixed(2)}ATR (cap ${config.maxTargetAtr})`,
      riskPct,
      rewardPct,
      rewardAtr,
    };
  }
  if (tooWide) {
    return {
      ok: false,
      code: 'STOP_TOO_WIDE_PCT',
      message: `riskPct ${riskPct.toFixed(3)} > strategy max ${config.maxRiskPct} (structural stop not tightened)`,
      riskPct,
      rewardPct,
      rewardAtr,
    };
  }
  if (tooFar) {
    return {
      ok: false,
      code: 'TARGET_TOO_FAR',
      message: `rewardPct ${rewardPct!.toFixed(3)} / ${rewardAtr!.toFixed(2)}ATR exceeds strategy horizon ${config.maxTargetPct} / ${config.maxTargetAtr}ATR (target not clamped)`,
      riskPct,
      rewardPct,
      rewardAtr,
    };
  }
  return { ok: true, riskPct, rewardPct, rewardAtr };
}

export function isHorizonSizedMove(
  height: number,
  buyHigh: number,
  atr: number,
  config: LevelsConfig,
): boolean {
  if (!(height > 0) || !(buyHigh > 0) || !(atr > 0)) return false;
  const pct = height / buyHigh;
  const atrMult = height / atr;
  return pct <= config.maxTargetPct + 1e-12 && atrMult <= config.maxTargetAtr + 1e-12;
}
