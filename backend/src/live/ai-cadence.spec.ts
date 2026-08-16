import { shouldRunAiCycle, newEventsSince, eventKey } from './ai-cadence';
import { loadLiveConfig } from './live.config';
import type { MarketEvent } from './types';

describe('AI monitoring cadence', () => {
  const interval = 300_000;
  const prevInterval = process.env.LIVE_AI_INTERVAL_MS;

  afterEach(() => {
    if (prevInterval == null) {
      delete process.env.LIVE_AI_INTERVAL_MS;
    } else {
      process.env.LIVE_AI_INTERVAL_MS = prevInterval;
    }
  });

  it('defaults LIVE_AI_INTERVAL_MS to 5 minutes when unset', () => {
    const prev = process.env.LIVE_AI_INTERVAL_MS;
    delete process.env.LIVE_AI_INTERVAL_MS;
    expect(loadLiveConfig().aiIntervalMs).toBe(300_000);
    if (prev != null) {
      process.env.LIVE_AI_INTERVAL_MS = prev;
    }
  });

  it('runs the first review immediately after a position is opened', () => {
    const result = shouldRunAiCycle({
      nowMs: 1_000,
      lastAiAtMs: null,
      intervalMs: interval,
      newEventCount: 0,
      eventAiEnabled: true,
    });
    expect(result).toEqual({ run: true, triggeredBy: 'INTERVAL' });
  });

  it('does not re-run before the interval when there are no new events', () => {
    const result = shouldRunAiCycle({
      nowMs: 60_000,
      lastAiAtMs: 1_000,
      intervalMs: interval,
      newEventCount: 0,
      eventAiEnabled: true,
    });
    expect(result.run).toBe(false);
  });

  it('runs again after LIVE_AI_INTERVAL_MS', () => {
    const result = shouldRunAiCycle({
      nowMs: 1_000 + interval,
      lastAiAtMs: 1_000,
      intervalMs: interval,
      newEventCount: 0,
      eventAiEnabled: true,
    });
    expect(result).toEqual({ run: true, triggeredBy: 'INTERVAL' });
  });

  it('does not rapid-retry after a failed call (lastAiAt advanced, same events)', () => {
    const afterFail = shouldRunAiCycle({
      nowMs: 5_000,
      lastAiAtMs: 4_000,
      intervalMs: interval,
      newEventCount: 0,
      eventAiEnabled: true,
    });
    expect(afterFail.run).toBe(false);
  });

  it('allows an event-triggered review for NEW events before the interval', () => {
    const result = shouldRunAiCycle({
      nowMs: 30_000,
      lastAiAtMs: 1_000,
      intervalMs: interval,
      newEventCount: 1,
      eventAiEnabled: true,
    });
    expect(result).toEqual({ run: true, triggeredBy: 'EVENT' });
  });

  it('does not treat a lingering event as new (no duplicate rapid retries)', () => {
    const events: MarketEvent[] = [
      {
        type: 'PRICE_NEAR_STOP',
        symbol: 'COFORGE',
        message: 'near',
        value: 0.1,
        threshold: 0.2,
      },
    ];
    const seen = new Set(events.map(eventKey));
    expect(newEventsSince(events, seen)).toEqual([]);
  });
});
