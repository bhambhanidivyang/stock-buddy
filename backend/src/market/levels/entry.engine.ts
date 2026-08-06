import { round } from '../indicators';
import type { LevelsConfig } from './levels.config';
import type { RejectionCode, SetupType } from './types';

export type EntryResult =
  | {
      ok: true;
      buyLow: number;
      buyHigh: number;
      entryReason: string;
    }
  | {
      ok: false;
      code: RejectionCode;
      message: string;
      buyLow?: number;
      buyHigh?: number;
    };

export function buildEntryBand(input: {
  setupType: SetupType;
  ltp: number;
  atr: number;
  ema20: number;
  prevDayHigh: number | null;
  breakLevel: number | null;
  setupReason: string;
  config: LevelsConfig;
}): EntryResult {
  const { setupType, ltp, atr, ema20, prevDayHigh, breakLevel, config } = input;
  if (setupType === 'NONE' || !(atr > 0)) {
    return { ok: false, code: 'NO_SETUP', message: 'no setup for entry' };
  }

  let buyLow = 0;
  let buyHigh = 0;
  let entryReason = input.setupReason;

  if (setupType === 'PULLBACK_EMA20') {
    buyLow = round(ema20 - config.emaBandBelowAtr * atr, 2);
    buyHigh = round(ema20 + config.emaPullbackAtr * atr, 2);
    entryReason = 'PULLBACK_EMA20 entry band at EMA20';
  } else if (setupType === 'PULLBACK_PDH' && prevDayHigh != null) {
    buyLow = round(prevDayHigh - config.pdhBandBelowAtr * atr, 2);
    buyHigh = round(prevDayHigh + config.pdhBandAboveAtr * atr, 2);
    entryReason = 'PULLBACK_PDH entry band at prior day high';
  } else if (setupType === 'BREAKOUT_RETEST' && breakLevel != null) {
    buyLow = round(breakLevel - config.retestEntryBelowAtr * atr, 2);
    buyHigh = round(breakLevel + config.retestEntryAboveAtr * atr, 2);
    entryReason = 'BREAKOUT_RETEST entry band at breakout level';
  } else if (setupType === 'BREAKOUT_FRESH' && breakLevel != null) {
    buyLow = round(breakLevel, 2);
    buyHigh = round(breakLevel + config.breakoutEntryAboveAtr * atr, 2);
    entryReason = 'BREAKOUT_FRESH entry band above breakout level';
  } else {
    return { ok: false, code: 'NO_SETUP', message: 'entry missing structure ref' };
  }

  if (!(buyLow < buyHigh)) {
    return {
      ok: false,
      code: 'NO_SETUP',
      message: 'invalid buy band',
      buyLow,
      buyHigh,
    };
  }

  if (ltp > buyHigh + config.entryChaseAtr * atr) {
    return {
      ok: false,
      code: 'ENTRY_EXTENDED',
      message: `LTP ${ltp} above buyHigh ${buyHigh}`,
      buyLow,
      buyHigh,
    };
  }
  if (ltp < buyLow - config.entryMissedAtr * atr) {
    return {
      ok: false,
      code: 'ENTRY_MISSED',
      message: `LTP ${ltp} below buyLow ${buyLow}`,
      buyLow,
      buyHigh,
    };
  }

  return { ok: true, buyLow, buyHigh, entryReason };
}
