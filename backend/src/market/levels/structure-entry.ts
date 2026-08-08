import type { OhlcBar } from '../indicators';
import { round } from '../indicators';
import type { LevelsConfig } from './levels.config';
import type { SetupHit } from './setup.engine';
import { nearestSupportBelow } from './structure';
import type { StructureLevel } from './types';

type Anchor = {
  level: number;
  label: string;
};

type ScoredAnchor = Anchor & {
  buyLow: number;
  buyHigh: number;
  overshootAtr: number;
  inBand: boolean;
};

function lookbackHighClose(bars: OhlcBar[], lookbackDays: number): number | null {
  if (bars.length < lookbackDays + 1) return null;
  const window = bars.slice(-(lookbackDays + 1), -1);
  if (window.length === 0) return null;
  let hi = window[0].close;
  for (let i = 1; i < window.length; i += 1) {
    hi = Math.max(hi, window[i].close);
  }
  return hi > 0 ? hi : null;
}

/**
 * When no named textbook setup fires, pick the best nearby structural anchor
 * for an entry band. Levels come from swing support / PDH / EMA20 / lookback
 * high — never LTP−k×ATR manufactured stops/targets.
 *
 * If price is only extended past an otherwise valid anchor, still return that
 * STRUCTURE hit so the entry engine can classify ENTRY_TOO_EXTENDED (WATCH)
 * instead of a opaque NO_SETUP.
 */
export function resolveStructureSetup(input: {
  ltp: number;
  atr: number;
  ema20: number;
  ema50: number;
  prevDayHigh: number | null;
  supports: StructureLevel[];
  bars?: OhlcBar[];
  config: LevelsConfig;
}): SetupHit | null {
  const { ltp, atr, ema20, ema50, prevDayHigh, supports, bars, config } = input;
  if (!(atr > 0) || !(ltp > 0)) return null;

  const anchors: Anchor[] = [];
  const swing = nearestSupportBelow(supports, ltp);
  if (swing != null && swing.levelPrice > 0) {
    anchors.push({ level: swing.levelPrice, label: 'nearest_swing_support' });
  }
  if (prevDayHigh != null && prevDayHigh > 0) {
    anchors.push({ level: prevDayHigh, label: 'prior_day_high' });
  }
  if (ema20 > ema50 && ema20 > 0) {
    anchors.push({ level: ema20, label: 'ema20' });
  }
  // Deeper trend hold — only when EMA50 is still below LTP and EMA20>EMA50.
  if (ema20 > ema50 && ema50 > 0 && ema50 < ltp) {
    anchors.push({ level: ema50, label: 'ema50' });
  }
  if (bars != null && bars.length > 0) {
    const hi = lookbackHighClose(bars, config.breakoutLookbackDays);
    if (hi != null) {
      anchors.push({
        level: hi,
        label: `${config.breakoutLookbackDays}d_high_close`,
      });
    }
  }
  if (anchors.length === 0) return null;

  const amberAtr = Math.max(config.entryChaseAtr, config.entryAmberAtr);
  const scored: ScoredAnchor[] = [];

  for (const a of anchors) {
    const buyLow = round(a.level - config.emaBandBelowAtr * atr, 2);
    const buyHigh = round(a.level + config.emaPullbackAtr * atr, 2);
    if (!(buyLow < buyHigh)) continue;

    const overshootAtr = ltp > buyHigh ? (ltp - buyHigh) / atr : 0;
    const missed = ltp < buyLow - config.entryMissedAtr * atr;
    if (missed) continue;

    const inBand = ltp <= buyHigh + amberAtr * atr;
    scored.push({
      ...a,
      buyLow,
      buyHigh,
      overshootAtr: round(overshootAtr, 4),
      inBand,
    });
  }

  if (scored.length === 0) return null;

  const inBand = scored.filter((s) => s.inBand);
  const pool = inBand.length > 0 ? inBand : scored;
  pool.sort((a, b) => {
    if (a.overshootAtr !== b.overshootAtr) {
      return a.overshootAtr - b.overshootAtr;
    }
    return b.level - a.level;
  });
  const best = pool[0];

  // Measured-move height from nearest support → anchor (structural, not 2×risk).
  let rangeHeight: number | null = null;
  const base = nearestSupportBelow(supports, best.level);
  if (base != null && best.level > base.levelPrice) {
    rangeHeight = best.level - base.levelPrice;
  }

  const extendedNote =
    !best.inBand
      ? `; LTP extended ${best.overshootAtr.toFixed(2)}ATR above band (classify via entry engine)`
      : '';

  return {
    setupType: 'STRUCTURE',
    breakLevel: best.level,
    rangeHeight,
    reason: `STRUCTURE @ ${best.label} ${best.level.toFixed(2)} (no named setup; band ${best.buyLow}-${best.buyHigh})${extendedNote}`,
  };
}
