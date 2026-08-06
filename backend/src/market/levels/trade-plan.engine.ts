import type { OhlcBar } from '../indicators';
import { round } from '../indicators';
import { buildEntryBand } from './entry.engine';
import type { LevelsConfig } from './levels.config';
import { loadLevelsConfig } from './levels.config';
import { detectSetup } from './setup.engine';
import { buildStop } from './stop.engine';
import { buildStructureLevels } from './structure';
import { buildTarget } from './target.engine';
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
    validationStatus: 'REJECTED',
    rejectionCode: partial.rejectionCode,
    rejectionDetail: partial.rejectionDetail,
    breakLevel: partial.breakLevel ?? null,
  };
}

/**
 * Structure + ATR trade plan. RR always at buyHigh. Never invents geometry to pass.
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

  const setup = detectSetup({
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

  if (setup.setupType === 'NONE') {
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
      },
    });
  }

  const target = buildTarget({
    setupType: setup.setupType,
    buyHigh: entry.buyHigh,
    stopLoss: stop.stopLoss,
    atr,
    resistances,
    breakLevel: setup.breakLevel,
    rangeHeight: setup.rangeHeight,
    config,
  });

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
        requiredRr: config.minTargetRr,
        risk: target.risk,
        reward: target.reward,
        targetsEvaluated: target.targetsEvaluated,
        atrUsed: round(atr, 4),
      },
    });
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
    },
    breakLevel: setup.breakLevel,
  };
}

export function toSuggestedLevels(plan: TradePlan): SuggestedLevels | null {
  if (plan.validationStatus !== 'VALID') {
    return null;
  }
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
    validationStatus: 'VALID',
    rejectionCode: null,
    rejectionDetail: plan.rejectionDetail,
  };
}
