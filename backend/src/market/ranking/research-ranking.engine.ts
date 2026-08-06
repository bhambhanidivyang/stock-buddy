import type { RankingConfig } from '../../config/ranking.config';
import {
  ema,
  relativeStrength,
  type OhlcBar,
} from '../indicators';
import {
  computeFactorRaws,
  scoreUniverse,
  type CategoryScores,
  type FactorRaws,
} from './factors';
import {
  classifyMarketRegime,
  type MarketRegimeLabel,
  type RegimeResult,
} from './regime';
import { rankSectors, type SectorRankRow } from './sector-rank';

export type RankedStock = CategoryScores & {
  symbol: string;
  sector: string;
  overallScore: number;
  rank: number;
  isWildcard: boolean;
  sectorRank: number | null;
  factorPercentiles?: Record<string, number>;
};

export type ResearchRankingResult = {
  regime: RegimeResult;
  sectorRanks: SectorRankRow[];
  eligibleSectors: string[];
  poolSize: number;
  top: RankedStock[];
  allScored: RankedStock[];
};

export type RankingStockInput = {
  symbol: string;
  sector: string;
  bars: OhlcBar[];
  /** 20d simple return from cheap series (bhav); used for sector RS + pre-rank. */
  return20?: number | null;
  return5?: number | null;
  adtv?: number | null;
};

/**
 * Pure research ranking: sector gate → pool → score → Top K (hybrid wildcards).
 * Does not use today's % / gap / RVOL.
 */
export function runResearchRanking(input: {
  stocks: RankingStockInput[];
  niftyCloses: number[];
  regime: Parameters<typeof classifyMarketRegime>[0];
  config: RankingConfig;
}): ResearchRankingResult {
  const { config } = input;
  const sectorRanks = rankSectors({
    members20: input.stocks.map((s) => ({
      symbol: s.symbol,
      sector: s.sector,
      returnL:
        s.return20 ??
        periodRet(s.bars.map((b) => b.close), 20),
    })),
    members5: input.stocks.map((s) => ({
      symbol: s.symbol,
      sector: s.sector,
      returnL:
        s.return5 ?? periodRet(s.bars.map((b) => b.close), 5),
    })),
    minSectorMembers: config.minSectorMembers,
  });

  const sectorBreadth =
    sectorRanks.length > 0
      ? sectorRanks.filter((s) => s.sectorRs20 > 1).length / sectorRanks.length
      : null;

  const regime = classifyMarketRegime(
    { ...input.regime, sectorBreadth },
    config,
  );

  const eligibleSectors = sectorRanks
    .slice(0, config.sectorTopN)
    .map((s) => s.sector);
  const eligibleSet = new Set(eligibleSectors);
  const sectorScoreByName = new Map(
    sectorRanks.map((s) => [s.sector, s.score]),
  );
  const sectorReturnByName = new Map(
    sectorRanks.map((s) => [s.sector, s.sectorReturn20]),
  );
  const sectorRankByName = new Map(
    sectorRanks.map((s) => [s.sector, s.rank]),
  );

  // Soft mode: all sectors eligible for pool building
  const soft = config.sectorMode === 'soft';

  // Build deep-scored set: members of eligible sectors with enough bars,
  // plus outside names (for hybrid/soft).
  const deepable = input.stocks.filter(
    (s) => s.bars.length >= Math.min(220, config.nearHighBars),
  );

  const inEligible = deepable.filter(
    (s) => soft || eligibleSet.has(s.sector),
  );
  const outside = deepable.filter((s) => !eligibleSet.has(s.sector));

  // Per-sector pool cap via cheap pre-score
  const poolSymbols = new Set<string>();
  if (soft) {
    // Soft: take top perSectorPool * sectorTopN by pre-score globally
    const pre = [...deepable]
      .map((s) => ({
        symbol: s.symbol,
        pre: preScore(s, input.niftyCloses),
      }))
      .sort((a, b) => b.pre - a.pre)
      .slice(0, config.sectorTopN * config.perSectorPool);
    for (const p of pre) poolSymbols.add(p.symbol);
  } else {
    for (const sector of eligibleSectors) {
      const members = inEligible
        .filter((s) => s.sector === sector)
        .map((s) => ({
          symbol: s.symbol,
          stock: s,
          pre: preScore(s, input.niftyCloses),
        }))
        .sort((a, b) => b.pre - a.pre)
        .slice(0, config.perSectorPool);
      for (const m of members) poolSymbols.add(m.symbol);
    }
    // Wildcard candidate pool: best outside by 20d return / pre-score
    const wc = [...outside]
      .map((s) => ({ symbol: s.symbol, pre: preScore(s, input.niftyCloses) }))
      .sort((a, b) => b.pre - a.pre)
      .slice(0, config.wildcardCandidatePool);
    for (const w of wc) poolSymbols.add(w.symbol);
  }

  const toScore = deepable.filter((s) => poolSymbols.has(s.symbol));

  const raws: FactorRaws[] = toScore.map((s) => {
    const raw = computeFactorRaws({
      symbol: s.symbol,
      sector: s.sector,
      bars: s.bars,
      niftyCloses: input.niftyCloses,
      sectorReturn20: sectorReturnByName.get(s.sector) ?? null,
      sectorScore: sectorScoreByName.get(s.sector) ?? null,
      config,
      adtv: s.adtv,
    });
    return raw;
  });

  // Drop spike suspects from pool (still allowed as wildcards only if exceptional — drop for v1)
  const filteredRaws = raws.filter((r) => !r.spikeSuspect);
  const scores = scoreUniverse(filteredRaws, config);

  const scored: RankedStock[] = filteredRaws
    .map((r) => {
      const sc = scores.get(r.symbol);
      if (!sc || sc.researchScore == null) return null;
      const inSector = eligibleSet.has(r.sector);
      return {
        symbol: r.symbol,
        sector: r.sector,
        overallScore: sc.researchScore,
        rank: 0,
        isWildcard: !inSector && !soft,
        sectorRank: sectorRankByName.get(r.sector) ?? null,
        ...sc,
      };
    })
    .filter((x): x is RankedStock => x != null);

  scored.sort(
    (a, b) =>
      b.overallScore - a.overallScore ||
      (b.relativeStrengthScore ?? 0) - (a.relativeStrengthScore ?? 0),
  );
  scored.forEach((s, i) => {
    s.rank = i + 1;
  });

  const top = selectTopK(scored, config, eligibleSet, soft);

  return {
    regime,
    sectorRanks,
    eligibleSectors,
    poolSize: toScore.length,
    top,
    allScored: scored,
  };
}

