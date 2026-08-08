import type { RankingConfig } from '../../config/ranking.config';

export type RankingPoolMember = {
  symbol: string;
  sector: string;
  /** Simple return fraction (0.05 = +5%), not percent. */
  return20: number | null;
  return5: number | null;
};

export type RankingPoolDiagnostics = {
  liquidCount: number;
  return20Count: number;
  return20Coverage: number;
  minReturn20Coverage: number;
  bhavSessionsNeeded: number;
  eligibleSectors: string[];
  inSectorCount: number;
  outsideCount: number;
  deepPoolSize: number;
  deepPoolFirst: string | null;
  deepPoolLast: string | null;
  fallbackUsed: false;
  failed: boolean;
  failReason: string | null;
};

export type RankingPoolGateOk = {
  ok: true;
  inSector: RankingPoolMember[];
  outside: RankingPoolMember[];
  deepSymbols: string[];
  diagnostics: RankingPoolDiagnostics;
};

export type RankingPoolGateFail = {
  ok: false;
  inSector: [];
  outside: [];
  deepSymbols: [];
  diagnostics: RankingPoolDiagnostics;
};

/**
 * Build the deep-fetch pool for research ranking.
 * Never pads with null-return / alphabetical order — fail closed instead.
 */
export function gateRankingDeepPool(input: {
  members: RankingPoolMember[];
  eligibleSectors: string[];
  config: Pick<
    RankingConfig,
    | 'sectorMode'
    | 'sectorTopN'
    | 'perSectorPool'
    | 'wildcardCandidatePool'
    | 'minReturn20Coverage'
    | 'rsLbSwing'
  >;
}): RankingPoolGateOk | RankingPoolGateFail {
  const { members, eligibleSectors, config } = input;
  const liquidCount = members.length;
  const return20Count = members.filter((m) => m.return20 != null).length;
  const return20Coverage = liquidCount > 0 ? return20Count / liquidCount : 0;
  const bhavSessionsNeeded = config.rsLbSwing + 1;
  const eligibleSet = new Set(eligibleSectors);

  const baseDiag = {
    liquidCount,
    return20Count,
    return20Coverage,
    minReturn20Coverage: config.minReturn20Coverage,
    bhavSessionsNeeded,
    eligibleSectors: [...eligibleSectors],
    fallbackUsed: false as const,
  };

  const fail = (failReason: string): RankingPoolGateFail => ({
    ok: false,
    inSector: [],
    outside: [],
    deepSymbols: [],
    diagnostics: {
      ...baseDiag,
      inSectorCount: 0,
      outsideCount: 0,
      deepPoolSize: 0,
      deepPoolFirst: null,
      deepPoolLast: null,
      failed: true,
      failReason,
    },
  });

  if (liquidCount === 0) {
    return fail('no liquid quotes for ranking');
  }

  if (return20Coverage < config.minReturn20Coverage) {
    return fail(
      `return20 coverage ${(return20Coverage * 100).toFixed(1)}% < min ${(config.minReturn20Coverage * 100).toFixed(0)}% (need ≥${bhavSessionsNeeded} bhav sessions per symbol)`,
    );
  }

  const soft = config.sectorMode === 'soft';
  let inSector: RankingPoolMember[];
  let outside: RankingPoolMember[];

  if (soft) {
    // Soft: global top by real return20 only (nulls excluded — never alphabetical pad).
    const ranked = members
      .filter((m) => m.return20 != null)
      .sort((a, b) => (b.return20 as number) - (a.return20 as number))
      .slice(0, config.sectorTopN * config.perSectorPool);
    inSector = ranked;
    outside = [];
    if (inSector.length === 0) {
      return fail('soft mode: no symbols with non-null return20 after coverage gate');
    }
  } else {
    if (eligibleSectors.length === 0) {
      return fail(
        'sector preview empty (no eligible sectors) — refusing alphabetical / null-return fallback',
      );
    }

    inSector = members.filter((m) => eligibleSet.has(m.sector));
    if (inSector.length === 0) {
      return fail(
        `eligible sectors [${eligibleSectors.join(',')}] have 0 liquid members — refusing fallback`,
      );
    }

    outside = members
      .filter((m) => !eligibleSet.has(m.sector) && m.return20 != null)
      .sort((a, b) => (b.return20 as number) - (a.return20 as number))
      .slice(0, config.wildcardCandidatePool);
  }

  const deepSymbols = [
    ...new Set([...inSector, ...outside].map((m) => m.symbol)),
  ];

  return {
    ok: true,
    inSector,
    outside,
    deepSymbols,
    diagnostics: {
      ...baseDiag,
      inSectorCount: inSector.length,
      outsideCount: outside.length,
      deepPoolSize: deepSymbols.length,
      deepPoolFirst: deepSymbols[0] ?? null,
      deepPoolLast: deepSymbols[deepSymbols.length - 1] ?? null,
      failed: false,
      failReason: null,
    },
  };
}
