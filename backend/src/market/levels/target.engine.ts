import { round } from '../indicators';
import type { LevelsConfig } from './levels.config';
import { resistancesAbove } from './structure';
import type {
  RejectionCode,
  SetupType,
  StructureLevel,
  TargetCandidateEval,
} from './types';

export type TargetResult =
  | {
      ok: true;
      sellTarget: number;
      targetReason: string;
      targetsEvaluated: TargetCandidateEval[];
      riskReward: number;
      risk: number;
      reward: number;
    }
  | {
      ok: false;
      code: RejectionCode;
      message: string;
      targetsEvaluated: TargetCandidateEval[];
      risk?: number;
      reward?: number;
      rr?: number;
    };

export function buildTarget(input: {
  setupType: SetupType;
  buyHigh: number;
  stopLoss: number;
  atr: number;
  resistances: StructureLevel[];
  breakLevel: number | null;
  rangeHeight: number | null;
  config: LevelsConfig;
}): TargetResult {
  const {
    setupType,
    buyHigh,
    stopLoss,
    atr,
    resistances,
    breakLevel,
    rangeHeight,
    config,
  } = input;

  const risk = buyHigh - stopLoss;
  if (!(risk > 0) || !(atr > 0)) {
    return {
      ok: false,
      code: 'RR_INVALID',
      message: 'non-positive risk',
      targetsEvaluated: [],
      risk,
    };
  }

  type Cand = { price: number; reason: string };
  const cands: Cand[] = [];

  for (const lvl of resistancesAbove(
    resistances,
    buyHigh,
    config.maxResistanceTargets,
  )) {
    cands.push({
      price: round(lvl.levelPrice, 2),
      reason: 'prior_swing_high',
    });
  }

  if (
    (setupType === 'BREAKOUT_FRESH' || setupType === 'BREAKOUT_RETEST') &&
    breakLevel != null &&
    rangeHeight != null &&
    rangeHeight > 0
  ) {
    const mm = round(breakLevel + rangeHeight, 2);
    const nearDup = cands.some(
      (c) => Math.abs(c.price - mm) <= config.clusterAtr * atr,
    );
    if (!nearDup && mm > buyHigh) {
      cands.push({ price: mm, reason: 'measured_move_breakout' });
      cands.sort((a, b) => a.price - b.price);
    }
  }

  if (cands.length === 0) {
    return {
      ok: false,
      code: 'NO_TARGET_STRUCTURE',
      message: 'no resistance / measured move above buyHigh',
      targetsEvaluated: [],
      risk,
    };
  }

  const evaluated: TargetCandidateEval[] = [];
  for (const c of cands) {
    if (!(c.price > buyHigh)) {
      evaluated.push({
        price: c.price,
        reason: c.reason,
        rr: null,
        accepted: false,
        skipReason: 'not_above_entry',
      });
      continue;
    }
    const rewardAtr = (c.price - buyHigh) / atr;
    if (rewardAtr > config.maxTargetAtr) {
      evaluated.push({
        price: c.price,
        reason: c.reason,
        rr: null,
        accepted: false,
        skipReason: 'TARGET_UNREALISTIC_HORIZON',
      });
      continue;
    }
    const reward = c.price - buyHigh;
    const rr = reward / risk;
    if (rr >= config.minTargetRr) {
      evaluated.push({
        price: c.price,
        reason: c.reason,
        rr: round(rr, 2),
        accepted: true,
      });
      return {
        ok: true,
        sellTarget: c.price,
        targetReason: c.reason,
        targetsEvaluated: evaluated,
        riskReward: round(rr, 2),
        risk: round(risk, 4),
        reward: round(reward, 4),
      };
    }
    evaluated.push({
      price: c.price,
      reason: c.reason,
      rr: round(rr, 2),
      accepted: false,
      skipReason: 'RR_TOO_LOW',
    });
  }

  const best = evaluated
    .filter((e) => e.rr != null)
    .sort((a, b) => (b.rr ?? 0) - (a.rr ?? 0))[0];

  return {
    ok: false,
    code: 'RR_TOO_LOW',
    message: `no structure target cleared RR>=${config.minTargetRr}`,
    targetsEvaluated: evaluated,
    risk: round(risk, 4),
    reward: best?.price != null ? round(best.price - buyHigh, 4) : undefined,
    rr: best?.rr ?? undefined,
  };
}