function selectTopK(
  scored: RankedStock[],
  config: RankingConfig,
  eligibleSet: Set<string>,
  soft: boolean,
): RankedStock[] {
  const k = config.topK;
  if (soft || config.sectorMode === 'strict') {
    const base =
      config.sectorMode === 'strict'
        ? scored.filter((s) => eligibleSet.has(s.sector))
        : scored;
    return applySectorShareCap(base.slice(0, k * 2), config).slice(0, k);
  }

  // Hybrid
  const wildcardSeats = Math.floor(config.wildcardPct * k);
  const coreSeats = k - wildcardSeats;
  const core = scored.filter((s) => eligibleSet.has(s.sector));
  const wild = scored.filter((s) => !eligibleSet.has(s.sector));

  // Wildcard quality gate: strong RS + near high + trend
  const wildOk = wild.filter(
    (s) =>
      (s.relativeStrengthScore ?? 0) >= 95 &&
      (s.nearHighScore ?? 0) >= 90 &&
      (s.trendScore ?? 0) >= 66,
  );

  const picked: RankedStock[] = [];
  const used = new Set<string>();

  for (const s of applySectorShareCap(core, config)) {
    if (picked.length >= coreSeats) break;
    picked.push({ ...s, isWildcard: false });
    used.add(s.symbol);
  }

  for (const s of wildOk) {
    if (picked.length >= k) break;
    if (used.has(s.symbol)) continue;
    if (picked.filter((p) => p.isWildcard).length >= wildcardSeats) break;
    picked.push({ ...s, isWildcard: true });
    used.add(s.symbol);
  }

  // Fill remaining from core then any scored
  for (const s of scored) {
    if (picked.length >= k) break;
    if (used.has(s.symbol)) continue;
    if (!eligibleSet.has(s.sector)) continue;
    picked.push({ ...s, isWildcard: false });
    used.add(s.symbol);
  }

  picked.sort((a, b) => b.overallScore - a.overallScore);
  picked.forEach((s, i) => {
    s.rank = i + 1;
  });
  return picked;
}

function applySectorShareCap(
  list: RankedStock[],
  config: RankingConfig,
): RankedStock[] {
  const maxPer = Math.max(1, Math.ceil(config.maxSectorShare * config.topK));
  const counts = new Map<string, number>();
  const out: RankedStock[] = [];
  for (const s of list) {
    const n = counts.get(s.sector) ?? 0;
    if (n >= maxPer) continue;
    counts.set(s.sector, n + 1);
    out.push(s);
  }
  return out;
}

function preScore(s: RankingStockInput, niftyCloses: number[]): number {
  const closes = s.bars.map((b) => b.close);
  if (closes.length < 50) {
    return (s.return20 ?? -1) * 100;
  }
  const rs = relativeStrength(closes, niftyCloses, 20) ?? 1;
  const c = closes[closes.length - 1];
  const highs = s.bars.map((b) => b.high);
  const hi = Math.max(...highs.slice(-Math.min(252, highs.length)));
  const near = hi > 0 ? c / hi : 0;
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const stack = e20 != null && e50 != null && c > e20 && e20 > e50 ? 1 : 0.3;
  return 0.5 * rs * 50 + 0.3 * near * 100 + 0.2 * stack * 100;
}

function periodRet(closes: number[], lookback: number): number | null {
  if (closes.length < lookback + 1) return null;
  const a = closes[closes.length - 1 - lookback];
  const b = closes[closes.length - 1];
  if (a <= 0) return null;
  return b / a - 1;
}

export type { MarketRegimeLabel, SectorRankRow };
