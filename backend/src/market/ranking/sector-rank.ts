import { periodReturn } from '../indicators';
import { percentileRank } from './percentile';

export type SectorMemberReturn = {
  symbol: string;
  sector: string;
  /** Simple return over L sessions (e.g. 0.05 = +5%). */
  returnL: number | null;
};

export type SectorRankRow = {
  sector: string;
  memberCount: number;
  sectorReturn20: number;
  marketReturn20: number;
  sectorRs20: number;
  sectorRs5: number | null;
  score: number;
  rank: number;
};

/**
 * Rank sectors by relative strength vs equal-weight liquid market (not absolute return).
 */
export function rankSectors(input: {
  members20: SectorMemberReturn[];
  members5?: SectorMemberReturn[];
  minSectorMembers: number;
}): SectorRankRow[] {
  const bySector20 = groupReturns(input.members20);
  const bySector5 = groupReturns(input.members5 ?? []);

  const marketRet20 = equalWeightReturn(input.members20);
  const marketRet5 = equalWeightReturn(input.members5 ?? []);

  const rows: Array<Omit<SectorRankRow, 'score' | 'rank'> & { rawRs: number }> =
    [];

  for (const [sector, rets] of bySector20) {
    if (sector === 'Unknown') continue;
    if (rets.length < input.minSectorMembers) continue;
    const sectorReturn20 = mean(rets);
    if (sectorReturn20 == null || marketRet20 == null) continue;
    const sectorRs20 = rsRatio(sectorReturn20, marketRet20);
    const rets5 = bySector5.get(sector);
    let sectorRs5: number | null = null;
    if (rets5 && rets5.length >= input.minSectorMembers && marketRet5 != null) {
      const s5 = mean(rets5);
      if (s5 != null) sectorRs5 = rsRatio(s5, marketRet5);
    }
    rows.push({
      sector,
      memberCount: rets.length,
      sectorReturn20,
      marketReturn20: marketRet20,
      sectorRs20,
      sectorRs5,
      rawRs: sectorRs20,
    });
  }

  const pcts = percentileRank(rows.map((r) => r.rawRs));
  const scored = rows.map((r, i) => {
    let score = pcts[i] ?? 0;
    const rs5 = r.sectorRs5;
    // Small persistence bonus when both horizons lead
    if (rs5 != null && r.sectorRs20 > 1 && rs5 > 1) {
      score = Math.min(100, score + 5);
    }
    return {
      sector: r.sector,
      memberCount: r.memberCount,
      sectorReturn20: r.sectorReturn20,
      marketReturn20: r.marketReturn20,
      sectorRs20: r.sectorRs20,
      sectorRs5: r.sectorRs5,
      score,
      rank: 0,
    };
  });

  scored.sort((a, b) => b.score - a.score || b.sectorRs20 - a.sectorRs20);
  scored.forEach((r, i) => {
    r.rank = i + 1;
  });
  return scored;
}

export function periodReturnFromCloses(
  closes: number[],
  lookback: number,
): number | null {
  return periodReturn(closes, lookback);
}

function groupReturns(
  members: SectorMemberReturn[],
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const m of members) {
    if (m.returnL == null || !Number.isFinite(m.returnL)) continue;
    const list = map.get(m.sector) ?? [];
    list.push(m.returnL);
    map.set(m.sector, list);
  }
  return map;
}

function equalWeightReturn(members: SectorMemberReturn[]): number | null {
  const vals = members
    .map((m) => m.returnL)
    .filter((n): n is number => n != null && Number.isFinite(n));
  return mean(vals);
}

function mean(vals: number[]): number | null {
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function rsRatio(assetRet: number, benchRet: number): number {
  if (Math.abs(benchRet) < 0.001) {
    return 1 + assetRet;
  }
  return (1 + assetRet) / (1 + benchRet);
}
