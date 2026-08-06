import { loadRecommendationConfig } from '../../config/recommendation.config';
import { prioritizeForResearch } from './research-prioritizer';

describe('prioritizeForResearch', () => {
  const config = loadRecommendationConfig();

  it('ranks high activity above quiet names', () => {
    const ranked = prioritizeForResearch(
      [
        {
          symbol: 'QUIET',
          changePercent: 0.1,
          gapPercent: 0,
          volume: 100_000,
          adtv: 100_000_000,
          dayValue: 10_000_000,
        },
        {
          symbol: 'LOUD',
          changePercent: 5,
          gapPercent: 3,
          volume: 5_000_000,
          adtv: 80_000_000,
          dayValue: 400_000_000,
        },
      ],
      { ...config, candidateLimit: 10, priorityPool: 10 },
    );
    expect(ranked[0].symbol).toBe('LOUD');
    expect(ranked[0].reasons.length).toBeGreaterThan(0);
  });
});
