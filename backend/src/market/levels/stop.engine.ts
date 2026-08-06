import { round } from '../indicators';
import type { LevelsConfig } from './levels.config';
import { mostRecentSupportBelow } from './structure';
import type { RejectionCode, StructureLevel } from './types';

export type StopResult =
  | {
      ok: true;
      stopLoss: number;
      stopReason: string;
      structurePrice: number;
    }
  | {
      ok: false;
      code: RejectionCode;
      message: string;
      structurePrice?: number;
      stopLoss?: number;
    };

export function buildStop(input: {
  buyLow: number;
  buyHigh: number;
  atr: number;
  prevDayLow: number | null;
  supports: StructureLevel[];
  config: LevelsConfig;
}): StopResult {
  const { buyLow, buyHigh, atr, prevDayLow, supports, config } = input;
  if (!(atr > 0)) {
    return { ok: false, code: 'INSUFFICIENT_FEATURES', message: 'no ATR' };
  }

  const swing = mostRecentSupportBelow(supports, buyLow);
  let structurePrice: number | null = null;
  let stopReason = '';

  if (swing) {
    structurePrice = swing.levelPrice;
    stopReason = 'swing_low_minus_atr_buffer';
  } else if (prevDayLow != null && prevDayLow < buyLow) {
    structurePrice = prevDayLow;
    stopReason = 'pdl_minus_atr_buffer';
  } else {
    return {
      ok: false,
      code: 'NO_STOP_STRUCTURE',
      message: 'no swing low or PDL below buyLow',
    };
  }

  const stopLoss = round(structurePrice - config.stopAtrBuffer * atr, 2);
  if (!(stopLoss < buyLow)) {
    return {
      ok: false,
      code: 'STOP_INSIDE_ENTRY',
      message: `stop ${stopLoss} not below buyLow ${buyLow}`,
      structurePrice,
      stopLoss,
    };
  }

  const risk = buyHigh - stopLoss;
  if (risk / buyHigh > config.maxStopPctReject) {
    return {
      ok: false,
      code: 'STOP_TOO_WIDE_PCT',
      message: `riskPct ${(risk / buyHigh).toFixed(3)} > ${config.maxStopPctReject}`,
      structurePrice,
      stopLoss,
    };
  }
  if (risk / atr > config.maxStopAtrReject) {
    return {
      ok: false,
      code: 'STOP_TOO_WIDE_ATR',
      message: `riskAtr ${(risk / atr).toFixed(2)} > ${config.maxStopAtrReject}`,
      structurePrice,
      stopLoss,
    };
  }

  return { ok: true, stopLoss, stopReason, structurePrice };
}
