import { loadRankingConfig } from '../../config/ranking.config';
import { classifyMarketRegime } from './regime';

describe('classifyMarketRegime', () => {
  const config = loadRankingConfig();

  it('labels Aggressive when trends and breadth are strong', () => {
    const r = classifyMarketRegime(
      {
        niftyTrend: 'UP',
        bankNiftyTrend: 'UP',
        advanceDecline1d: 0.6,
        advanceDecline5d: 0.6,
        sectorBreadth: 0.6,
        indiaVixPrice: 12,
        indiaVixChangePercent: 0,
      },
      config,
    );
    expect(r.label).toBe('Aggressive');
    expect(r.score).toBeGreaterThanOrEqual(70);
  });

  it('labels No-trade when trends are down and stress is high', () => {
    const r = classifyMarketRegime(
      {
        niftyTrend: 'DOWN',
        bankNiftyTrend: 'DOWN',
        advanceDecline1d: 0.3,
        advanceDecline5d: 0.3,
        sectorBreadth: 0.2,
        indiaVixPrice: 28,
        indiaVixChangePercent: 20,
      },
      config,
    );
    expect(r.label).toBe('No-trade');
  });
});
