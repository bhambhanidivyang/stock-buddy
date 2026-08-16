import type {
  LiveConfig,
  MarketEvent,
  PositionSnapshot,
} from './types';

/**
 * Detects configured market/position events.
 * Thresholds that are null are skipped — no invented defaults.
 */
export function detectMarketEvents(
  snapshot: PositionSnapshot,
  config: LiveConfig,
  previous?: PositionSnapshot | null,
): MarketEvent[] {
  const events: MarketEvent[] = [];
  const { symbol } = snapshot;
  const entry = snapshot.entryPrice;
  const stop = snapshot.currentStop;
  const target = snapshot.currentTarget;
  const ltp = snapshot.currentLtp;

  if (config.nearStopPct != null && entry > stop) {
    const risk = entry - stop;
    const remaining = ltp - stop;
    const remainingPct = remaining / risk;
    if (remainingPct <= config.nearStopPct && remainingPct >= 0) {
      events.push({
        type: 'PRICE_NEAR_STOP',
        symbol,
        message: `Price is within ${config.nearStopPct} of stop distance`,
        value: remainingPct,
        threshold: config.nearStopPct,
      });
    }
  }

  if (config.nearTargetPct != null && target > entry) {
    const reward = target - entry;
    const remaining = target - ltp;
    const remainingPct = remaining / reward;
    if (remainingPct <= config.nearTargetPct && remainingPct >= 0) {
      events.push({
        type: 'PRICE_NEAR_TARGET',
        symbol,
        message: `Price is within ${config.nearTargetPct} of target distance`,
        value: remainingPct,
        threshold: config.nearTargetPct,
      });
    }
  }

  if (config.largePriceMovePct != null && previous) {
    const movePct =
      previous.currentLtp > 0
        ? Math.abs(ltp - previous.currentLtp) / previous.currentLtp
        : 0;
    if (movePct >= config.largePriceMovePct) {
      events.push({
        type: 'LARGE_PRICE_MOVE',
        symbol,
        message: `Price moved ${movePct} vs prior snapshot`,
        value: movePct,
        threshold: config.largePriceMovePct,
      });
    }
  }

  if (
    config.volumeSpikeMultiple != null &&
    snapshot.technical.rvol != null &&
    snapshot.technical.rvol >= config.volumeSpikeMultiple
  ) {
    events.push({
      type: 'VOLUME_SPIKE',
      symbol,
      message: `Intraday RVOL ${snapshot.technical.rvol}`,
      value: snapshot.technical.rvol,
      threshold: config.volumeSpikeMultiple,
    });
  }

  if (
    config.vwapBreakPct != null &&
    snapshot.technical.vwap != null &&
    snapshot.technical.vwap > 0
  ) {
    const vsVwap = (ltp - snapshot.technical.vwap) / snapshot.technical.vwap;
    if (vsVwap <= -config.vwapBreakPct) {
      events.push({
        type: 'VWAP_BREAK',
        symbol,
        message: `LTP ${vsVwap} below VWAP`,
        value: vsVwap,
        threshold: config.vwapBreakPct,
      });
    }
  }

  if (
    config.momentumEventsEnabled &&
    snapshot.technical.rsi != null &&
    previous?.technical.rsi != null &&
    previous.technical.rsi >= 50 &&
    snapshot.technical.rsi < 50 &&
    ltp < entry
  ) {
    events.push({
      type: 'MOMENTUM_REVERSAL',
      symbol,
      message: `RSI crossed below 50 while below entry`,
      value: snapshot.technical.rsi,
      threshold: 50,
    });
  }

  if (
    config.structureEventsEnabled &&
    snapshot.technical.intradayHigh != null &&
    snapshot.highWaterMark != null &&
    snapshot.technical.intradayHigh >= snapshot.highWaterMark &&
    previous &&
    previous.highWaterMark != null &&
    snapshot.highWaterMark > previous.highWaterMark
  ) {
    events.push({
      type: 'NEW_INTRADAY_HIGH',
      symbol,
      message: 'New high-water mark',
      value: snapshot.highWaterMark,
      threshold: null,
    });
  }

  if (
    config.structureEventsEnabled &&
    snapshot.technical.intradayLow != null &&
    previous?.technical.intradayLow != null &&
    snapshot.technical.intradayLow < previous.technical.intradayLow
  ) {
    events.push({
      type: 'NEW_INTRADAY_LOW',
      symbol,
      message: 'New intraday low',
      value: snapshot.technical.intradayLow,
      threshold: null,
    });
  }

  if (
    config.marketMovePct != null &&
    snapshot.marketContext.niftyChangePct != null &&
    Math.abs(snapshot.marketContext.niftyChangePct) >=
      config.marketMovePct * 100
  ) {
    events.push({
      type: 'MARKET_MOVE',
      symbol,
      message: `Nifty change ${snapshot.marketContext.niftyChangePct}%`,
      value: snapshot.marketContext.niftyChangePct,
      threshold: config.marketMovePct,
    });
  }

  if (
    config.pnlThresholdPct != null &&
    Math.abs(snapshot.currentPnlPct) >= config.pnlThresholdPct * 100
  ) {
    events.push({
      type: 'P_AND_L_THRESHOLD',
      symbol,
      message: `Unrealized P&L ${snapshot.currentPnlPct}%`,
      value: snapshot.currentPnlPct,
      threshold: config.pnlThresholdPct,
    });
  }

  if (
    config.staleTradeMs != null &&
    snapshot.timeSinceEntryMs >= config.staleTradeMs &&
    snapshot.currentPnlPct <= 0
  ) {
    events.push({
      type: 'STALE_TRADE',
      symbol,
      message: 'Position has not progressed within configured stale window',
      value: snapshot.timeSinceEntryMs,
      threshold: config.staleTradeMs,
    });
  }

  return events;
}
