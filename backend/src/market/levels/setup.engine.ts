import type { OhlcBar } from '../indicators';
import type { LevelsConfig } from './levels.config';
import type { SetupType } from './types';

export type SetupHit = {
  setupType: SetupType;
  breakLevel: number | null;
  rangeHeight: number | null;
  reason: string;
};

/**
 * Deterministic setups. Every threshold comes from LevelsConfig (env LVL_*).
 *
 * BREAKOUT_FRESH
 * - Close > highest close of prior LVL_BREAKOUT_LOOKBACK_DAYS bars
 * - RVOL >= LVL_RVOL_BREAKOUT_MIN
 * - ADX >= LVL_ADX_MIN
 * - Close - breakLevel <= LVL_BREAKOUT_MAX_EXT_ATR * ATR
 *
 * BREAKOUT_RETEST
 * - A close > prior lookback highest-close occurred age 1..LVL_RETEST_LOOKBACK bars ago
 * - Close in [R - LVL_RETEST_BELOW_ATR*ATR, R + LVL_RETEST_ABOVE_ATR*ATR]
 * - Last LVL_RETEST_TOUCH_BARS: some low <= R + LVL_RETEST_TOUCH_ABOVE_ATR*ATR and some close >= R - LVL_RETEST_BELOW_ATR*ATR
 * - ADX >= LVL_ADX_MIN
 *
 * PULLBACK_EMA20
 * - EMA20 > EMA50
 * - ADX >= LVL_ADX_MIN
 * - Within last LVL_EMA_TOUCH_BARS bars: some low <= EMA20
 * - Close >= EMA20 - LVL_EMA_PULLBACK_ATR * ATR
 * - Close <= EMA20 + LVL_EMA_MAX_EXT_ATR * ATR
 *
 * PULLBACK_PDH
 * - EMA20 > EMA50
 * - ADX >= LVL_ADX_MIN
 * - Within LVL_PDH_BREAK_LOOKBACK bars before signal: some close > that bar's prior-day high
 * - Close in [PDH - LVL_PDH_RETEST_BELOW_ATR*ATR, PDH + LVL_PDH_RETEST_ABOVE_ATR*ATR]
 */
export function detectSetup(input: {
  bars: OhlcBar[];
  ltp: number;
  atr: number;
  ema20: number;
  ema50: number;
  prevDayHigh: number | null;
  rvol20: number | null;
  adx14: number | null;
  config: LevelsConfig;
}): SetupHit {
  // Rules use last completed close (not LTP) so every developer gets the same hit.
  const { bars, atr, ema20, ema50, prevDayHigh, rvol20, adx14, config } =
    input;
  const lookback = config.breakoutLookbackDays;
  if (!(atr > 0) || bars.length < lookback + 2) {
    return {
      setupType: 'NONE',
      breakLevel: null,
      rangeHeight: null,
      reason: 'insufficient bars',
    };
  }

  const lastIdx = bars.length - 1;
  const close = bars[lastIdx].close;
  const adxOk = adx14 != null && adx14 >= config.adxMin;

  // Priority: RETEST → FRESH → EMA20 → PDH
  const retest = detectBreakoutRetest(bars, close, atr, adxOk, config);
  if (retest) return retest;

  const fresh = detectBreakoutFresh(
    bars,
    close,
    atr,
    rvol20,
    adxOk,
    config,
  );
  if (fresh) return fresh;

  const emaPb = detectPullbackEma20(bars, close, atr, ema20, ema50, adxOk, config);
  if (emaPb) return emaPb;

  const pdhPb = detectPullbackPdh(
    bars,
    close,
    atr,
    ema20,
    ema50,
    prevDayHigh,
    adxOk,
    config,
  );
  if (pdhPb) return pdhPb;

  return {
    setupType: 'NONE',
    breakLevel: null,
    rangeHeight: null,
    reason: 'no setup',
  };
}

/** Close-break of Donchian highest-close at bar index i. */
export function donchianCloseBreakAt(
  bars: OhlcBar[],
  i: number,
  lookbackDays: number,
): { R: number; rangeHeight: number } | null {
  if (i < lookbackDays || i >= bars.length) return null;
  const window = bars.slice(i - lookbackDays, i);
  let R = window[0].close;
  let windowLow = window[0].low;
  for (let j = 1; j < window.length; j += 1) {
    R = Math.max(R, window[j].close);
    windowLow = Math.min(windowLow, window[j].low);
  }
  if (!(bars[i].close > R)) return null;
  const rangeHeight = R - windowLow;
  if (!(rangeHeight > 0)) return null;
  return { R, rangeHeight };
}

