import type { RankingConfig } from '../../config/ranking.config';
import {
  adx,
  atr,
  ema,
  highLowOver,
  periodReturn,
  relativeStrength,
  type OhlcBar,
} from '../indicators';
import { invertPercentile, percentileRank, weightedMean } from './percentile';

export type FactorRaws = {
  symbol: string;
  sector: string;
  // RS
  rsNifty5: number | null;
  rsNifty20: number | null;
  rsNifty63: number | null;
  rsSector20: number | null;
  // Trend
  emaStack: number | null;
  adxDirectional: number | null;
  hhHl: number | null;
  // Near high
  near52w: number | null;
  extAtr: number | null;
  // Persistence
  posDayFrac10: number | null;
  pathSmooth10: number | null;
  multiHorizonAgree: number | null;
  // Volume
  upsideVolRatio: number | null;
  pullbackVolDry: number | null;
  volTrend: number | null;
  // Sector soft
  sectorScore: number | null;
  withinSectorRsPct: number | null;
  // Liquidity soft (optional)
  adtv: number | null;
  // Anti-spike
  spikeSuspect: boolean;
};

export type CategoryScores = {
  relativeStrengthScore: number | null;
  trendScore: number | null;
  nearHighScore: number | null;
  persistenceScore: number | null;
  sectorScore: number | null;
  volumeScore: number | null;
  eventScore: number;
  researchScore: number | null;
  reasons: string[];
};

/** Compute raw factor values for one symbol from OHLC history. */
export function computeFactorRaws(input: {
  symbol: string;
  sector: string;
  bars: OhlcBar[];
  niftyCloses: number[];
  sectorReturn20: number | null;
  sectorScore: number | null;
  config: RankingConfig;
  adtv?: number | null;
}): FactorRaws {
  const { bars, config } = input;
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume ?? 0);
  const n = closes.length;

  const rsNifty5 = relativeStrength(closes, input.niftyCloses, config.rsLbShort);
  const rsNifty20 = config.skipDayRs20
    ? relativeStrengthSkipLast(closes, input.niftyCloses, config.rsLbSwing)
    : relativeStrength(closes, input.niftyCloses, config.rsLbSwing);
  const rsNifty63 = relativeStrength(
    closes,
    input.niftyCloses,
    config.rsLbIntermediate,
  );

  const r20 = periodReturn(closes, 20);
  let rsSector20: number | null = null;
  if (r20 != null && input.sectorReturn20 != null) {
    rsSector20 = rsRatio(r20, input.sectorReturn20);
  }

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const c = closes[n - 1];
  let emaStack: number | null = null;
  if (ema20 != null && c != null) {
    if (ema50 != null && ema200 != null && c > ema20 && ema20 > ema50 && ema50 > ema200) {
      emaStack = 100;
    } else if (ema50 != null && c > ema20 && ema20 > ema50) {
      emaStack = 66;
    } else if (c > ema20) {
      emaStack = 33;
    } else {
      emaStack = 0;
    }
  }

  const adxRes = adx(bars, config.adxPeriod);
  let adxDirectional: number | null = null;
  if (adxRes != null) {
    adxDirectional =
      adxRes.plusDi > adxRes.minusDi ? adxRes.adx : 0;
  }

  let hhHl: number | null = null;
  if (n >= 6) {
    const highNow = Math.max(...bars.slice(-5).map((b) => b.high));
    const highPrev = Math.max(...bars.slice(-10, -5).map((b) => b.high));
    const lowNow = Math.min(...bars.slice(-5).map((b) => b.low));
    const lowPrev = Math.min(...bars.slice(-10, -5).map((b) => b.low));
    let pts = 0;
    if (highNow > highPrev) pts += 1;
    if (lowNow > lowPrev) pts += 1;
    hhHl = pts * 50;
  }

  const range = highLowOver(bars, Math.min(config.nearHighBars, n));
  const near52w =
    range.high != null && range.high > 0 && c != null ? c / range.high : null;

  const atr14 = atr(bars, 14);
  const extAtr =
    ema20 != null && atr14 != null && atr14 > 0 && c != null
      ? (c - ema20) / atr14
      : null;

  const dailyRets = dailyReturns(closes);
  const last10 = dailyRets.slice(-10);
  const posDayFrac10 =
    last10.length >= 10
      ? last10.filter((r) => r > 0).length / last10.length
      : null;

  let pathSmooth10: number | null = null;
  if (last10.length >= 10) {
    const net = last10.reduce((a, b) => a + b, 0);
    const absSum = last10.reduce((a, b) => a + Math.abs(b), 0);
    pathSmooth10 = absSum > 0 ? net / absSum : null;
  }

  const r5 = periodReturn(closes, 5);
  const multiHorizonAgree =
    r5 != null && r20 != null && r5 > 0 && r20 > 0 ? 100 : 0;

  // Volume confirmation
  let upVol = 0;
  let downVol = 0;
  const look = Math.min(15, n - 1);
  for (let i = n - look; i < n; i += 1) {
    if (i <= 0) continue;
    const vol = volumes[i] ?? 0;
    if (closes[i] > closes[i - 1]) upVol += vol;
    else if (closes[i] < closes[i - 1]) downVol += vol;
  }
  const upsideVolRatio = downVol > 0 ? upVol / downVol : upVol > 0 ? 3 : null;

  const meanVol20 = mean(volumes.slice(-21, -1));
  let pullbackVolDry: number | null = null;
  if (meanVol20 != null && meanVol20 > 0 && ema20 != null) {
    const pbVols: number[] = [];
    for (let i = Math.max(1, n - 20); i < n; i += 1) {
      if (closes[i] < closes[i - 1] || closes[i] < ema20) {
        pbVols.push(volumes[i] ?? 0);
      }
    }
    const last5pb = pbVols.slice(-5);
    if (last5pb.length > 0) {
      pullbackVolDry = mean(last5pb)! / meanVol20;
    }
  }

  const meanVol5 = mean(volumes.slice(-5));
  const volTrend =
    meanVol5 != null && meanVol20 != null && meanVol20 > 0
      ? meanVol5 / meanVol20
      : null;

  // Anti-spike: single day > 3σ and rest of 5d ≤ 0
  let spikeSuspect = false;
  if (dailyRets.length >= 21) {
    const window = dailyRets.slice(-21, -1);
    const mu = mean(window) ?? 0;
    const sd = stdev(window, mu);
    const last = dailyRets[dailyRets.length - 1];
    if (sd > 0 && last > mu + 3 * sd) {
      const r5ex = periodReturn(closes.slice(0, -1), 5);
      if (r5ex == null || r5ex <= 0) spikeSuspect = true;
    }
  }

  return {
    symbol: input.symbol,
    sector: input.sector,
    rsNifty5,
    rsNifty20,
    rsNifty63,
    rsSector20,
    emaStack,
    adxDirectional,
    hhHl,
    near52w,
    extAtr,
    posDayFrac10,
    pathSmooth10,
    multiHorizonAgree,
    upsideVolRatio,
    pullbackVolDry,
    volTrend,
    sectorScore: input.sectorScore,
    withinSectorRsPct: null,
    adtv: input.adtv ?? null,
    spikeSuspect,
  };
}

