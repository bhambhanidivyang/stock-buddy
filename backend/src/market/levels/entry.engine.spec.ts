import { buildEntryBand } from './entry.engine';
import { loadLevelsConfig } from './levels.config';

describe('buildEntryBand quality tiers', () => {
  const config = loadLevelsConfig();

  const base = {
    setupType: 'BREAKOUT_RETEST' as const,
    atr: 100,
    ema20: 1000,
    prevDayHigh: null,
    breakLevel: 1000,
    setupReason: 'test retest',
    config,
  };

  it('marks GREEN when LTP is within chase ATR of buyHigh', () => {
    const bandHigh = 1000 + config.retestEntryAboveAtr * 100;
    const ltp = bandHigh + config.entryChaseAtr * 100 * 0.5;
    const result = buildEntryBand({ ...base, ltp });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quality).toBe('GREEN');
    }
  });

  it('marks AMBER for small overshoot between chase and amber ATR', () => {
    const bandHigh = 1000 + config.retestEntryAboveAtr * 100;
    const midOvershoot = (config.entryChaseAtr + config.entryAmberAtr) / 2;
    const ltp = bandHigh + midOvershoot * 100;
    const result = buildEntryBand({ ...base, ltp });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quality).toBe('AMBER');
      expect(result.overshootAtr).toBeGreaterThan(config.entryChaseAtr);
      expect(result.overshootAtr).toBeLessThanOrEqual(config.entryAmberAtr + 1e-9);
    }
  });

  it('rejects ENTRY_EXTENDED beyond amber ATR', () => {
    const bandHigh = 1000 + config.retestEntryAboveAtr * 100;
    const ltp = bandHigh + (config.entryAmberAtr + 0.1) * 100;
    const result = buildEntryBand({ ...base, ltp });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ENTRY_EXTENDED');
    }
  });
});
