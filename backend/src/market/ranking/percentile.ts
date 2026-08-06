/** Cross-sectional percentile helpers (0–100). Higher raw = better unless inverted. */

export function percentileRank(
  values: Array<number | null | undefined>,
): Array<number | null> {
  const indexed: Array<{ i: number; v: number }> = [];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v != null && Number.isFinite(v)) {
      indexed.push({ i, v });
    }
  }
  const out: Array<number | null> = values.map(() => null);
  if (indexed.length === 0) {
    return out;
  }
  if (indexed.length === 1) {
    out[indexed[0].i] = 50;
    return out;
  }
  indexed.sort((a, b) => a.v - b.v);
  // Average ranks for ties
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) {
      j += 1;
    }
    const avgRank = (i + j) / 2;
    const pct = (100 * avgRank) / (indexed.length - 1);
    for (let k = i; k <= j; k += 1) {
      out[indexed[k].i] = pct;
    }
    i = j + 1;
  }
  return out;
}

export function invertPercentile(p: number | null): number | null {
  if (p == null) return null;
  return 100 - p;
}

/** Weighted mean of available scores; drop nulls (redistribute). */
export function weightedMean(
  parts: Array<{ weight: number; value: number | null }>,
): number | null {
  let wSum = 0;
  let vSum = 0;
  for (const p of parts) {
    if (p.value == null || !Number.isFinite(p.value) || p.weight <= 0) {
      continue;
    }
    wSum += p.weight;
    vSum += p.weight * p.value;
  }
  if (wSum <= 0) return null;
  return vSum / wSum;
}
