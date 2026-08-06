import type { DailyBar, PriceQuote } from '../yahoo.service';

/** Swappable market data plane (Yahoo today, paid API later). */
export interface MarketDataProvider {
  readonly name: string;
  getQuote(symbol: string): Promise<PriceQuote | null>;
  getQuotes(symbols: string[]): Promise<Map<string, PriceQuote>>;
  getDailyBars(symbol: string, lookbackDays?: number): Promise<DailyBar[]>;
  getIndexSnapshot(): Promise<Record<string, PriceQuote | null>>;
}

export const MARKET_DATA_PROVIDER = Symbol('MARKET_DATA_PROVIDER');
