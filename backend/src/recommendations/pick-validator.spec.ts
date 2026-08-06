import { loadRecommendationConfig } from '../config/recommendation.config';
import type { SuggestedLevels } from '../market/features/candidate.types';
import { normalizePicks } from './pick-validator';

describe('normalizePicks', () => {
  const cash = 100_000;
  const config = loadRecommendationConfig();
  const allowed = new Set(['GAIL', 'TATASTEEL', 'ITC']);
  const quotes = new Map([
    ['GAIL', { symbol: 'GAIL', price: 180, volume: 2_000_000 }],
    ['TATASTEEL', { symbol: 'TATASTEEL', price: 150, volume: 2_000_000 }],
    ['ITC', { symbol: 'ITC', price: 450, volume: 2_000_000 }],
  ]);

  function levels(mid: number): SuggestedLevels {
    // stop < buyLow < buyHigh < target; RR @ buyHigh = 8/4 = 2
    const buyHigh = mid;
    const buyLow = Number((mid - 2).toFixed(2));
    const stopLoss = Number((mid - 4).toFixed(2));
    const sellTarget = Number((mid + 8).toFixed(2));
    const risk = buyHigh - stopLoss;
    const reward = sellTarget - buyHigh;
    return {
      buyLow,
      buyHigh,
      stopLoss,
      sellTarget,
      riskReward: Number((reward / risk).toFixed(2)),
      method: 'STRUCTURE_ATR_V1',
      atrUsed: 3,
      setupType: 'PULLBACK_EMA20',
      entryReason: 'test',
      stopReason: 'test',
      targetReason: 'test',
      risk,
      reward,
      validationStatus: 'VALID',
      rejectionCode: null,
      rejectionDetail: { setupType: 'PULLBACK_EMA20' },
    };
  }

  const levelsBySymbol = new Map([
    ['GAIL', levels(180)],
    ['TATASTEEL', levels(150)],
    ['ITC', levels(450)],
  ]);

  function basePick(
    symbol: string,
    allocationInr: number,
    mid = 180,
    convictionRank = 1,
  ) {
    const lvl = levels(mid);
    return {
      symbol,
      qty: Math.floor(allocationInr / mid),
      allocationInr,
      buyLow: lvl.buyLow,
      buyHigh: lvl.buyHigh,
      sellTarget: lvl.sellTarget,
      stopLoss: lvl.stopLoss,
      role: 'PRIMARY' as const,
      summary: `${symbol} test`,
      convictionRank,
    };
  }

  it('caps a single name above max %', () => {
    const { picks } = normalizePicks(
      [basePick('GAIL', 50_000)],
      cash,
      allowed,
      quotes,
      { config, levelsBySymbol },
    );
    expect(picks).toHaveLength(1);
    expect(picks[0].allocationInr).toBeLessThanOrEqual(
      cash * config.maxAllocPct + 0.01,
    );
  });

  it('drops names below min %', () => {
    const { picks, rejected } = normalizePicks(
      [basePick('ITC', 5_000, 450)],
      cash,
      allowed,
      quotes,
      { config, levelsBySymbol },
    );
    expect(picks).toHaveLength(0);
    expect(rejected.some((r) => r.symbol === 'ITC')).toBe(true);
  });

  it('forces suggestedLevels onto picks', () => {
    const { picks } = normalizePicks(
      [
        {
          ...basePick('GAIL', 20_000),
          buyLow: 1,
          buyHigh: 2,
          stopLoss: 0.5,
          sellTarget: 99,
        },
      ],
      cash,
      allowed,
      quotes,
      { config, levelsBySymbol },
    );
    expect(picks).toHaveLength(1);
    expect(picks[0].buyHigh).toBe(levelsBySymbol.get('GAIL')!.buyHigh);
    expect(picks[0].stopLoss).toBe(levelsBySymbol.get('GAIL')!.stopLoss);
  });

  it('rejects symbols without suggestedLevels', () => {
    const { picks, rejected } = normalizePicks(
      [basePick('GAIL', 20_000)],
      cash,
      allowed,
      quotes,
      { config, levelsBySymbol: new Map() },
    );
    expect(picks).toHaveLength(0);
    expect(rejected[0]?.reason).toMatch(/suggestedLevels/);
  });

  it('full-cash deploy tops up underweight picks to near availableCash', () => {
    const fullDeployConfig = {
      ...config,
      fullCashDeploy: true,
      maxAllocPct: 0.35,
      maxCashLeftoverPct: 0.02,
      maxCashLeftoverInr: 2_500,
    };
    const sectorQuotes = new Map([
      [
        'GAIL',
        { symbol: 'GAIL', price: 180, volume: 2_000_000, sector: 'Energy' },
      ],
      [
        'TATASTEEL',
        {
          symbol: 'TATASTEEL',
          price: 150,
          volume: 2_000_000,
          sector: 'Basic Materials',
        },
      ],
      [
        'ITC',
        {
          symbol: 'ITC',
          price: 450,
          volume: 2_000_000,
          sector: 'Consumer Defensive',
        },
      ],
    ]);
    const { picks } = normalizePicks(
      [
        basePick('GAIL', 12_000, 180, 1),
        basePick('TATASTEEL', 12_000, 150, 2),
        basePick('ITC', 12_000, 450, 3),
      ],
      cash,
      allowed,
      sectorQuotes,
      { config: fullDeployConfig, levelsBySymbol },
    );
    expect(picks.length).toBe(3);
    const total = picks.reduce((s, p) => s + p.allocationInr, 0);
    expect(total).toBeGreaterThan(cash * 0.95);
    expect(cash - total).toBeLessThanOrEqual(
      Math.max(2_500, cash * 0.02) + 1,
    );
  });
});
