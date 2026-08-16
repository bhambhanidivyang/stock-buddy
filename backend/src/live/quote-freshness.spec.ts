import { toExecutionQuote } from './live-market-data.service';
import { isQuoteFresh } from './order-safety.validator';
import { loadLiveConfig } from './live.config';
import type { PriceQuote } from '../market/yahoo.service';

function yahooQuote(partial: Partial<PriceQuote> = {}): PriceQuote {
  const receivedAt = new Date('2026-08-14T04:00:00.000Z');
  return {
    symbol: 'COFORGE',
    price: 1870,
    previousClose: 1819,
    changePercent: 2.8,
    volume: 1,
    open: 1820,
    gapPercent: 0.05,
    bid: 1869,
    ask: 1871,
    quotedAt: new Date('2026-08-14T03:59:50.000Z'),
    receivedAt,
    ...partial,
  };
}

describe('Yahoo paper-feed freshness (NOT execution-grade)', () => {
  const config = {
    ...loadLiveConfig(),
    quoteMaxAgeMs: 30_000,
    quoteMaxExchangeDelayMs: 1_200_000,
  };

  it('computes fetchAgeMs from receivedAt vs now (our HTTP response time)', () => {
    const now = new Date('2026-08-14T04:00:10.000Z');
    const q = toExecutionQuote(yahooQuote(), now, 'yahoo');
    expect(q.receivedAt.toISOString()).toBe('2026-08-14T04:00:00.000Z');
    expect(q.fetchAgeMs).toBe(10_000);
    expect(q.source).toBe('yahoo');
  });

  it('computes exchangeDelayMs from Yahoo regularMarketTime (quotedAt) vs now', () => {
    const now = new Date('2026-08-14T04:00:10.000Z');
    const q = toExecutionQuote(yahooQuote(), now, 'yahoo');
    expect(q.quotedAt?.toISOString()).toBe('2026-08-14T03:59:50.000Z');
    expect(q.exchangeDelayMs).toBe(20_000);
  });

  it('blocks when fetch age exceeds 30 seconds', () => {
    const now = new Date('2026-08-14T04:00:31.000Z');
    const q = toExecutionQuote(yahooQuote(), now, 'yahoo');
    expect(q.fetchAgeMs).toBe(31_000);
    expect(isQuoteFresh(q, config).ok).toBe(false);
    expect(isQuoteFresh(q, config).code).toBe('QUOTE_FETCH_STALE');
  });

  it('allows a just-fetched quote even if Yahoo last-trade time is delayed (under 20 min)', () => {
    const receivedAt = new Date('2026-08-14T04:00:00.000Z');
    const quotedAt = new Date('2026-08-14T03:45:00.000Z'); // 15 min delay
    const q = toExecutionQuote(
      yahooQuote({ receivedAt, quotedAt }),
      receivedAt,
      'yahoo',
    );
    expect(q.fetchAgeMs).toBe(0);
    expect(q.exchangeDelayMs).toBe(15 * 60_000);
    expect(isQuoteFresh(q, config).ok).toBe(true);
  });

  it('blocks when Yahoo last-trade time is older than 20 minutes', () => {
    const receivedAt = new Date('2026-08-14T04:00:00.000Z');
    const quotedAt = new Date('2026-08-14T03:39:00.000Z'); // 21 min
    const q = toExecutionQuote(
      yahooQuote({ receivedAt, quotedAt }),
      receivedAt,
      'yahoo',
    );
    expect(q.exchangeDelayMs).toBe(21 * 60_000);
    expect(isQuoteFresh(q, config).ok).toBe(false);
    expect(isQuoteFresh(q, config).code).toBe('QUOTE_EXCHANGE_STALE');
  });
});
