import { ema, rsi } from '../market/indicators';
import { ManagementPhase } from '../database/enums';
import type {
  ExecutionQuote,
  IntradayBar,
  PositionSnapshot,
} from './types';

export type TradeSnapshotInput = {
  id: string;
  symbol: string;
  qty: number;
  status: string;
  managementPhase: ManagementPhase | null;
  buyPrice: number;
  buyAt: Date | null;
  buyLow: number;
  buyHigh: number;
  stopLoss: number;
  sellTarget: number;
  initialStop: number | null;
  originalTarget: number | null;
  highWaterMark: number | null;
  maxUnrealizedPct: number | null;
  summary: string;
};

export type MarketContextInput = {
  niftyPrice: number | null;
  niftyChangePct: number | null;
  bankNiftyChangePct: number | null;
  indiaVix: number | null;
};

function vwapFromBars(bars: IntradayBar[]): number | null {
  let pv = 0;
  let vol = 0;
  for (const bar of bars) {
    if (!(bar.volume > 0)) {
      continue;
    }
    const typical = (bar.high + bar.low + bar.close) / 3;
    pv += typical * bar.volume;
    vol += bar.volume;
  }
  if (vol <= 0) {
    return null;
  }
  return pv / vol;
}

function rvolFromBars(bars: IntradayBar[]): number | null {
  if (bars.length < 6) {
    return null;
  }
  const last = bars[bars.length - 1];
  const prior = bars.slice(0, -1);
  const avg =
    prior.reduce((s, b) => s + (b.volume || 0), 0) / Math.max(prior.length, 1);
  if (!(avg > 0) || last.volume == null) {
    return null;
  }
  return last.volume / avg;
}

/**
 * Deterministic snapshot used by live AI and (later) backtest replay.
 * No I/O — callers supply quotes, bars, and thesis text.
 */
export function buildPositionSnapshot(input: {
  trade: TradeSnapshotInput;
  quote: ExecutionQuote;
  bars1m?: IntradayBar[];
  bars5m?: IntradayBar[];
  marketContext?: MarketContextInput;
  now?: Date;
}): PositionSnapshot {
  const now = input.now ?? new Date();
  const t = input.trade;
  const price = input.quote.price;
  const invested = t.buyPrice * t.qty;
  const value = price * t.qty;
  const pnl = value - invested;
  const pnlPct = t.buyPrice > 0 ? (pnl / invested) * 100 : 0;
  const originalStop = t.initialStop ?? t.stopLoss;
  const originalTarget = t.originalTarget ?? t.sellTarget;
  const bars1m = input.bars1m ?? [];
  const bars5m = input.bars5m ?? [];
  const closes5m = bars5m.map((b) => b.close);
  const highs = bars1m.map((b) => b.high);
  const lows = bars1m.map((b) => b.low);
  const distStop =
    t.buyPrice > t.stopLoss && t.buyPrice > 0
      ? ((price - t.stopLoss) / (t.buyPrice - t.stopLoss)) * 100
      : null;
  const distTarget =
    originalTarget > t.buyPrice && t.buyPrice > 0
      ? ((originalTarget - price) / (originalTarget - t.buyPrice)) * 100
      : null;

  return {
    tradeId: t.id,
    symbol: t.symbol,
    qty: t.qty,
    status: t.status,
    managementPhase: t.managementPhase,
    entryPrice: t.buyPrice,
    currentLtp: price,
    currentPnl: Number(pnl.toFixed(2)),
    currentPnlPct: Number(pnlPct.toFixed(4)),
    positionValue: Number(value.toFixed(2)),
    timeSinceEntryMs: t.buyAt ? now.getTime() - t.buyAt.getTime() : 0,
    originalEntryLow: t.buyLow,
    originalEntryHigh: t.buyHigh,
    originalStop,
    originalTarget,
    currentStop: t.stopLoss,
    currentTarget: t.sellTarget,
    highWaterMark: t.highWaterMark,
    maxUnrealizedPct: t.maxUnrealizedPct,
    mfePct:
      t.highWaterMark != null && t.buyPrice > 0
        ? Number((((t.highWaterMark - t.buyPrice) / t.buyPrice) * 100).toFixed(4))
        : null,
    distanceToStopPct:
      distStop == null ? null : Number(distStop.toFixed(4)),
    distanceToTargetPct:
      distTarget == null ? null : Number(distTarget.toFixed(4)),
    distanceFromEntryPct:
      t.buyPrice > 0
        ? Number((((price - t.buyPrice) / t.buyPrice) * 100).toFixed(4))
        : null,
    quote: {
      fetchAgeMs: input.quote.fetchAgeMs,
      exchangeDelayMs: input.quote.exchangeDelayMs,
      volume: input.quote.volume,
      bid: input.quote.bid,
      ask: input.quote.ask,
      source: input.quote.source,
      quotedAt: input.quote.quotedAt?.toISOString() ?? null,
    },
    technical: {
      vwap: vwapFromBars(bars1m),
      rsi: rsi(closes5m, 14),
      ema20: ema(closes5m, 20),
      rvol: rvolFromBars(bars1m),
      intradayHigh: highs.length ? Math.max(...highs) : null,
      intradayLow: lows.length ? Math.min(...lows) : null,
      lastClose1m: bars1m.length ? bars1m[bars1m.length - 1].close : null,
      bars1mCount: bars1m.length,
      bars5mCount: bars5m.length,
    },
    originalThesis: t.summary,
    marketContext: {
      niftyPrice: input.marketContext?.niftyPrice ?? null,
      niftyChangePct: input.marketContext?.niftyChangePct ?? null,
      bankNiftyChangePct: input.marketContext?.bankNiftyChangePct ?? null,
      indiaVix: input.marketContext?.indiaVix ?? null,
    },
  };
}

export function derivePhase(
  current: ManagementPhase | null,
  unrealizedPnl: number,
  currentStop: number,
  entryPrice: number,
  action?: 'PROTECT_PROFIT' | 'MOVE_STOP' | null,
): ManagementPhase {
  let phase = current ?? ManagementPhase.ENTRY;
  if (phase === ManagementPhase.ENTRY) {
    phase = ManagementPhase.ACTIVE;
  }
  if (unrealizedPnl > 0 && phase === ManagementPhase.ACTIVE) {
    phase = ManagementPhase.PROFITABLE;
  }
  if (
    currentStop >= entryPrice &&
    (phase === ManagementPhase.ACTIVE || phase === ManagementPhase.PROFITABLE)
  ) {
    phase = ManagementPhase.PROFIT_PROTECTION;
  }
  if (action === 'PROTECT_PROFIT' && phase !== ManagementPhase.TRAILING) {
    phase = ManagementPhase.PROFIT_PROTECTION;
  }
  if (
    action === 'MOVE_STOP' &&
    (phase === ManagementPhase.PROFIT_PROTECTION ||
      phase === ManagementPhase.PROFITABLE)
  ) {
    phase = ManagementPhase.TRAILING;
  }
  return phase;
}
