import { round } from '../market/indicators';

/**
 * Position Manager: tighten stop under newer structure only.
 * Never raises sellTarget. Never recomputes entry bands.
 */
export function planStructureTrail(input: {
  currentStopLoss: number;
  currentSellTarget: number;
  buyPrice: number;
  /** Newest swing low below price (structure). */
  structureLow: number | null;
  atr: number;
  stopAtrBuffer: number;
}): {
  stopLoss: number;
  sellTarget: number;
  changed: boolean;
  reason: string;
} | null {
  const {
    currentStopLoss,
    currentSellTarget,
    buyPrice,
    structureLow,
    atr,
    stopAtrBuffer,
  } = input;

  if (!(buyPrice > 0) || !(currentSellTarget > currentStopLoss) || !(atr > 0)) {
    return null;
  }

  let stopLoss = currentStopLoss;
  let reason = 'no trail';

  if (structureLow != null && structureLow > 0) {
    const trailed = round(structureLow - stopAtrBuffer * atr, 2);
    if (trailed > currentStopLoss && trailed < currentSellTarget) {
      stopLoss = trailed;
      reason = 'trailed stop under newer swing low';
    }
  }

  const sellTarget = currentSellTarget; // never raise or invent
  const changed = stopLoss > currentStopLoss + 1e-9;

  return {
    stopLoss,
    sellTarget,
    changed,
    reason: changed ? reason : 'already tight / no newer structure',
  };
}

/** IST calendar sessions between buy and as-of (approx weekday count). */
export function sessionsHeldIst(buyAt: Date, asOf: Date = new Date()): number {
  const start = istDayKey(buyAt);
  const end = istDayKey(asOf);
  if (end <= start) {
    return 0;
  }
  let n = 0;
  const d = new Date(`${start}T06:00:00+05:30`);
  const endD = new Date(`${end}T06:00:00+05:30`);
  while (d < endD) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
    }).format(d);
    if (wd !== 'Sat' && wd !== 'Sun') {
      n += 1;
    }
  }
  return n;
}

function istDayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
