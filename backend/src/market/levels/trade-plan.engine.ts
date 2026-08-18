import type { OhlcBar } from '../indicators';
import { round } from '../indicators';
import { buildEntryBand } from './entry.engine';
import type { LevelsConfig } from './levels.config';
import { loadLevelsConfig } from './levels.config';
import {
  isBuyablePlanQuality,
  worsePlanQuality,
  type PlanQuality,
} from './plan-quality';
import { detectSetup } from './setup.engine';
import { buildStop } from './stop.engine';
import { resolveStructureSetup } from './structure-entry';
import { buildStructureLevels, nearestSupportBelow } from './structure';
import { buildTarget } from './target.engine';
import { assertStrategyGeometry } from './trade-geometry';
import type { RejectionDetail, SuggestedLevels, TradePlan } from './types';

export type TradePlanInput = {
  bars: OhlcBar[];
  ltp: number;
  atr: number | null;
  ema20: number | null;
  ema50: number | null;
  prevDayHigh: number | null;
  prevDayLow: number | null;
  rvol20: number | null;
  adx14: number | null;
  config?: LevelsConfig;
};

function rejected(
  partial: Partial<TradePlan> & {
    rejectionCode: NonNullable<TradePlan['rejectionCode']>;
    rejectionDetail: RejectionDetail;
    atrUsed: number;
  },
): TradePlan {
  return {
    setupType: partial.setupType ?? 'NONE',
    entryReason: partial.entryReason ?? '',
    stopReason: partial.stopReason ?? '',
    targetReason: partial.targetReason ?? '',
    buyLow: partial.buyLow ?? 0,
    buyHigh: partial.buyHigh ?? 0,
    stopLoss: partial.stopLoss ?? 0,
    sellTarget: partial.sellTarget ?? 0,
    risk: partial.risk ?? 0,
    reward: partial.reward ?? 0,
    riskReward: partial.riskReward ?? 0,
    atrUsed: partial.atrUsed,
    method: 'STRUCTURE_ATR_V1',
    planQuality: 'RED',
    validationStatus: 'REJECTED',
    rejectionCode: partial.rejectionCode,
    rejectionDetail: {
      ...partial.rejectionDetail,
      planQuality: 'RED',
    },
    breakLevel: partial.breakLevel ?? null,
  };
}

/**
 * Structure + ATR trade plan. RR always at buyHigh. Never invents geometry to pass.
 * Named setups are optional; STRUCTURE fallback uses swing/PDH/EMA20 anchors.
 * GREEN/AMBER → VALID (BUYABLE). Soft RR ≥1R still VALID (quality info).
 * Hard reject → REJECTED (classified WATCH/RED upstream).
 */
