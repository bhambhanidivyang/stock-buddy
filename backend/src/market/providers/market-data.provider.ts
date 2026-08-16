import type { DailyBar, IntradayBar, PriceQuote } from '../yahoo.service';

/** Research plane — historical + delayed quotes are acceptable. */
export interface MarketDataProvider {
  readonly name: string;
  getQuote(symbol: string): Promise<PriceQuote | null>;
  getQuotes(symbols: string[]): Promise<Map<string, PriceQuote>>;
  getDailyBars(symbol: string, lookbackDays?: number): Promise<DailyBar[]>;
  getIndexSnapshot(): Promise<Record<string, PriceQuote | null>>;
}

export const MARKET_DATA_PROVIDER = Symbol('MARKET_DATA_PROVIDER');

/** Execution plane — freshness and intraday bars matter. */
export interface LiveMarketDataProvider extends MarketDataProvider {
  getIntradayBars(
    symbol: string,
    interval: '1m' | '5m',
    lookbackMinutes?: number,
  ): Promise<IntradayBar[]>;
}

export const LIVE_MARKET_DATA_PROVIDER = Symbol('LIVE_MARKET_DATA_PROVIDER');
