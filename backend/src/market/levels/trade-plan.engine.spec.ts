import type { OhlcBar } from '../indicators';
import { loadLevelsConfig } from './levels.config';
import { buildTradePlan } from './trade-plan.engine';

/** Build a gentle uptrend with EMA-friendly path and clear swings. */
function synthBars(): OhlcBar[] {
  const bars: OhlcBar[] = [];
  let p = 100;
  for (let i = 0; i < 80; i += 1) {
    p += 0.35;
    const noise = Math.sin(i / 4) * 1.2;
    const c = p + noise;
    bars.push({
      high: c + 1.5,
      low: c - 1.5,
      close: c,
      volume: 1_500_000,
    });
  }
  // deeper pullback into rising average
  const last = bars[bars.length - 1].close;
  bars.push({
    high: last,
    low: last - 4,
    close: last - 2.5,
    volume: 2_000_000,
  });
  bars.push({
    high: last - 1,
    low: last - 3.5,
    close: last - 2,
    volume: 2_000_000,
  });
  // swing high earlier
  bars[50] = { high: 130, low: 118, close: 125, volume: 2_000_000 };
  bars[51] = { high: 128, low: 120, close: 122, volume: 2_000_000 };
  bars[52] = { high: 126, low: 119, close: 121, volume: 2_000_000 };
  // swing low
  bars[40] = { high: 115, low: 105, close: 110, volume: 2_000_000 };
  bars[41] = { high: 114, low: 108, close: 111, volume: 2_000_000 };
  bars[42] = { high: 116, low: 109, close: 113, volume: 2_000_000 };
  return bars;
}

describe('buildTradePlan', () => {
  const config = loadLevelsConfig();

  it('returns STRUCTURE_ATR_V1 and never uses LTP as structural buyHigh by default', () => {
    const bars = synthBars();
    const ltp = bars[bars.length - 1].close;
    // rough EMA stand-ins: rising
    const ema20 = ltp + 0.2;
    const ema50 = ltp - 2;
    const plan = buildTradePlan({
      bars,
      ltp,
      atr: 2.5,
      ema20,
      ema50,
      prevDayHigh: ltp + 1,
      prevDayLow: ltp - 5,
      rvol20: 1.5,
      adx14: 30,
      config,
    });
    expect(plan.method).toBe('STRUCTURE_ATR_V1');
    if (plan.validationStatus === 'VALID') {
      expect(plan.buyHigh).not.toBe(ltp);
      expect(plan.riskReward).toBeGreaterThanOrEqual(config.minTargetRr - 0.01);
      expect(plan.stopLoss).toBeLessThan(plan.buyLow);
      expect(plan.buyHigh).toBeLessThan(plan.sellTarget);
    } else {
      // Quality-first: rejection must be structured
      expect(plan.rejectionCode).toBeTruthy();
      expect(plan.rejectionDetail.setupType).toBeDefined();
    }
  });

  it('rejects insufficient features', () => {
    const plan = buildTradePlan({
      bars: [],
      ltp: 100,
      atr: null,
      ema20: null,
      ema50: null,
      prevDayHigh: null,
      prevDayLow: null,
      rvol20: null,
      adx14: null,
      config,
    });
    expect(plan.validationStatus).toBe('REJECTED');
    expect(plan.rejectionCode).toBe('INSUFFICIENT_FEATURES');
  });
});
