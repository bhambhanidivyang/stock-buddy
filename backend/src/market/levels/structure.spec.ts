import type { OhlcBar } from '../indicators';
import {
  buildStructureLevels,
  detectRawPivots,
  resistancesAbove,
} from './structure';

function bar(h: number, l: number, c: number): OhlcBar {
  return { high: h, low: l, close: c, volume: 1_000_000 };
}

describe('structure pivots', () => {
  it('detects a clear swing high and low with window=2', () => {
    // flat, spike high, flat, spike low, flat
    const bars: OhlcBar[] = [
      bar(10, 9, 9.5),
      bar(10, 9, 9.5),
      bar(12, 9.5, 11), // swing high at 12
      bar(10.5, 9, 9.5),
      bar(10, 9, 9.5),
      bar(10, 7, 8), // swing low at 7
      bar(9, 8, 8.5),
      bar(9.5, 8.5, 9),
      bar(10, 9, 9.5),
    ];
    const pivots = detectRawPivots(bars, 2);
    expect(pivots.some((p) => p.kind === 'HIGH' && p.price === 12)).toBe(true);
    expect(pivots.some((p) => p.kind === 'LOW' && p.price === 7)).toBe(true);
  });

  it('lists resistances above a price ascending', () => {
    const bars: OhlcBar[] = [];
    for (let i = 0; i < 40; i += 1) {
      const base = 100 + Math.sin(i / 3) * 5;
      bars.push(bar(base + 2, base - 2, base));
    }
    // inject clear highs
    bars[10] = bar(120, 100, 110);
    bars[11] = bar(115, 100, 108);
    bars[12] = bar(112, 100, 105);
    bars[20] = bar(130, 105, 120);
    bars[21] = bar(125, 110, 118);
    bars[22] = bar(122, 110, 115);

    const { resistances } = buildStructureLevels(bars, 3, {
      swingWindow: 2,
      clusterAtr: 0.25,
      breakBufferAtr: 0.1,
      minTouches: 1,
    });
    const above = resistancesAbove(resistances, 100, 3);
    for (let i = 1; i < above.length; i += 1) {
      expect(above[i].levelPrice).toBeGreaterThanOrEqual(above[i - 1].levelPrice);
    }
  });
});
