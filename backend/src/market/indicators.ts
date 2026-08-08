/** Pure technical helpers from daily series (oldest → newest). */

export type OhlcBar = {
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export function round(value: number, digits: number): number {
  const m = 10 ** digits;
  return Math.round((value + Number.EPSILON) * m) / m;
}

export function ema(values: number[], period: number): number | null {
  if (values.length < period) {
    return null;
  }
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

/** Full EMA series aligned to input (null until warm). */
export function emaSeries(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = values.map(() => null);
  if (values.length < period) {
    return out;
  }
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) {
    return null;
  }
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) {
      gains += change;
    } else {
      losses -= change;
    }
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) {
    return 100;
  }
  const rs = avgGain / avgLoss;
  return round(100 - 100 / (1 + rs), 2);
}

function trueRanges(bars: OhlcBar[]): number[] {
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const prevClose = bars[i - 1].close;
    const { high, low } = bars[i];
    trs.push(
      Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)),
    );
  }
  return trs;
}

/** Absolute ATR (price units). */
export function atr(bars: OhlcBar[], period = 14): number | null {
  if (bars.length < period + 1) {
    return null;
  }
  const trs = trueRanges(bars);
  const slice = trs.slice(-period);
  return round(slice.reduce((a, b) => a + b, 0) / period, 4);
}

export function atrPercent(bars: OhlcBar[], period = 14): number | null {
  const value = atr(bars, period);
  const lastClose = bars[bars.length - 1]?.close;
  if (value == null || lastClose == null || lastClose <= 0) {
    return null;
  }
  return round((value / lastClose) * 100, 2);
}

export function volumeMultiple(
  volumes: number[],
  lookback = 20,
): number | null {
  if (volumes.length < lookback + 1) {
    return null;
  }
  const recent = volumes[volumes.length - 1];
  const avg =
    volumes.slice(-(lookback + 1), -1).reduce((a, b) => a + b, 0) / lookback;
  if (avg <= 0) {
    return null;
  }
  return round(recent / avg, 2);
}

export function relativeStrength(
  stockCloses: number[],
  benchCloses: number[],
  lookback = 20,
): number | null {
  if (stockCloses.length < lookback + 1 || benchCloses.length < lookback + 1) {
    return null;
  }
  const s0 = stockCloses[stockCloses.length - 1 - lookback];
  const s1 = stockCloses[stockCloses.length - 1];
  const b0 = benchCloses[benchCloses.length - 1 - lookback];
  const b1 = benchCloses[benchCloses.length - 1];
  if (s0 <= 0 || b0 <= 0) {
    return null;
  }
  const stockRet = s1 / s0 - 1;
  const benchRet = b1 / b0 - 1;
  if (Math.abs(benchRet) < 0.001) {
    return round(1 + stockRet, 3);
  }
  return round((1 + stockRet) / (1 + benchRet), 3);
}

export type TrendLabel = 'UP' | 'DOWN' | 'SIDEWAYS';

export function trendFromEmas(
  ema20: number | null,
  ema50: number | null,
): TrendLabel {
  if (ema20 == null || ema50 == null) {
    return 'SIDEWAYS';
  }
  const diff = (ema20 - ema50) / ema50;
  if (diff > 0.005) {
    return 'UP';
  }
  if (diff < -0.005) {
    return 'DOWN';
  }
  return 'SIDEWAYS';
}

export type SectorMomentum = 'STRONG' | 'NEUTRAL' | 'WEAK';

export function sectorMomentumFromChanges(
  changePercents: Array<number | null>,
): SectorMomentum {
  const vals = changePercents.filter((n): n is number => n != null);
  if (vals.length === 0) {
    return 'NEUTRAL';
  }
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (avg >= 0.75) {
    return 'STRONG';
  }
  if (avg <= -0.75) {
    return 'WEAK';
  }
  return 'NEUTRAL';
}

export type MacdResult = {
  macd: number;
  signal: number;
  hist: number;
};

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdResult | null {
  if (closes.length < slow + signalPeriod) {
    return null;
  }
  const fastE = emaSeries(closes, fast);
  const slowE = emaSeries(closes, slow);
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i += 1) {
    if (fastE[i] != null && slowE[i] != null) {
      macdLine.push((fastE[i] as number) - (slowE[i] as number));
    }
  }
  if (macdLine.length < signalPeriod) {
    return null;
  }
  const signal = ema(macdLine, signalPeriod);
  if (signal == null) {
    return null;
  }
  const macdVal = macdLine[macdLine.length - 1];
  return {
    macd: round(macdVal, 4),
    signal: round(signal, 4),
    hist: round(macdVal - signal, 4),
  };
}

export type AdxResult = {
  adx: number;
  plusDi: number;
  minusDi: number;
};

