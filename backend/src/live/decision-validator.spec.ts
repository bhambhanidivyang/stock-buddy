import { ManagementPhase } from '../database/enums';
import { validateAiDecision } from './decision-validator';
import { loadLiveConfig } from './live.config';
import { derivePhase } from './position-snapshot';
import type { AiPositionDecision, PositionSnapshot } from './types';

function snapshot(partial: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    tradeId: 't1',
    symbol: 'COFORGE',
    qty: 10,
    status: 'OPEN',
    managementPhase: ManagementPhase.ACTIVE,
    entryPrice: 1819,
    currentLtp: 1850,
    currentPnl: 310,
    currentPnlPct: 1.7,
    positionValue: 18500,
    timeSinceEntryMs: 3_600_000,
    originalEntryLow: 1808,
    originalEntryHigh: 1834,
    originalStop: 1762,
    originalTarget: 1994,
    currentStop: 1762,
    currentTarget: 1994,
    highWaterMark: 1860,
    maxUnrealizedPct: 2.2,
    mfePct: 2.2,
    distanceToStopPct: 150,
    distanceToTargetPct: 80,
    distanceFromEntryPct: 1.7,
    quote: {
      fetchAgeMs: 0,
      exchangeDelayMs: 1000,
      volume: 1,
      bid: 1849,
      ask: 1851,
      source: 'yahoo',
      quotedAt: new Date().toISOString(),
    },
    technical: {
      vwap: 1840,
      rsi: 48,
      ema20: 1830,
      rvol: 1.1,
      intradayHigh: 1860,
      intradayLow: 1810,
      lastClose1m: 1850,
      bars1mCount: 30,
      bars5mCount: 20,
    },
    originalThesis: 'BUYABLE pullback/PDH setup. Trend UP.',
    marketContext: {
      niftyPrice: 25000,
      niftyChangePct: -0.2,
      bankNiftyChangePct: -0.1,
      indiaVix: 12,
    },
    ...partial,
  };
}

function decision(
  partial: Partial<AiPositionDecision> = {},
): AiPositionDecision {
  return {
    symbol: 'COFORGE',
    action: 'HOLD',
    confidence: 0.8,
    reason: 'thesis intact',
    suggestedStop: null,
    suggestedExitPrice: null,
    ...partial,
  };
}

describe('validateAiDecision', () => {
  const config = loadLiveConfig();

  it('allows HOLD without an order', () => {
    const v = validateAiDecision(decision(), snapshot(), config);
    expect(v.allow).toBe(true);
    expect(v.executeExit).toBe(false);
  });

  it('allows EXIT_NOW at an intermediate price — does not wait for target or hard stop', () => {
    const v = validateAiDecision(
      decision({
        action: 'EXIT_NOW',
        reason: 'momentum deteriorating, thesis no longer valid',
      }),
      snapshot({
        entryPrice: 1819,
        originalTarget: 1994,
        currentTarget: 1994,
        originalStop: 1762,
        currentStop: 1762,
        currentLtp: 1870,
        currentPnl: (1870 - 1819) * 10,
        currentPnlPct: ((1870 - 1819) / 1819) * 100,
      }),
      config,
    );
    expect(v.allow).toBe(true);
    expect(v.executeExit).toBe(true);
    expect(v.applyStop).toBe(false);
  });

  it('blocks MOVE_STOP that lowers the stop', () => {
    const v = validateAiDecision(
      decision({ action: 'MOVE_STOP', suggestedStop: 1700 }),
      snapshot(),
      config,
    );
    expect(v.allow).toBe(false);
    expect(v.applyStop).toBe(false);
  });

  it('blocks MOVE_STOP at or above LTP', () => {
    const v = validateAiDecision(
      decision({ action: 'MOVE_STOP', suggestedStop: 1850 }),
      snapshot(),
      config,
    );
    expect(v.allow).toBe(false);
  });

  it('allows MOVE_STOP that raises stop below LTP', () => {
    const v = validateAiDecision(
      decision({ action: 'MOVE_STOP', suggestedStop: 1819 }),
      snapshot(),
      config,
    );
    expect(v.allow).toBe(true);
    expect(v.applyStop).toBe(true);
    expect(v.effectiveStop).toBe(1819);
  });

  it('blocks TAKE_PARTIAL_PROFIT until a quantity policy is configured', () => {
    const v = validateAiDecision(
      decision({ action: 'TAKE_PARTIAL_PROFIT' }),
      snapshot(),
      config,
    );
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/partial/i);
  });

  it('PROTECT_PROFIT without suggestedStop raises to breakeven when profitable', () => {
    const v = validateAiDecision(
      decision({ action: 'PROTECT_PROFIT' }),
      snapshot(),
      config,
    );
    expect(v.allow).toBe(true);
    expect(v.applyStop).toBe(true);
    expect(v.effectiveStop).toBe(1819);
  });

  it('PROTECT_PROFIT is blocked when the position is not profitable', () => {
    const v = validateAiDecision(
      decision({ action: 'PROTECT_PROFIT' }),
      snapshot({ currentLtp: 1800, currentPnl: -190, currentPnlPct: -1 }),
      config,
    );
    expect(v.allow).toBe(false);
    expect(v.applyStop).toBe(false);
  });

  it('PROTECT_PROFIT is blocked when breakeven would be at/above LTP', () => {
    const v = validateAiDecision(
      decision({ action: 'PROTECT_PROFIT' }),
      snapshot({
        entryPrice: 1819,
        currentStop: 1762,
        currentLtp: 1810,
        currentPnl: 10,
      }),
      config,
    );
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/EXIT_NOW/i);
  });

  it('PROTECT_PROFIT is phase-only when stop is already at/above breakeven', () => {
    const v = validateAiDecision(
      decision({ action: 'PROTECT_PROFIT' }),
      snapshot({ currentStop: 1819, currentLtp: 1850, currentPnl: 310 }),
      config,
    );
    expect(v.allow).toBe(true);
    expect(v.applyStop).toBe(false);
    expect(v.executeExit).toBe(false);
  });
});

describe('derivePhase', () => {
  it('advances ENTRY → ACTIVE → PROFITABLE on unrealized profit', () => {
    expect(derivePhase(null, 0, 1762, 1819)).toBe(ManagementPhase.ACTIVE);
    expect(derivePhase(ManagementPhase.ACTIVE, 10, 1762, 1819)).toBe(
      ManagementPhase.PROFITABLE,
    );
  });

  it('marks PROFIT_PROTECTION when stop is at/above entry', () => {
    expect(
      derivePhase(ManagementPhase.PROFITABLE, 10, 1819, 1819),
    ).toBe(ManagementPhase.PROFIT_PROTECTION);
  });
});
