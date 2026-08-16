import { Injectable } from '@nestjs/common';
import {
  LIVE_MARKET_DATA_PROVIDER,
  type LiveMarketDataProvider,
} from '../market/providers/market-data.provider';
import { YahooService, type PriceQuote } from '../market/yahoo.service';
import type { ExecutionQuote, IntradayBar } from './types';

export { LIVE_MARKET_DATA_PROVIDER };

@Injectable()
export class LiveMarketDataService implements LiveMarketDataProvider {
  readonly name = 'live-yahoo';

  constructor(private readonly yahoo: YahooService) {}

  getQuote(symbol: string) {
    return this.yahoo.getQuote(symbol);
  }

  getQuotes(symbols: string[]) {
    return this.yahoo.getQuotes(symbols);
  }

  getDailyBars(symbol: string, lookbackDays?: number) {
    return this.yahoo.getDailyBars(symbol, lookbackDays);
  }

  getIndexSnapshot() {
    return this.yahoo.getIndexSnapshot();
  }

  getIntradayBars(
    symbol: string,
    interval: '1m' | '5m',
    lookbackMinutes?: number,
  ): Promise<IntradayBar[]> {
    return this.yahoo.getIntradayBars(symbol, interval, lookbackMinutes);
  }

  async getExecutionQuote(
    symbol: string,
    now = new Date(),
  ): Promise<ExecutionQuote | null> {
    const quote = await this.yahoo.getQuote(symbol);
    return quote ? toExecutionQuote(quote, now, this.yahoo.name) : null;
  }

  async getExecutionQuotes(
    symbols: string[],
    now = new Date(),
  ): Promise<Map<string, ExecutionQuote>> {
    const raw = await this.yahoo.getQuotes(symbols);
    const out = new Map<string, ExecutionQuote>();
    for (const [symbol, quote] of raw) {
      out.set(symbol, toExecutionQuote(quote, now, this.yahoo.name));
    }
    return out;
  }

  async getExecutionIndexSnapshot(now = new Date()) {
    const raw = await this.yahoo.getIndexSnapshot();
    return {
      nifty: raw.nifty ? toExecutionQuote(raw.nifty, now, this.yahoo.name) : null,
      bankNifty: raw.bankNifty
        ? toExecutionQuote(raw.bankNifty, now, this.yahoo.name)
        : null,
      indiaVix: raw.indiaVix
        ? toExecutionQuote(raw.indiaVix, now, this.yahoo.name)
        : null,
    };
  }
}

/**
 * Maps a Yahoo (or future broker) PriceQuote into an execution quote.
 *
 * Yahoo is a delayed paper/test feed — NOT execution-grade live market data.
 *
 * - quotedAt: vendor last-trade time (`regularMarketTime`), often delayed for NSE
 * - receivedAt: when our process got the HTTP response
 * - fetchAgeMs: now - receivedAt (is THIS fetch stale in our process?)
 * - exchangeDelayMs: now - quotedAt (how old is the vendor print?)
 */
export function toExecutionQuote(
  quote: PriceQuote,
  now = new Date(),
  source = 'yahoo',
): ExecutionQuote {
  const receivedAt = quote.receivedAt ?? now;
  const quotedAt = quote.quotedAt ?? receivedAt;
  return {
    symbol: quote.symbol,
    price: quote.price,
    previousClose: quote.previousClose,
    changePercent: quote.changePercent,
    volume: quote.volume,
    open: quote.open,
    gapPercent: quote.gapPercent,
    bid: quote.bid ?? null,
    ask: quote.ask ?? null,
    quotedAt,
    receivedAt,
    fetchAgeMs: Math.max(0, now.getTime() - receivedAt.getTime()),
    exchangeDelayMs: Math.max(0, now.getTime() - quotedAt.getTime()),
    source,
  };
}
