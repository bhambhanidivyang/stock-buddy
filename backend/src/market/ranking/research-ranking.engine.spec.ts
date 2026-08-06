import { loadRankingConfig } from '../../config/ranking.config';
import type { OhlcBar } from '../indicators';
import { runResearchRanking } from './research-ranking.engine';

function synthBars(opts: {
  start: number;
  dailyRet: number;
  n: number;
  vol?: number;
}): OhlcBar[] {
  const bars: OhlcBar[] = [];
  let px = opts.start;
  for (let i = 0; i < opts.n; i += 1) {
    const next = px * (1 + opts.dailyRet);
    const high = Math.max(px, next) * 1.005;
    const low = Math.min(px, next) * 0.995;
    bars.push({
      high,
      low,
      close: next,
      volume: opts.vol ?? 1_000_000 + i * 1000,
    });
    px = next;
  }
  return bars;
}

describe('runResearchRanking', () => {
  const config = {
    ...loadRankingConfig(),
    topK: 5,
    sectorTopN: 2,
    perSectorPool: 4,
    minSectorMembers: 2,
    wildcardPct: 0.2,
    sectorMode: 'hybrid' as const,
  };

  it('prefers persistent leaders over one-day spikes in ranking reasons path', () => {
    const nifty = synthBars({ start: 100, dailyRet: 0.001, n: 260 }).map(
      (b) => b.close,
    );

    const defenceLeader = synthBars({
      start: 100,
      dailyRet: 0.008,
      n: 260,
      vol: 2_000_000,
    });
    const defencePeer = synthBars({
      start: 100,
      dailyRet: 0.004,
      n: 260,
    });
    const itLaggard = synthBars({
      start: 100,
      dailyRet: -0.002,
      n: 260,
    });
    const itPeer = synthBars({
      start: 100,
      dailyRet: -0.001,
      n: 260,
    });

    // Spike name: flat then huge last day
    const spike = synthBars({ start: 100, dailyRet: 0, n: 259 });
    spike.push({
      high: 120,
      low: 100,
      close: 115,
      volume: 50_000_000,
    });

    const result = runResearchRanking({
      stocks: [
        {
          symbol: 'HAL',
          sector: 'Defence',
          bars: defenceLeader,
          return20: 0.16,
          return5: 0.04,
        },
        {
          symbol: 'BEL',
          sector: 'Defence',
          bars: defencePeer,
          return20: 0.08,
          return5: 0.02,
        },
        {
          symbol: 'INFY',
          sector: 'IT',
          bars: itLaggard,
          return20: -0.04,
          return5: -0.01,
        },
        {
          symbol: 'TCS',
          sector: 'IT',
          bars: itPeer,
          return20: -0.02,
          return5: -0.005,
        },
        {
          symbol: 'SPIKE',
          sector: 'Defence',
          bars: spike,
          return20: 0.15,
          return5: 0.15,
        },
      ],
      niftyCloses: nifty,
      regime: {
        niftyTrend: 'UP',
        bankNiftyTrend: 'UP',
        advanceDecline1d: 0.55,
        advanceDecline5d: 0.55,
        sectorBreadth: null,
        indiaVixPrice: 14,
        indiaVixChangePercent: 0,
      },
      config,
    });

    expect(result.eligibleSectors[0]).toBe('Defence');
    expect(result.top.length).toBeGreaterThan(0);
    expect(result.top.some((t) => t.symbol === 'HAL')).toBe(true);
    expect(result.regime.label).not.toBe('No-trade');
  });
});