function detectBreakoutFresh(
  bars: OhlcBar[],
  close: number,
  atr: number,
  rvol20: number | null,
  adxOk: boolean,
  config: LevelsConfig,
): SetupHit | null {
  const i = bars.length - 1;
  const hit = donchianCloseBreakAt(bars, i, config.breakoutLookbackDays);
  if (!hit) return null;
  const ext = (close - hit.R) / atr;
  if (!(ext > 0 && ext <= config.breakoutMaxExtensionAtr)) return null;
  if (rvol20 == null || !(rvol20 >= config.rvolBreakoutMin)) return null;
  if (!adxOk) return null;
  return {
    setupType: 'BREAKOUT_FRESH',
    breakLevel: hit.R,
    rangeHeight: hit.rangeHeight,
    reason: `close>${hit.R.toFixed(2)} (${config.breakoutLookbackDays}d high close); RVOL>=${config.rvolBreakoutMin}; ADX>=${config.adxMin}; ext<=${config.breakoutMaxExtensionAtr}ATR`,
  };
}

function detectBreakoutRetest(
  bars: OhlcBar[],
  close: number,
  atr: number,
  adxOk: boolean,
  config: LevelsConfig,
): SetupHit | null {
  if (!adxOk) return null;
  const lastIdx = bars.length - 1;
  const minI = Math.max(
    config.breakoutLookbackDays,
    lastIdx - config.retestLookback,
  );
  for (let i = lastIdx - 1; i >= minI; i -= 1) {
    const hit = donchianCloseBreakAt(bars, i, config.breakoutLookbackDays);
    if (!hit) continue;
    const age = lastIdx - i;
    if (age < 1 || age > config.retestLookback) continue;
    const lo = hit.R - config.retestBelowAtr * atr;
    const hi = hit.R + config.retestAboveAtr * atr;
    if (!(close >= lo && close <= hi)) continue;
    const slice = bars.slice(-config.retestTouchBars);
    const touched =
      slice.some((b) => b.low <= hit.R + config.retestTouchAboveAtr * atr) &&
      slice.some((b) => b.close >= hit.R - config.retestBelowAtr * atr);
    if (!touched) continue;
    return {
      setupType: 'BREAKOUT_RETEST',
      breakLevel: hit.R,
      rangeHeight: hit.rangeHeight,
      reason: `retest of ${config.breakoutLookbackDays}d breakout level ${hit.R.toFixed(2)} (age ${age}); ADX>=${config.adxMin}`,
    };
  }
  return null;
}

function detectPullbackEma20(
  bars: OhlcBar[],
  close: number,
  atr: number,
  ema20: number,
  ema50: number,
  adxOk: boolean,
  config: LevelsConfig,
): SetupHit | null {
  if (!(ema20 > ema50) || !adxOk) return null;
  const lastN = bars.slice(-config.emaTouchBars);
  const pierced = lastN.some((b) => b.low <= ema20);
  const holding = close >= ema20 - config.emaPullbackAtr * atr;
  const notExtended = close <= ema20 + config.emaMaxExtensionAtr * atr;
  if (!(pierced && holding && notExtended)) return null;
  return {
    setupType: 'PULLBACK_EMA20',
    breakLevel: null,
    rangeHeight: null,
    reason: `EMA20>EMA50; ADX>=${config.adxMin}; touched EMA20 in ${config.emaTouchBars}b; close in EMA20 band`,
  };
}

function detectPullbackPdh(
  bars: OhlcBar[],
  close: number,
  atr: number,
  ema20: number,
  ema50: number,
  prevDayHigh: number | null,
  adxOk: boolean,
  config: LevelsConfig,
): SetupHit | null {
  if (!(ema20 > ema50) || !adxOk) return null;
  if (prevDayHigh == null || !(prevDayHigh > 0)) return null;

  const look = Math.min(config.pdhBreakLookback + 1, bars.length);
  let broke = false;
  for (let i = bars.length - look; i < bars.length - 1; i += 1) {
    if (i < 1) continue;
    const pdhThen = bars[i - 1].high;
    if (bars[i].close > pdhThen) {
      broke = true;
      break;
    }
  }
  if (!broke) return null;

  const lo = prevDayHigh - config.pdhRetestBelowAtr * atr;
  const hi = prevDayHigh + config.pdhRetestAboveAtr * atr;
  if (!(close >= lo && close <= hi)) return null;

  return {
    setupType: 'PULLBACK_PDH',
    breakLevel: prevDayHigh,
    rangeHeight: null,
    reason: `EMA20>EMA50; ADX>=${config.adxMin}; PDH broken in ${config.pdhBreakLookback}b; close retesting PDH ${prevDayHigh.toFixed(2)}`,
  };
}
