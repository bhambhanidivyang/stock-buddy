import type { OhlcBar } from '../indicators';
import { loadLevelsConfig } from './levels.config';
import { detectSetup, donchianCloseBreakAt } from './setup.engine';

function risingBars(n: number, start = 100): OhlcBar[] {
  const bars: OhlcBar[] = [];
  for (let i = 0; i < n; i += 1) {
    const c = start + i * 0.5;
    bars.push({
      high: c + 0.4,
      low: c - 0.4,
      close: c,
      volume: 1_000_000,
    });
  }
  return bars;
}

describe('setup.engine deterministic rules', () => {
  const config = loadLevelsConfig();

  it('donchianCloseBreakAt detects close above prior lookback high close', () => {
    const bars = risingBars(25, 100);
    // flatten then spike last close above prior 20d high close
    const priorHigh = Math.max(
      ...bars.slice(4, 24).map((b) => b.close),
    );
    bars[24] = {
      high: priorHigh + 2,
      low: priorHigh - 0.5,
      close: priorHigh + 1,
      volume: 2_000_000,
    };
    const hit = donchianCloseBreakAt(bars, 24, 20);
    expect(hit).not.toBeNull();
    expect(hit!.R).toBeCloseTo(priorHigh, 5);
  });

  it('BREAKOUT_FRESH requires close break + RVOL + ADX + limited extension', () => {
    const bars = risingBars(25, 100);
    const priorHigh = Math.max(
      ...bars.slice(4, 24).map((b) => b.close),
    );
    bars[24] = {
      high: priorHigh + 2,
      low: priorHigh - 0.5,
      close: priorHigh + 0.5,
      volume: 2_000_000,
    };
    const atr = 2;
    const base = {
      bars,
      ltp: bars[24].close,
      atr,
      ema20: priorHigh,
      ema50: priorHigh - 5,
      prevDayHigh: priorHigh - 1,
      config,
    };

    expect(
      detectSetup({ ...base, rvol20: 1.6, adx14: 30 }).setupType,
    ).toBe('BREAKOUT_FRESH');

    // Low RVOL: not FRESH (may still match a lower-priority pullback)
    expect(
      detectSetup({ ...base, rvol20: 1.0, adx14: 30 }).setupType,
    ).not.toBe('BREAKOUT_FRESH');

    // Weak ADX: neither FRESH nor pullbacks (all require ADX)
    expect(
      detectSetup({ ...base, rvol20: 1.6, adx14: 20 }).setupType,
    ).toBe('NONE');
  });

  it('PULLBACK_EMA20 requires uptrend + ADX + touch + band', () => {
    const bars = risingBars(40, 100);
    const ema20 = bars[bars.length - 1].close;
    // pierce EMA20 on last bar
    bars[bars.length - 1] = {
      high: ema20 + 0.5,
      low: ema20 - 0.2,
      close: ema20 + 0.1,
      volume: 1_000_000,
    };
    const hit = detectSetup({
      bars,
      ltp: ema20 + 0.1,
      atr: 2,
      ema20,
      ema50: ema20 - 3,
      prevDayHigh: ema20 + 2,
      rvol20: 1.0,
      adx14: 28,
      config,
    });
    expect(hit.setupType).toBe('PULLBACK_EMA20');
  });
});
