import { TradeStatus } from '../database/enums';
import { loadLiveConfig } from './live.config';
import { isQuoteFresh, validateBuy, validateSell } from './order-safety.validator';
import type { ExecutionQuote } from './types';

function quote(partial: Partial<ExecutionQuote> = {}): ExecutionQuote {
  const now = new Date();
  return {
    symbol: 'COFORGE',
    price: 1820,
    previousClose: 1800,
    changePercent: 1.1,
    volume: 100000,
    open: 1805,
    gapPercent: 0.3,
    bid: 1819,
    ask: 1821,
    quotedAt: new Date(now.getTime() - 5_000),
    receivedAt: now,
    fetchAgeMs: 0,
    exchangeDelayMs: 5_000,
    source: 'yahoo',
    ...partial,
  };
}

describe('order-safety.validator', () => {
  const config = loadLiveConfig();

  it('blocks buy when quote fetch is stale', () => {
    const result = validateBuy(
      {
        symbol: 'COFORGE',
        qty: 10,
        buyLow: 1800,
        buyHigh: 1830,
        quote: quote({ fetchAgeMs: config.quoteMaxAgeMs + 1 }),
        availableCash: 1_000_000,
        marketOpen: true,
        alreadyOpenQty: 0,
      },
      config,
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('QUOTE_FETCH_STALE');
  });

  it('blocks buy when LTP is outside the morning entry band', () => {
    const result = validateBuy(
      {
        symbol: 'COFORGE',
        qty: 10,
        buyLow: 1800,
        buyHigh: 1810,
        quote: quote({ price: 1850 }),
        availableCash: 1_000_000,
        marketOpen: true,
        alreadyOpenQty: 0,
      },
      config,
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('OUTSIDE_ENTRY_BAND');
  });

  it('allows buy when market is open, quote is fresh, and LTP is in band', () => {
    const result = validateBuy(
      {
        symbol: 'COFORGE',
        qty: 10,
        buyLow: 1800,
        buyHigh: 1834,
        quote: quote(),
        availableCash: 1_000_000,
        marketOpen: true,
        alreadyOpenQty: 0,
      },
      config,
    );
    expect(result.ok).toBe(true);
  });

  it('blocks sell when market is closed', () => {
    const result = validateSell(
      {
        symbol: 'COFORGE',
        requestedQty: 10,
        heldQty: 10,
        status: TradeStatus.OPEN,
        quote: quote(),
        marketOpen: false,
      },
      config,
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('MARKET_CLOSED');
  });

  it('blocks sell when requested qty exceeds held', () => {
    const result = validateSell(
      {
        symbol: 'COFORGE',
        requestedQty: 11,
        heldQty: 10,
        status: TradeStatus.OPEN,
        quote: quote(),
        marketOpen: true,
      },
      config,
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('QTY_EXCEEDS_HELD');
  });

  it('blocks sell when live quote fetch is stale', () => {
    const result = validateSell(
      {
        symbol: 'COFORGE',
        requestedQty: 10,
        heldQty: 10,
        status: TradeStatus.OPEN,
        quote: quote({ fetchAgeMs: config.quoteMaxAgeMs + 1 }),
        marketOpen: true,
      },
      config,
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('QUOTE_FETCH_STALE');
  });

  it('blocks sell when the position no longer exists', () => {
    const result = validateSell(
      {
        symbol: 'COFORGE',
        requestedQty: 10,
        heldQty: 10,
        status: TradeStatus.CLOSED,
        quote: quote(),
        marketOpen: true,
      },
      config,
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NO_POSITION');
  });

  it('treats missing exchange timestamp as inferred-from-received and still fresh if fetch is new', () => {
    const q = quote({ quotedAt: new Date(), exchangeDelayMs: 0 });
    expect(isQuoteFresh(q, config).ok).toBe(true);
  });
});
