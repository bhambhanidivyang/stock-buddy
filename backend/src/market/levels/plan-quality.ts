/** Deterministic plan quality for AI shortlist gating. */
export type PlanQuality = 'GREEN' | 'AMBER' | 'RED';

export function worsePlanQuality(a: PlanQuality, b: PlanQuality): PlanQuality {
  const rank = { GREEN: 0, AMBER: 1, RED: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}

/** True when levels may be shown to AI / used as suggestedLevels. */
export function isBuyablePlanQuality(q: PlanQuality | null | undefined): boolean {
  return q === 'GREEN' || q === 'AMBER';
}
