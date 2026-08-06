import { percentileRank, weightedMean } from './percentile';

describe('percentileRank', () => {
  it('maps min to 0 and max to 100', () => {
    const pct = percentileRank([10, 20, 30]);
    expect(pct[0]).toBe(0);
    expect(pct[1]).toBe(50);
    expect(pct[2]).toBe(100);
  });

  it('averages ties', () => {
    const pct = percentileRank([1, 2, 2, 3]);
    expect(pct[1]).toBe(pct[2]);
    expect(pct[1]).toBeGreaterThan(0);
    expect(pct[1]).toBeLessThan(100);
  });

  it('leaves nulls as null', () => {
    const pct = percentileRank([1, null, 3]);
    expect(pct[1]).toBeNull();
    expect(pct[0]).toBe(0);
    expect(pct[2]).toBe(100);
  });
});

describe('weightedMean', () => {
  it('redistributes over available values', () => {
    expect(
      weightedMean([
        { weight: 0.5, value: 80 },
        { weight: 0.5, value: null },
      ]),
    ).toBe(80);
  });
});
