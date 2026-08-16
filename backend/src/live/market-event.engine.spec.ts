import { ManagementPhase } from '../database/enums';
import { detectMarketEvents } from './market-event.engine';
import { buildPositionSnapshot } from './position-snapshot';
import type { ExecutionQuote, LiveConfig, PositionSnapshot } from './types';

function config(partial: Partial<LiveConfig> = {}): LiveConfig {
  return {
    mgmtEnabled: true,
    aiIntervalMs: 300000,
    eventAiEnabled: true,
    quoteMaxAgeMs: 30000,
    quoteMaxExchangeDelayMs: 1200000,
    nearStopPct: null,
    nearTargetPct: null,
    largePriceMovePct: null,
    volumeSpikeMultiple: null,
    vwapBreakPct: null,
    pnlThresholdPct: null,
    staleTradeMs: null,
    marketMovePct: null,
    structureEventsEnabled: false,
    momentumEventsEnabled: false,
    partialProfitEnabled: false,
    ...partial,
  };
}

function quote(): ExecutionQuote {
  const now = new Date();
  return {
    symbol: 'COFORGE',
    price: 1770,
    previousClose: 1800,
    changePercent: -1.6,
    volume: 1,
    open: 1800,
    gapPercent: 0,
    bid: null,
    ask: null,
    quotedAt: now,
    receivedAt: now,
    fetchAgeMs: 0,
    exchangeDelayMs: 0,
    source: 'yahoo',
  };
}

describe('detectMarketEvents', () => {
  const snap = buildPositionSnapshot({
    trade: {
      id: 't1',
      symbol: 'COFORGE',
      qty: 10,
      status: 'OPEN',
      managementPhase: ManagementPhase.ACTIVE,
      buyPrice: 1819,
      buyAt: new Date(Date.now() - 60_000),
      buyLow: 1808,
      buyHigh: 1834,
      stopLoss: 1762,
      sellTarget: 1994,
      initialStop: 1762,
      originalTarget: 1994,
      highWaterMark: 1820,
      maxUnrealizedPct: 0.05,
      summary: 'thesis',
    },
    quote: quote(),
  });

  it('emits nothing when all policy thresholds are unset', () => {
    expect(detectMarketEvents(snap, config())).toEqual([]);
  });

  it('emits PRICE_NEAR_STOP only when that threshold is configured', () => {
    const events = detectMarketEvents(snap, config({ nearStopPct: 0.2 }));
    expect(events.map((e) => e.type)).toContain('PRICE_NEAR_STOP');
  });

  it('can emit each configured event type without inventing default thresholds', () => {
    const nearStop = detectMarketEvents(snap, config({ nearStopPct: 0.2 }));
    expect(nearStop.map((e) => e.type)).toContain('PRICE_NEAR_STOP');

    const nearTargetSnap = {
      ...snap,
      currentLtp: 1980,
      currentTarget: 1994,
      entryPrice: 1819,
      currentPnlPct: 8.8,
      timeSinceEntryMs: 60_000,
      technical: { ...snap.technical, rvol: 4, vwap: 2100 },
      marketContext: {
        ...snap.marketContext,
        niftyChangePct: -0.5,
      },
    };
    const prev = { ...snap, currentLtp: 1819, technical: { ...snap.technical, rsi: 55 } };
    const nearTargetEvents = detectMarketEvents(
      nearTargetSnap,
      config({
        nearTargetPct: 0.2,
        largePriceMovePct: 0.01,
        volumeSpikeMultiple: 2,
        vwapBreakPct: 0.01,
        pnlThresholdPct: 0.02,
        marketMovePct: 0.001,
      }),
      prev,
    ).map((e) => e.type);
    expect(nearTargetEvents).toEqual(
      expect.arrayContaining([
        'PRICE_NEAR_TARGET',
        'LARGE_PRICE_MOVE',
        'VOLUME_SPIKE',
        'VWAP_BREAK',
        'P_AND_L_THRESHOLD',
        'MARKET_MOVE',
      ]),
    );

    const staleBelow = {
      ...snap,
      currentLtp: 1800,
      currentPnlPct: -1,
      timeSinceEntryMs: 5_000,
      technical: { ...snap.technical, rsi: 40 },
    };
    const staleEvents = detectMarketEvents(
      staleBelow,
      config({ staleTradeMs: 1_000, momentumEventsEnabled: true }),
      { ...snap, technical: { ...snap.technical, rsi: 55 } },
    ).map((e) => e.type);
    expect(staleEvents).toEqual(
      expect.arrayContaining(['STALE_TRADE', 'MOMENTUM_REVERSAL']),
    );
  });

  it('does not emit SECTOR_MOVE — snapshot has no sector series yet', () => {
    const events = detectMarketEvents(snap, config({
      nearStopPct: 0.2,
      marketMovePct: 0.0001,
    }));
    expect(events.map((e) => e.type)).not.toContain('SECTOR_MOVE');
  });
});

describe('buildPositionSnapshot', () => {
  it('computes P&L and distances from live LTP vs original thesis levels', () => {
    const snap: PositionSnapshot = buildPositionSnapshot({
      trade: {
        id: 't1',
        symbol: 'COFORGE',
        qty: 10,
        status: 'OPEN',
        managementPhase: ManagementPhase.ACTIVE,
        buyPrice: 100,
        buyAt: new Date(),
        buyLow: 98,
        buyHigh: 102,
        stopLoss: 90,
        sellTarget: 120,
        initialStop: 90,
        originalTarget: 120,
        highWaterMark: 110,
        maxUnrealizedPct: 10,
        summary: 'original thesis',
      },
      quote: { ...quote(), price: 110 },
    });
    expect(snap.currentPnl).toBe(100);
    expect(snap.originalThesis).toBe('original thesis');
    expect(snap.mfePct).toBe(10);
    expect(snap.currentLtp).toBe(110);
  });
});
