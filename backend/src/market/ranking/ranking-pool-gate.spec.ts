import {
  gateRankingDeepPool,
  type RankingPoolMember,
} from './ranking-pool-gate';

describe('gateRankingDeepPool', () => {
  const baseConfig = {
    sectorMode: 'hybrid' as const,
    sectorTopN: 2,
    perSectorPool: 4,
    wildcardCandidatePool: 3,
    minReturn20Coverage: 0.5,
    rsLbSwing: 20,
  };

  const members = (rows: Array<Partial<RankingPoolMember> & { symbol: string }>): RankingPoolMember[] =>
    rows.map((r) => ({
      symbol: r.symbol,
      sector: r.sector ?? 'Unknown',
      return20: r.return20 ?? null,
      return5: r.return5 ?? null,
    }));

  it('fails closed when return20 coverage is too low (no alphabetical pad)', () => {
    const pool = members([
      { symbol: 'AAA', sector: 'IT', return20: null },
      { symbol: 'BBB', sector: 'IT', return20: null },
      { symbol: 'CCC', sector: 'Banks', return20: 0.1 },
    ]);
    const result = gateRankingDeepPool({
      members: pool,
      eligibleSectors: [],
      config: baseConfig,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.deepSymbols).toEqual([]);
      expect(result.diagnostics.fallbackUsed).toBe(false);
      expect(result.diagnostics.failReason).toMatch(/return20 coverage/i);
    }
  });

  it('fails closed when sector preview is empty even if coverage is OK', () => {
    const pool = members([
      { symbol: 'AAA', sector: 'IT', return20: 0.1 },
      { symbol: 'BBB', sector: 'IT', return20: 0.2 },
      { symbol: 'ZZZ', sector: 'Banks', return20: 0.05 },
    ]);
    const result = gateRankingDeepPool({
      members: pool,
      eligibleSectors: [],
      config: baseConfig,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.failReason).toMatch(/sector preview empty/i);
      expect(result.deepSymbols).toEqual([]);
    }
  });

  it('uses eligible-sector members and return20-sorted wildcards only', () => {
    const pool = members([
      { symbol: 'HAL', sector: 'Defence', return20: 0.12 },
      { symbol: 'BEL', sector: 'Defence', return20: 0.08 },
      { symbol: 'INFY', sector: 'IT', return20: 0.02 },
      { symbol: 'TCS', sector: 'IT', return20: null },
      { symbol: 'WILDA', sector: 'Other', return20: 0.2 },
      { symbol: 'WILDB', sector: 'Other', return20: 0.15 },
      { symbol: 'NULLWC', sector: 'Other', return20: null },
    ]);
    const result = gateRankingDeepPool({
      members: pool,
      eligibleSectors: ['Defence'],
      config: baseConfig,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.inSector.map((m) => m.symbol).sort()).toEqual([
        'BEL',
        'HAL',
      ]);
      expect(result.outside.map((m) => m.symbol)).toEqual([
        'WILDA',
        'WILDB',
        'INFY',
      ]);
      expect(result.deepSymbols).not.toContain('NULLWC');
      expect(result.deepSymbols).not.toContain('TCS');
      expect(result.diagnostics.fallbackUsed).toBe(false);
      expect(result.diagnostics.failed).toBe(false);
    }
  });

  it('soft mode ranks by return20 and never includes null returns', () => {
    const pool = members([
      { symbol: 'A1', sector: 'X', return20: 0.01 },
      { symbol: 'Z9', sector: 'Y', return20: 0.3 },
      { symbol: 'M5', sector: 'Z', return20: null },
      { symbol: 'B2', sector: 'X', return20: 0.2 },
    ]);
    const result = gateRankingDeepPool({
      members: pool,
      eligibleSectors: [],
      config: { ...baseConfig, sectorMode: 'soft', sectorTopN: 1, perSectorPool: 2 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deepSymbols).toEqual(['Z9', 'B2']);
      expect(result.deepSymbols).not.toContain('M5');
      expect(result.deepSymbols).not.toContain('A1');
    }
  });
});
