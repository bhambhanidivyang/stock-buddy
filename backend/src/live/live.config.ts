import type { LiveConfig } from './types';

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw == null || raw === '') {
    return fallback;
  }
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (raw == null || raw === '') {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Empty / 0 / invalid → disabled (null). Policy knobs stay off until backtested. */
export function envOptionalRatio(key: string): number | null {
  const raw = process.env[key]?.trim();
  if (raw == null || raw === '') {
    return null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return n;
}

export function loadLiveConfig(): LiveConfig {
  return {
    mgmtEnabled: envBool('LIVE_MGMT_ENABLED', true),
    aiIntervalMs: envInt('LIVE_AI_INTERVAL_MS', 300_000),
    eventAiEnabled: envBool('LIVE_EVENT_AI_ENABLED', true),
    quoteMaxAgeMs: envInt('LIVE_QUOTE_MAX_AGE_MS', 30_000),
    quoteMaxExchangeDelayMs: envInt(
      'LIVE_QUOTE_MAX_EXCHANGE_DELAY_MS',
      1_200_000,
    ),
    nearStopPct: envOptionalRatio('LIVE_EVENT_NEAR_STOP_PCT'),
    nearTargetPct: envOptionalRatio('LIVE_EVENT_NEAR_TARGET_PCT'),
    largePriceMovePct: envOptionalRatio('LIVE_EVENT_LARGE_PRICE_MOVE_PCT'),
    volumeSpikeMultiple: envOptionalRatio('LIVE_EVENT_VOLUME_SPIKE_MULT'),
    vwapBreakPct: envOptionalRatio('LIVE_EVENT_VWAP_BREAK_PCT'),
    pnlThresholdPct: envOptionalRatio('LIVE_EVENT_PNL_PCT'),
    staleTradeMs: envOptionalRatio('LIVE_EVENT_STALE_TRADE_MS'),
    marketMovePct: envOptionalRatio('LIVE_EVENT_MARKET_MOVE_PCT'),
    structureEventsEnabled: envBool('LIVE_EVENT_STRUCTURE_ENABLED', false),
    momentumEventsEnabled: envBool('LIVE_EVENT_MOMENTUM_ENABLED', false),
    partialProfitEnabled: envBool('LIVE_PARTIAL_PROFIT_ENABLED', false),
  };
}
