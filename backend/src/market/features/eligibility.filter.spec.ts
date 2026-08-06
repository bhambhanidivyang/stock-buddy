import { loadRecommendationConfig } from '../../config/recommendation.config';
import { evaluateEligibility } from './eligibility.filter';

describe('evaluateEligibility', () => {
  const config = {
    ...loadRecommendationConfig(),
    minHistoryBars: 5,
    minAdtvInr: 1_000,
    adtvLookbackDays: 3,
  };

  const bars = Array.from({ length: 10 }, (_, i) => ({
    high: 110,
    low: 90,
    close: 100,
    volume: 100_000,
  }));

  it('accepts liquid names with history', () => {
    expect(
      evaluateEligibility({ symbol: 'GAIL', price: 180, bars }, config).ok,
    ).toBe(true);
  });

  it('rejects low price', () => {
    const r = evaluateEligibility(
      { symbol: 'X', price: 5, bars },
      config,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/price/);
  });

  it('rejects short history', () => {
    const r = evaluateEligibility(
      { symbol: 'X', price: 100, bars: bars.slice(0, 2) },
      config,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/history/);
  });
});
