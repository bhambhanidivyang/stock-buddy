import { loadLiveConfig } from './live.config';

describe('live event thresholds stay off until explicitly configured', () => {
  const prev: Record<string, string | undefined> = {};
  const keys = [
    'LIVE_EVENT_NEAR_STOP_PCT',
    'LIVE_EVENT_NEAR_TARGET_PCT',
    'LIVE_EVENT_LARGE_PRICE_MOVE_PCT',
    'LIVE_EVENT_VOLUME_SPIKE_MULT',
    'LIVE_EVENT_VWAP_BREAK_PCT',
    'LIVE_EVENT_PNL_PCT',
    'LIVE_EVENT_STALE_TRADE_MS',
    'LIVE_EVENT_MARKET_MOVE_PCT',
    'LIVE_EVENT_STRUCTURE_ENABLED',
    'LIVE_EVENT_MOMENTUM_ENABLED',
    'LIVE_PARTIAL_PROFIT_ENABLED',
  ];

  beforeEach(() => {
    for (const key of keys) {
      prev[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      if (prev[key] == null) {
        delete process.env[key];
      } else {
        process.env[key] = prev[key];
      }
    }
  });

  it('leaves all event ratios null and structure/momentum/partial off', () => {
    const config = loadLiveConfig();
    expect(config.nearStopPct).toBeNull();
    expect(config.nearTargetPct).toBeNull();
    expect(config.largePriceMovePct).toBeNull();
    expect(config.volumeSpikeMultiple).toBeNull();
    expect(config.vwapBreakPct).toBeNull();
    expect(config.pnlThresholdPct).toBeNull();
    expect(config.staleTradeMs).toBeNull();
    expect(config.marketMovePct).toBeNull();
    expect(config.structureEventsEnabled).toBe(false);
    expect(config.momentumEventsEnabled).toBe(false);
    expect(config.partialProfitEnabled).toBe(false);
  });
});