/**
 * Cross-sectionally percentile raw factors and combine into research scores.
 */
export function scoreUniverse(
  raws: FactorRaws[],
  config: RankingConfig,
): Map<string, CategoryScores> {
  const n = raws.length;
  const pct = (picker: (r: FactorRaws) => number | null) =>
    percentileRank(raws.map(picker));

  const pRs5 = pct((r) => r.rsNifty5);
  const pRs20 = pct((r) => r.rsNifty20);
  const pRs63 = pct((r) => r.rsNifty63);
  const pRsSec = pct((r) => r.rsSector20);
  const pEma = pct((r) => r.emaStack);
  const pAdx = pct((r) => r.adxDirectional);
  const pHh = pct((r) => r.hhHl);
  const pNear = pct((r) => r.near52w);
  const pPos = pct((r) => r.posDayFrac10);
  const pSmooth = pct((r) => r.pathSmooth10);
  const pMulti = pct((r) => r.multiHorizonAgree);
  const pUpVol = pct((r) => r.upsideVolRatio);
  const pPbVolRaw = pct((r) => r.pullbackVolDry);
  const pPbVol = pPbVolRaw.map(invertPercentile); // lower pullback vol = better
  const pVolTrend = pct((r) => r.volTrend);
  const pSectorScore = pct((r) => r.sectorScore);

  // Within-sector RS percentile
  const withinSector = new Array<number | null>(n).fill(null);
  const bySector = new Map<string, number[]>();
  raws.forEach((r, i) => {
    if (r.rsNifty20 == null) return;
    const list = bySector.get(r.sector) ?? [];
    list.push(i);
    bySector.set(r.sector, list);
  });
  for (const idxs of bySector.values()) {
    const vals = idxs.map((i) => raws[i].rsSector20 ?? raws[i].rsNifty20);
    const local = percentileRank(vals);
    idxs.forEach((i, j) => {
      withinSector[i] = local[j];
    });
  }

  // RS acceleration: pct(RS5) - pct(RS20)
  const accelRaw = raws.map((_, i) =>
    pRs5[i] != null && pRs20[i] != null ? pRs5[i]! - pRs20[i]! : null,
  );
  const pAccel = percentileRank(accelRaw);

  const out = new Map<string, CategoryScores>();

  for (let i = 0; i < n; i += 1) {
    const r = raws[i];
    const rsScore = weightedMean([
      { weight: 0.35, value: pRs20[i] },
      { weight: 0.25, value: pRsSec[i] },
      { weight: 0.15, value: pRs5[i] },
      { weight: 0.15, value: pRs63[i] },
      { weight: 0.1, value: pAccel[i] },
    ]);

    const trendScore = weightedMean([
      { weight: 0.4, value: pEma[i] },
      { weight: 0.35, value: pAdx[i] },
      { weight: 0.25, value: pHh[i] },
    ]);

    let nearHighScore = pNear[i];
    if (
      nearHighScore != null &&
      r.extAtr != null &&
      r.extAtr > config.extSoftAtr + 1.5
    ) {
      nearHighScore *= 0.85;
    }

    const persistenceScore = weightedMean([
      { weight: 0.45, value: pSmooth[i] },
      { weight: 0.35, value: pPos[i] },
      { weight: 0.2, value: pMulti[i] },
    ]);

    const sectorScore = weightedMean([
      { weight: 0.5, value: pSectorScore[i] },
      { weight: 0.5, value: withinSector[i] },
    ]);

    let volumeScore = weightedMean([
      { weight: 0.45, value: pUpVol[i] },
      { weight: 0.3, value: pPbVol[i] },
      { weight: 0.25, value: pVolTrend[i] },
    ]);
    // Cap volume without RS
    if ((pRs20[i] ?? 0) < 40 && volumeScore != null) {
      volumeScore = Math.min(volumeScore, 40);
    }

    const eventScore = 0;

    const researchScore = weightedMean([
      { weight: config.wRs, value: rsScore },
      { weight: config.wTrend, value: trendScore },
      { weight: config.wNearHigh, value: nearHighScore },
      { weight: config.wPersistence, value: persistenceScore },
      { weight: config.wSector, value: sectorScore },
      { weight: config.wVolume, value: volumeScore },
      { weight: config.wEvent, value: eventScore },
    ]);

    const reasons: string[] = [];
    const tag = (label: string, p: number | null, min = 80) => {
      if (p != null && p >= min) reasons.push(label);
    };
    tag(`RS20 top ${(100 - (pRs20[i] ?? 0)).toFixed(0)}%ile`, pRs20[i]);
    tag('RS vs sector strong', pRsSec[i]);
    tag('Near 52w high', pNear[i]);
    tag('Trend stack/ADX strong', trendScore);
    tag('Persistent grind', persistenceScore);
    tag(`Sector ${r.sector} leading`, pSectorScore[i]);
    tag('Volume confirmation', volumeScore);
    if (r.spikeSuspect) reasons.push('spike-suspect');

    out.set(r.symbol, {
      relativeStrengthScore: rsScore,
      trendScore,
      nearHighScore,
      persistenceScore,
      sectorScore,
      volumeScore,
      eventScore,
      researchScore,
      reasons: reasons.slice(0, 5),
    });
  }

  return out;
}

function relativeStrengthSkipLast(
  stockCloses: number[],
  benchCloses: number[],
  lookback: number,
): number | null {
  if (stockCloses.length < lookback + 2 || benchCloses.length < lookback + 2) {
    return null;
  }
  const s = stockCloses.slice(0, -1);
  const b = benchCloses.slice(0, -1);
  return relativeStrength(s, b, lookback);
}

function rsRatio(assetRet: number, benchRet: number): number {
  if (Math.abs(benchRet) < 0.001) return 1 + assetRet;
  return (1 + assetRet) / (1 + benchRet);
}

function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i - 1] > 0) out.push(closes[i] / closes[i - 1] - 1);
  }
  return out;
}

function mean(vals: number[]): number | null {
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function stdev(vals: number[], mu: number): number {
  if (vals.length < 2) return 0;
  const v =
    vals.reduce((a, b) => a + (b - mu) ** 2, 0) / (vals.length - 1);
  return Math.sqrt(v);
}