export function buildTradePlan(input: TradePlanInput): TradePlan {
  const config = input.config ?? loadLevelsConfig();
  const atr = input.atr;

  if (
    atr == null ||
    !(atr > 0) ||
    input.ema20 == null ||
    input.ema50 == null ||
    input.bars.length < Math.max(30, config.swingWindow * 2 + 10)
  ) {
    return rejected({
      rejectionCode: 'INSUFFICIENT_FEATURES',
      atrUsed: atr ?? 0,
      rejectionDetail: {
        setupType: 'NONE',
        message: 'missing ATR/EMA/bars',
        atrUsed: atr ?? 0,
      },
    });
  }

  const { resistances, supports } = buildStructureLevels(input.bars, atr, {
    swingWindow: config.swingWindow,
    clusterAtr: config.clusterAtr,
    breakBufferAtr: config.breakBufferAtr,
    minTouches: config.minTouches,
  });

  let setup = detectSetup({
    bars: input.bars,
    ltp: input.ltp,
    atr,
    ema20: input.ema20,
    ema50: input.ema50,
    prevDayHigh: input.prevDayHigh,
    rvol20: input.rvol20,
    adx14: input.adx14,
    config,
  });

  // Named setups are optional descriptions. If none fire, still try an
  // objective structure-anchored plan (swing support / PDH / EMA20).
  if (setup.setupType === 'NONE') {
    const structural = resolveStructureSetup({
      ltp: input.ltp,
      atr,
      ema20: input.ema20,
      ema50: input.ema50,
      prevDayHigh: input.prevDayHigh,
      supports,
      bars: input.bars,
      config,
    });
    if (structural) {
      setup = structural;
    } else {
      return rejected({
        setupType: 'NONE',
        atrUsed: round(atr, 4),
        rejectionCode: 'NO_SETUP',
        rejectionDetail: {
          setupType: 'NONE',
          message: setup.reason,
          atrUsed: round(atr, 4),
        },
      });
    }
  }

  const entry = buildEntryBand({
    setupType: setup.setupType,
    ltp: input.ltp,
    atr,
    ema20: input.ema20,
    prevDayHigh: input.prevDayHigh,
    breakLevel: setup.breakLevel,
    setupReason: setup.reason,
    config,
  });

  if (!entry.ok) {
    return rejected({
      setupType: setup.setupType,
      buyLow: entry.buyLow ?? 0,
      buyHigh: entry.buyHigh ?? 0,
      entryReason: setup.reason,
      atrUsed: round(atr, 4),
      breakLevel: setup.breakLevel,
      rejectionCode: entry.code,
      rejectionDetail: {
        setupType: setup.setupType,
        message: entry.message,
        buyHigh: entry.buyHigh,
        atrUsed: round(atr, 4),
        entryOvershootAtr: entry.overshootAtr,
      },
    });
  }

  const stop = buildStop({
    buyLow: entry.buyLow,
    buyHigh: entry.buyHigh,
    atr,
    prevDayLow: input.prevDayLow,
    supports,
    config,
  });

  if (!stop.ok) {
    return rejected({
      setupType: setup.setupType,
      buyLow: entry.buyLow,
      buyHigh: entry.buyHigh,
      entryReason: entry.entryReason,
      stopLoss: stop.stopLoss ?? 0,
      atrUsed: round(atr, 4),
      breakLevel: setup.breakLevel,
      rejectionCode: stop.code,
      rejectionDetail: {
        setupType: setup.setupType,
        message: stop.message,
        buyHigh: entry.buyHigh,
        stopLoss: stop.stopLoss,
        stopStructurePrice: stop.structurePrice,
        atrUsed: round(atr, 4),
        entryOvershootAtr: entry.overshootAtr,
        riskPct: stop.riskPct,
        riskAtr: stop.riskAtr,
      },
    });
  }

  // Fill measured-move height from nearest support under the reference level
  // when the setup did not already supply rangeHeight.
  let rangeHeight = setup.rangeHeight;
  const refLevel = setup.breakLevel ?? entry.buyHigh;
  if ((rangeHeight == null || !(rangeHeight > 0)) && refLevel != null) {
    const base = nearestSupportBelow(supports, refLevel);
    if (base != null && refLevel > base.levelPrice) {
      rangeHeight = refLevel - base.levelPrice;
    }
  }

  const target = buildTarget({
    setupType: setup.setupType,
    buyHigh: entry.buyHigh,
    stopLoss: stop.stopLoss,
    atr,
    resistances,
    breakLevel: setup.breakLevel ?? entry.buyHigh,
    rangeHeight,
    config,
  });

  const attemptedTarget = target.ok
    ? target.sellTarget
    : maxEvaluatedTarget(target.targetsEvaluated);

  const geometry = assertStrategyGeometry({
    buyHigh: entry.buyHigh,
    stopLoss: stop.stopLoss,
    sellTarget: attemptedTarget,
    atr,
    config,
  });

  if (!geometry.ok) {
    return rejected({
      setupType: setup.setupType,
      buyLow: entry.buyLow,
      buyHigh: entry.buyHigh,
      entryReason: entry.entryReason,
      stopReason: stop.stopReason,
      stopLoss: stop.stopLoss,
      sellTarget: attemptedTarget ?? 0,
      atrUsed: round(atr, 4),
      breakLevel: setup.breakLevel,
      risk: entry.buyHigh - stop.stopLoss,
      reward:
        attemptedTarget != null ? attemptedTarget - entry.buyHigh : 0,
      riskReward: target.ok ? target.riskReward : (target.rr ?? 0),
      rejectionCode: geometry.code,
      rejectionDetail: {
        setupType: setup.setupType,
        message: geometry.message,
        buyHigh: entry.buyHigh,
        stopLoss: stop.stopLoss,
        sellTargetTried: attemptedTarget ?? undefined,
        stopStructurePrice: stop.structurePrice,
        rr: target.ok ? target.riskReward : target.rr,
        requiredRr: config.minTargetRrAmber,
        risk: entry.buyHigh - stop.stopLoss,
        reward:
          attemptedTarget != null ? attemptedTarget - entry.buyHigh : undefined,
        targetsEvaluated: target.targetsEvaluated,
        atrUsed: round(atr, 4),
        entryOvershootAtr: entry.overshootAtr,
        riskPct: geometry.riskPct,
        riskAtr: stop.riskAtr,
      },
    });
  }

  if (!target.ok) {
    return rejected({
      setupType: setup.setupType,
      buyLow: entry.buyLow,
      buyHigh: entry.buyHigh,
      entryReason: entry.entryReason,
      stopReason: stop.stopReason,
      stopLoss: stop.stopLoss,
      atrUsed: round(atr, 4),
      breakLevel: setup.breakLevel,
      risk: target.risk ?? entry.buyHigh - stop.stopLoss,
      reward: target.reward ?? 0,
      riskReward: target.rr ?? 0,
      rejectionCode: target.code,
      rejectionDetail: {
        setupType: setup.setupType,
        message: target.message,
        buyHigh: entry.buyHigh,
        stopLoss: stop.stopLoss,
        stopStructurePrice: stop.structurePrice,
        rr: target.rr,
        requiredRr: config.minTargetRrAmber,
        risk: target.risk,
        reward: target.reward,
        targetsEvaluated: target.targetsEvaluated,
        atrUsed: round(atr, 4),
        entryOvershootAtr: entry.overshootAtr,
        riskPct: stop.riskPct,
        riskAtr: stop.riskAtr,
      },
    });
  }

  const planQuality = worsePlanQuality(
    worsePlanQuality(entry.quality, stop.quality),
    target.quality,
  );
  const amberReasons: string[] = [];
  if (entry.quality === 'AMBER') {
    amberReasons.push(
      `entry overshoot ${entry.overshootAtr.toFixed(2)}ATR (chase green≤${config.entryChaseAtr})`,
    );
  }
  if (stop.quality === 'AMBER') {
    amberReasons.push(
      `stop riskPct ${stop.riskPct.toFixed(3)} (greenCap ${stop.greenPctCap.toFixed(3)}, amberCap ${stop.amberPctCap.toFixed(3)})`,
    );
  }
  if (target.quality === 'AMBER') {
    amberReasons.push(
      `RR ${target.riskReward} < green ${config.minTargetRr} (amber≥${config.minTargetRrAmber})`,
    );
  }

  return {
    setupType: setup.setupType,
    entryReason: entry.entryReason,
    stopReason: stop.stopReason,
    targetReason: target.targetReason,
    buyLow: entry.buyLow,
    buyHigh: entry.buyHigh,
    stopLoss: stop.stopLoss,
    sellTarget: target.sellTarget,
    risk: target.risk,
    reward: target.reward,
    riskReward: target.riskReward,
    atrUsed: round(atr, 4),
    method: 'STRUCTURE_ATR_V1',
    planQuality,
    validationStatus: 'VALID',
    rejectionCode: null,
    rejectionDetail: {
      setupType: setup.setupType,
      rr: target.riskReward,
      requiredRr: config.minTargetRr,
      risk: target.risk,
      reward: target.reward,
      buyHigh: entry.buyHigh,
      stopLoss: stop.stopLoss,
      targetsEvaluated: target.targetsEvaluated,
      stopStructurePrice: stop.structurePrice,
      atrUsed: round(atr, 4),
      entryOvershootAtr: entry.overshootAtr,
      riskPct: stop.riskPct,
      riskAtr: stop.riskAtr,
      planQuality,
      amberReasons: amberReasons.length > 0 ? amberReasons : undefined,
    },
    breakLevel: setup.breakLevel,
  };
}

export function toSuggestedLevels(plan: TradePlan): SuggestedLevels | null {
  if (
    plan.validationStatus !== 'VALID' ||
    !isBuyablePlanQuality(plan.planQuality)
  ) {
    return null;
  }
  const quality = plan.planQuality as 'GREEN' | 'AMBER';
  return {
    buyLow: plan.buyLow,
    buyHigh: plan.buyHigh,
    stopLoss: plan.stopLoss,
    sellTarget: plan.sellTarget,
    riskReward: plan.riskReward,
    method: 'STRUCTURE_ATR_V1',
    atrUsed: plan.atrUsed,
    setupType: plan.setupType,
    entryReason: plan.entryReason,
    stopReason: plan.stopReason,
    targetReason: plan.targetReason,
    risk: plan.risk,
    reward: plan.reward,
    planQuality: quality,
    validationStatus: 'VALID',
    rejectionCode: null,
    rejectionDetail: plan.rejectionDetail,
  };
}

export type { PlanQuality };

function maxEvaluatedTarget(
  evaluated: Array<{ price: number }> | undefined,
): number | null {
  if (evaluated == null || evaluated.length === 0) {
    return null;
  }
  return evaluated.reduce((m, e) => (e.price > m ? e.price : m), 0) || null;
}
