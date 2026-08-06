import type { OhlcBar } from '../indicators';
import type { RawPivot, StructureLevel } from './types';

export type StructureConfig = {
  swingWindow: number;
  clusterAtr: number;
  breakBufferAtr: number;
  minTouches: number;
};

/** Confirmed fractal pivots (both flanks must exist). */
export function detectRawPivots(
  bars: OhlcBar[],
  swingWindow: number,
): RawPivot[] {
  const W = Math.max(1, Math.floor(swingWindow));
  const out: RawPivot[] = [];
  const n = bars.length;
  for (let i = W; i + W < n; i += 1) {
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= W; k += 1) {
      if (
        !(bars[i].high >= bars[i - k].high && bars[i].high > bars[i + k].high)
      ) {
        isHigh = false;
      }
      if (
        !(bars[i].low <= bars[i - k].low && bars[i].low < bars[i + k].low)
      ) {
        isLow = false;
      }
    }
    if (isHigh) {
      out.push({ price: bars[i].high, barIndex: i, kind: 'HIGH' });
    }
    if (isLow) {
      out.push({ price: bars[i].low, barIndex: i, kind: 'LOW' });
    }
  }
  return out;
}

function clusterPivots(
  pivots: RawPivot[],
  kind: 'HIGH' | 'LOW',
  atr: number,
  clusterAtr: number,
): StructureLevel[] {
  const tol = clusterAtr * atr;
  const sorted = pivots
    .filter((p) => p.kind === kind)
    .sort((a, b) => a.price - b.price);
  if (sorted.length === 0) {
    return [];
  }

  const clusters: RawPivot[][] = [];
  let cur: RawPivot[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const anchor =
      kind === 'HIGH'
        ? Math.max(...cur.map((p) => p.price))
        : Math.min(...cur.map((p) => p.price));
    if (Math.abs(sorted[i].price - anchor) <= tol) {
      cur.push(sorted[i]);
    } else {
      clusters.push(cur);
      cur = [sorted[i]];
    }
  }
  clusters.push(cur);

  return clusters.map((group) => {
    const levelPrice =
      kind === 'HIGH'
        ? Math.max(...group.map((p) => p.price))
        : Math.min(...group.map((p) => p.price));
    return {
      levelPrice,
      touches: group.length,
      lastBarIndex: Math.max(...group.map((p) => p.barIndex)),
      kind,
      valid: true,
    };
  });
}

export function applyInvalidation(
  levels: StructureLevel[],
  bars: OhlcBar[],
  atr: number,
  breakBufferAtr: number,
): StructureLevel[] {
  const buf = breakBufferAtr * atr;
  return levels.map((level) => {
    let valid = true;
    for (let i = level.lastBarIndex + 1; i < bars.length; i += 1) {
      const c = bars[i].close;
      if (level.kind === 'HIGH' && c > level.levelPrice + buf) {
        valid = false;
        break;
      }
      if (level.kind === 'LOW' && c < level.levelPrice - buf) {
        valid = false;
        break;
      }
    }
    return { ...level, valid };
  });
}

export function buildStructureLevels(
  bars: OhlcBar[],
  atr: number,
  config: StructureConfig,
): { resistances: StructureLevel[]; supports: StructureLevel[] } {
  if (!(atr > 0) || bars.length < config.swingWindow * 2 + 3) {
    return { resistances: [], supports: [] };
  }
  const raw = detectRawPivots(bars, config.swingWindow);
  let resistances = clusterPivots(raw, 'HIGH', atr, config.clusterAtr);
  let supports = clusterPivots(raw, 'LOW', atr, config.clusterAtr);
  resistances = applyInvalidation(
    resistances,
    bars,
    atr,
    config.breakBufferAtr,
  ).filter((l) => l.touches >= config.minTouches);
  supports = applyInvalidation(
    supports,
    bars,
    atr,
    config.breakBufferAtr,
  ).filter((l) => l.touches >= config.minTouches);
  return { resistances, supports };
}

export function nearestSupportBelow(
  supports: StructureLevel[],
  x: number,
): StructureLevel | null {
  const cands = supports
    .filter((l) => l.valid && l.levelPrice < x)
    .sort((a, b) => {
      if (a.levelPrice !== b.levelPrice) return b.levelPrice - a.levelPrice;
      if (a.touches !== b.touches) return b.touches - a.touches;
      return b.lastBarIndex - a.lastBarIndex;
    });
  return cands[0] ?? null;
}

/** Most recent valid support below x (stop priority). */
export function mostRecentSupportBelow(
  supports: StructureLevel[],
  x: number,
): StructureLevel | null {
  const cands = supports
    .filter((l) => l.valid && l.levelPrice < x)
    .sort((a, b) => b.lastBarIndex - a.lastBarIndex);
  return cands[0] ?? null;
}

export function resistancesAbove(
  resistances: StructureLevel[],
  x: number,
  limit: number,
): StructureLevel[] {
  return resistances
    .filter((l) => l.valid && l.levelPrice > x)
    .sort((a, b) => a.levelPrice - b.levelPrice)
    .slice(0, Math.max(0, limit));
}

/**
 * Most recent close-break of a then-valid resistance within lookback.
 * rangeHeight = R − support below R (or window low).
 */
export function findBreakoutLevel(
  bars: OhlcBar[],
  atr: number,
  config: StructureConfig,
  lookbackBars: number,
): { R: number; breakBarIndex: number; rangeHeight: number } | null {
  if (bars.length < config.swingWindow * 2 + 5 || !(atr > 0)) {
    return null;
  }
  const buf = config.breakBufferAtr * atr;
  const start = Math.max(config.swingWindow * 2 + 1, bars.length - lookbackBars);

  for (let i = bars.length - 1; i >= start; i -= 1) {
    const prior = bars.slice(0, i);
    const { resistances, supports } = buildStructureLevels(prior, atr, config);
    const validRes = resistances
      .filter((l) => l.valid)
      .sort((a, b) => b.levelPrice - a.levelPrice);
    if (validRes.length === 0) {
      continue;
    }
    const R = validRes[0].levelPrice;
    const prevClose = bars[i - 1]?.close;
    const close = bars[i].close;
    if (prevClose == null) {
      continue;
    }
    if (prevClose <= R + buf && close > R + buf) {
      const sup = nearestSupportBelow(
        supports.filter((s) => s.valid),
        R,
      );
      const baseStart = Math.max(0, i - 20);
      let windowLow = bars[baseStart].low;
      for (let j = baseStart; j < i; j += 1) {
        windowLow = Math.min(windowLow, bars[j].low);
      }
      const supportLow = sup?.levelPrice ?? windowLow;
      const rangeHeight = R - supportLow;
      if (rangeHeight > 0) {
        return { R, breakBarIndex: i, rangeHeight };
      }
    }
  }
  return null;
}
