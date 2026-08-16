import type { MarketEvent } from './types';

export type AiTrigger = 'INTERVAL' | 'EVENT';

export function eventKey(event: MarketEvent): string {
  return `${event.symbol}:${event.type}`;
}

export function newEventsSince(
  events: MarketEvent[],
  seenKeys: Set<string>,
): MarketEvent[] {
  return events.filter((event) => !seenKeys.has(eventKey(event)));
}

/**
 * When to run the portfolio AI cycle.
 * - First open-position review is immediate (lastAiAtMs null/0).
 * - Then every intervalMs (default 5 minutes).
 * - New events may trigger immediately, but the same lingering event
 *   does not retry until the interval (failed calls included).
 */
export function shouldRunAiCycle(input: {
  nowMs: number;
  lastAiAtMs: number | null;
  intervalMs: number;
  newEventCount: number;
  eventAiEnabled: boolean;
}): { run: boolean; triggeredBy: AiTrigger } {
  const neverRan = input.lastAiAtMs == null || input.lastAiAtMs === 0;
  if (neverRan) {
    return { run: true, triggeredBy: 'INTERVAL' };
  }
  if (input.nowMs - (input.lastAiAtMs ?? 0) >= input.intervalMs) {
    return { run: true, triggeredBy: 'INTERVAL' };
  }
  if (input.eventAiEnabled && input.newEventCount > 0) {
    return { run: true, triggeredBy: 'EVENT' };
  }
  return { run: false, triggeredBy: 'INTERVAL' };
}
