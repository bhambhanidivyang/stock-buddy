import { round } from '../indicators';
import type { LevelsConfig } from './levels.config';
import type { PlanQuality } from './plan-quality';
import type { RejectionCode, StructureLevel } from './types';

export type StopResult =
  | {
      ok: true;
      quality: PlanQuality;
      stopLoss: number;
      stopReason: string;
      structurePrice: number;
      riskPct: number;
      riskAtr: number;
      greenPctCap: number;
      amberPctCap: number;
    }
  | {
      ok: false;
      code: RejectionCode;
      message: string;
      structurePrice?: number;
      stopLoss?: number;
      riskPct?: number;
      riskAtr?: number;
    };

type StopCandidate = {
  structurePrice: number;
  label: string;
  stopLoss: number;
  riskPct: number;
  riskAtr: number;
};

/** Adaptive % caps: max(knob, mult×ATR%) then clipped by hard ceiling. */
export function stopPctCaps(
  buyHigh: number,
  atr: number,
  config: LevelsConfig,
): { greenPctCap: number; amberPctCap: number; hardPct: number } {
  const atrPct = buyHigh > 0 ? atr / buyHigh : 0;
  const hardPct = config.maxStopPctHard;
  const adaptive = config.stopAdaptiveAtrMult * atrPct;
  const greenPctCap = Math.min(
    hardPct,
    Math.max(config.maxStopPctReject, adaptive),
  );
  const amberPctCap = Math.min(
    hardPct,
    Math.max(config.maxStopPctAmber, greenPctCap),
  );
  return { greenPctCap, amberPctCap, hardPct };
}

/**
 * Pick the most relevant structural stop — prefer the highest support / PDL
 * below entry that still clears geometry, especially levels that fit the hard
 * risk cap. Do NOT prefer a distant "most recent" swing when a nearer valid
 * support exists (that was causing false STOP_TOO_WIDE).
 */
export function selectStopStructure(input: {
  buyLow: number;
  buyHigh: number;
  atr: number;
  prevDayLow: number | null;
  supports: StructureLevel[];
  config: LevelsConfig;
}): StopCandidate | null {
  const { buyLow, buyHigh, atr, prevDayLow, supports, config } = input;
  if (!(atr > 0) || !(buyHigh > 0)) return null;

  const { hardPct } = stopPctCaps(buyHigh, atr, config);
  const seen = new Set<number>();
  const raw: Array<{ structurePrice: number; label: string }> = [];

  const push = (price: number, label: string) => {
    const key = round(price, 2);
    if (!(price > 0) || !(price < buyLow) || seen.has(key)) return;
    seen.add(key);
    raw.push({ structurePrice: price, label });
  };

  for (const s of supports) {
    if (s.valid) push(s.levelPrice, 'swing_support');
  }
  if (prevDayLow != null) push(prevDayLow, 'prior_day_low');

  const evaluated: StopCandidate[] = [];
  for (const r of raw) {
    const stopLoss = round(r.structurePrice - config.stopAtrBuffer * atr, 2);
    if (!(stopLoss < buyLow)) continue;
    const risk = buyHigh - stopLoss;
    if (!(risk > 0)) continue;
    evaluated.push({
      structurePrice: r.structurePrice,
      label: r.label,
      stopLoss,
      riskPct: risk / buyHigh,
      riskAtr: risk / atr,
    });
  }
  if (evaluated.length === 0) return null;

  // 1) Among levels within hard risk cap: highest structure (tightest relevant stop)
  const withinHard = evaluated
    .filter((c) => c.riskPct <= hardPct + 1e-9)
    .sort((a, b) => {
      if (a.structurePrice !== b.structurePrice) {
        return b.structurePrice - a.structurePrice;
      }
      return a.riskAtr - b.riskAtr;
    });
  if (withinHard.length > 0) return withinHard[0];

  // 2) None fit the cap — return the least-wide structural stop for honest WATCH
  return [...evaluated].sort((a, b) => {
    if (a.riskPct !== b.riskPct) return a.riskPct - b.riskPct;
    return b.structurePrice - a.structurePrice;
  })[0];
}

export function buildStop(input: {
  buyLow: number;
  buyHigh: number;
  atr: number;
  prevDayLow: number | null;
  supports: StructureLevel[];
  config: LevelsConfig;
}): StopResult {
  const { buyLow, buyHigh, atr, prevDayLow, supports, config } = input;
  if (!(atr > 0)) {
    return { ok: false, code: 'INSUFFICIENT_FEATURES', message: 'no ATR' };
  }

  const selected = selectStopStructure({
    buyLow,
    buyHigh,
    atr,
    prevDayLow,
    supports,
    config,
  });

  if (selected == null) {
    return {
      ok: false,
      code: 'NO_STOP_STRUCTURE',
      message: 'no swing low or PDL below buyLow',
    };
  }

  const { structurePrice, stopLoss, riskPct, riskAtr, label } = selected;
  const stopReason = `${label}_minus_atr_buffer`;
  const { greenPctCap, amberPctCap, hardPct } = stopPctCaps(
    buyHigh,
    atr,
    config,
  );
  const amberAtrCap = Math.max(config.maxStopAtrReject, config.maxStopAtrAmber);

  if (riskPct > hardPct || riskPct > amberPctCap) {
    return {
      ok: false,
      code: 'STOP_TOO_WIDE_PCT',
      message: `riskPct ${riskPct.toFixed(3)} > amberCap ${amberPctCap.toFixed(3)} (hard ${hardPct}); structure=${structurePrice} via ${label}`,
      structurePrice,
      stopLoss,
      riskPct: round(riskPct, 4),
      riskAtr: round(riskAtr, 4),
    };
  }
  if (riskAtr > amberAtrCap) {
    return {
      ok: false,
      code: 'STOP_TOO_WIDE_ATR',
      message: `riskAtr ${riskAtr.toFixed(2)} > amberAtr ${amberAtrCap}; structure=${structurePrice} via ${label}`,
      structurePrice,
      stopLoss,
      riskPct: round(riskPct, 4),
      riskAtr: round(riskAtr, 4),
    };
  }

  const pctGreen = riskPct <= greenPctCap;
  const atrGreen = riskAtr <= config.maxStopAtrReject;
  const quality: PlanQuality = pctGreen && atrGreen ? 'GREEN' : 'AMBER';
  const reasonBits: string[] = [];
  if (!pctGreen) {
    reasonBits.push(
      `riskPct ${riskPct.toFixed(3)} > greenCap ${greenPctCap.toFixed(3)}`,
    );
  }
  if (!atrGreen) {
    reasonBits.push(
      `riskAtr ${riskAtr.toFixed(2)} > greenAtr ${config.maxStopAtrReject}`,
    );
  }
  const reason =
    quality === 'AMBER'
      ? `${stopReason} (amber: ${reasonBits.join('; ')})`
      : stopReason;

  return {
    ok: true,
    quality,
    stopLoss,
    stopReason: reason,
    structurePrice,
    riskPct: round(riskPct, 4),
    riskAtr: round(riskAtr, 4),
    greenPctCap: round(greenPctCap, 4),
    amberPctCap: round(amberPctCap, 4),
  };
}
