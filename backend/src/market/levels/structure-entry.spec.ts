import { loadLevelsConfig } from './levels.config';
import { resolveStructureSetup } from './structure-entry';
import type { StructureLevel } from './types';

describe('resolveStructureSetup', () => {
  const config = loadLevelsConfig();

  it('anchors near EMA20 when trend intact and LTP in band', () => {
    const atr = 10;
    const ema20 = 100;
    const hit = resolveStructureSetup({
      ltp: 101,
      atr,
      ema20,
      ema50: 95,
      prevDayHigh: null,
      supports: [],
      config,
    });
    expect(hit).not.toBeNull();
    expect(hit?.setupType).toBe('STRUCTURE');
    expect(hit?.breakLevel).toBe(ema20);
    expect(hit?.reason).toMatch(/ema20/i);
  });

  it('still returns STRUCTURE when LTP is extended so entry can mark WATCH', () => {
    const support: StructureLevel = {
      levelPrice: 100,
      touches: 2,
      lastBarIndex: 10,
      kind: 'LOW',
      valid: true,
    };
    const hit = resolveStructureSetup({
      ltp: 200,
      atr: 5,
      ema20: 100,
      ema50: 95,
      prevDayHigh: 102,
      supports: [support],
      config,
    });
    expect(hit).not.toBeNull();
    expect(hit?.setupType).toBe('STRUCTURE');
    expect(hit?.reason).toMatch(/extended/i);
  });
});
