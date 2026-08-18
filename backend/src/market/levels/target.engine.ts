import { round } from '../indicators';
import { MIN_BUYABLE_STRUCTURAL_RR } from './candidate-status';
import type { LevelsConfig } from './levels.config';
import type { PlanQuality } from './plan-quality';
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
      quality: PlanQuality;
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

  // Structural measured move from reference level + prior range height.
  // Never synthesizes target = entry + k×risk just to hit a desired R:R.
  if (breakLevel != null && rangeHeight != null && rangeHeight > 0) {
    const mm = round(breakLevel + rangeHeight, 2);
    const nearDup = cands.some(
      (c) => Math.abs(c.price - mm) <= config.clusterAtr * atr,
    );
    if (!nearDup && mm > buyHigh) {
      const reason =
        setupType === 'BREAKOUT_FRESH' || setupType === 'BREAKOUT_RETEST'
          ? 'measured_move_breakout'
          : 'measured_move_structure';
      cands.push({ price: mm, reason });
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

  const greenRr = config.minTargetRr;
  const amberRr = Math.min(config.minTargetRr, config.minTargetRrAmber);
  /** Soft floor: structural target with RR below this → WATCH (too close). */
  const softRr = MIN_BUYABLE_STRUCTURAL_RR;

  const evaluated: TargetCandidateEval[] = [];
  let bestSoft: {
    price: number;
    reason: string;
    rr: number;
    reward: number;
  } | null = null;

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
    const rewardPct = buyHigh > 0 ? (c.price - buyHigh) / buyHigh : 0;
    if (
      rewardAtr > config.maxTargetAtr ||
      rewardPct > config.maxTargetPct
    ) {
      evaluated.push({
        price: c.price,
        reason: c.reason,
        rr: null,
        accepted: false,
        skipReason: 'TARGET_TOO_FAR',
      });
      continue;
    }
    const reward = c.price - buyHigh;
    const rr = reward / risk;
    if (rr >= greenRr) {
      evaluated.push({
        price: c.price,
        reason: c.reason,
        rr: round(rr, 2),
        accepted: true,
      });
      return {
        ok: true,
        quality: 'GREEN',
        sellTarget: c.price,
        targetReason: c.reason,
        targetsEvaluated: evaluated,
        riskReward: round(rr, 2),
        risk: round(risk, 4),
        reward: round(reward, 4),
      };
    }
    if (rr >= softRr) {
      evaluated.push({
        price: c.price,
        reason: c.reason,
        rr: round(rr, 2),
        accepted: false,
        skipReason: rr >= amberRr ? 'RR_AMBER' : 'RR_SOFT',
      });
      if (bestSoft == null || rr > bestSoft.rr) {
        bestSoft = { price: c.price, reason: c.reason, rr, reward };
      }
      continue;
    }
    evaluated.push({
      price: c.price,
      reason: c.reason,
      rr: round(rr, 2),
      accepted: false,
      skipReason: 'TARGET_TOO_CLOSE',
    });
  }

  if (bestSoft != null) {
    evaluated.push({
      price: bestSoft.price,
      reason: bestSoft.reason,
      rr: round(bestSoft.rr, 2),
      accepted: true,
    });
    const note =
      bestSoft.rr >= amberRr
        ? `amber: RR ${bestSoft.rr.toFixed(2)} < green ${greenRr}`
        : `soft RR ${bestSoft.rr.toFixed(2)} (quality info; green ${greenRr} / amber ${amberRr})`;
    return {
      ok: true,
      quality: 'AMBER' as PlanQuality,
      sellTarget: bestSoft.price,
      targetReason: `${bestSoft.reason} (${note})`,
      targetsEvaluated: evaluated,
      riskReward: round(bestSoft.rr, 2),
      risk: round(risk, 4),
      reward: round(bestSoft.reward, 4),
    };
  }

  const far = evaluated.filter((e) => e.skipReason === 'TARGET_TOO_FAR');
  if (far.length > 0) {
    const farthest = [...far].sort((a, b) => b.price - a.price)[0];
    return {
      ok: false,
      code: 'TARGET_TOO_FAR',
      message: `structural target ${farthest.price} is beyond strategy horizon ${config.maxTargetPct} / ${config.maxTargetAtr}ATR`,
      targetsEvaluated: evaluated,
      risk: round(risk, 4),
      reward: round(farthest.price - buyHigh, 4),
    };
  }

  const best = evaluated
    .filter((e) => e.rr != null)
    .sort((a, b) => (b.rr ?? 0) - (a.rr ?? 0))[0];

  return {
    ok: false,
    code: 'TARGET_TOO_CLOSE',
    message: `structural target RR ${best?.rr ?? 0} < soft floor ${softRr} (green ${greenRr} / amber ${amberRr} are quality bands)`,
    targetsEvaluated: evaluated,
    risk: round(risk, 4),
    reward: best?.price != null ? round(best.price - buyHigh, 4) : undefined,
    rr: best?.rr ?? undefined,
  };
}