/** Wilder-style ADX(+DI/-DI) approximation on daily bars. */
export function adx(bars: OhlcBar[], period = 14): AdxResult | null {
  if (bars.length < period * 2 + 1) {
    return null;
  }
  const plusDm: number[] = [];
  const minusDm: number[] = [];
  const tr: number[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const up = bars[i].high - bars[i - 1].high;
    const down = bars[i - 1].low - bars[i].low;
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
    const prevClose = bars[i - 1].close;
    tr.push(
      Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - prevClose),
        Math.abs(bars[i].low - prevClose),
      ),
    );
  }

  const wilderSmooth = (values: number[], p: number): number[] => {
    const out: number[] = [];
    let sum = values.slice(0, p).reduce((a, b) => a + b, 0);
    out.push(sum);
    for (let i = p; i < values.length; i += 1) {
      sum = sum - sum / p + values[i];
      out.push(sum);
    }
    return out;
  };

  if (tr.length < period) {
    return null;
  }
  const smoothTr = wilderSmooth(tr, period);
  const smoothPlus = wilderSmooth(plusDm, period);
  const smoothMinus = wilderSmooth(minusDm, period);
  const dx: number[] = [];
  for (let i = 0; i < smoothTr.length; i += 1) {
    const trs = smoothTr[i];
    if (trs <= 0) {
      dx.push(0);
      continue;
    }
    const pdi = (100 * smoothPlus[i]) / trs;
    const mdi = (100 * smoothMinus[i]) / trs;
    const denom = pdi + mdi;
    dx.push(denom === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / denom);
  }
  if (dx.length < period) {
    return null;
  }
  let adxVal = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i += 1) {
    adxVal = (adxVal * (period - 1) + dx[i]) / period;
  }
  const last = smoothTr.length - 1;
  const lastTr = smoothTr[last];
  const plusDi = lastTr > 0 ? (100 * smoothPlus[last]) / lastTr : 0;
  const minusDi = lastTr > 0 ? (100 * smoothMinus[last]) / lastTr : 0;
  return {
    adx: round(adxVal, 2),
    plusDi: round(plusDi, 2),
    minusDi: round(minusDi, 2),
  };
}

export type BollingerResult = {
  percentB: number;
  width: number;
};

export function bollinger(
  closes: number[],
  period = 20,
  mult = 2,
): BollingerResult | null {
  if (closes.length < period) {
    return null;
  }
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance =
    slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  if (std === 0) {
    return { percentB: 0.5, width: 0 };
  }
  const upper = mean + mult * std;
  const lower = mean - mult * std;
  const last = closes[closes.length - 1];
  return {
    percentB: round((last - lower) / (upper - lower), 4),
    width: round((upper - lower) / mean, 4),
  };
}

export function roc(closes: number[], lookback = 20): number | null {
  if (closes.length < lookback + 1) {
    return null;
  }
  const prev = closes[closes.length - 1 - lookback];
  const last = closes[closes.length - 1];
  if (prev <= 0) {
    return null;
  }
  return round(((last - prev) / prev) * 100, 2);
}

export function periodReturn(closes: number[], lookback: number): number | null {
  return roc(closes, lookback);
}

/**
 * Simple return over `lookback` sessions as a fraction (0.05 = +5%).
 * Prefer this for sector RS / ranking math. `periodReturn` / `roc` stay percent.
 */
export function simpleReturn(
  closes: number[],
  lookback: number,
): number | null {
  if (closes.length < lookback + 1) {
    return null;
  }
  const prev = closes[closes.length - 1 - lookback];
  const last = closes[closes.length - 1];
  if (!(prev > 0) || !Number.isFinite(prev) || !Number.isFinite(last)) {
    return null;
  }
  return last / prev - 1;
}

export function distToExtremePct(
  price: number,
  extreme: number | null,
): number | null {
  if (extreme == null || extreme <= 0 || price <= 0) {
    return null;
  }
  return round(((price - extreme) / extreme) * 100, 2);
}

/** True if EMA20 crossed above EMA50 within last lookback bars. */
export function goldenCrossRecent(
  closes: number[],
  lookback = 5,
): boolean | null {
  const e20 = emaSeries(closes, 20);
  const e50 = emaSeries(closes, 50);
  const n = closes.length;
  if (n < 51) {
    return null;
  }
  for (let i = Math.max(51, n - lookback); i < n; i += 1) {
    const prev20 = e20[i - 1];
    const prev50 = e50[i - 1];
    const cur20 = e20[i];
    const cur50 = e50[i];
    if (
      prev20 != null &&
      prev50 != null &&
      cur20 != null &&
      cur50 != null &&
      prev20 <= prev50 &&
      cur20 > cur50
    ) {
      return true;
    }
  }
  return false;
}

export function deathCrossRecent(
  closes: number[],
  lookback = 5,
): boolean | null {
  const e20 = emaSeries(closes, 20);
  const e50 = emaSeries(closes, 50);
  const n = closes.length;
  if (n < 51) {
    return null;
  }
  for (let i = Math.max(51, n - lookback); i < n; i += 1) {
    const prev20 = e20[i - 1];
    const prev50 = e50[i - 1];
    const cur20 = e20[i];
    const cur50 = e50[i];
    if (
      prev20 != null &&
      prev50 != null &&
      cur20 != null &&
      cur50 != null &&
      prev20 >= prev50 &&
      cur20 < cur50
    ) {
      return true;
    }
  }
  return false;
}

export function averageDailyTradedValue(
  bars: Array<{ close: number; volume: number }>,
  lookback: number,
): number | null {
  if (bars.length < lookback) {
    return null;
  }
  const slice = bars.slice(-lookback);
  const sum = slice.reduce((a, b) => a + b.close * b.volume, 0);
  return sum / lookback;
}

export function highLowOver(
  bars: OhlcBar[],
  lookback: number,
): { high: number | null; low: number | null } {
  if (bars.length < lookback) {
    return { high: null, low: null };
  }
  const slice = bars.slice(-lookback);
  return {
    high: Math.max(...slice.map((b) => b.high)),
    low: Math.min(...slice.map((b) => b.low)),
  };
}
