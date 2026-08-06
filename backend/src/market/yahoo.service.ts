import { Injectable, Logger } from '@nestjs/common';
import YahooFinance from 'yahoo-finance2';
import { istDateKey } from './market-clock';
import { toYahooSymbol } from './symbols';

export interface PriceQuote {
  symbol: string;
  price: number;
  previousClose: number | null;
  changePercent: number | null;
  volume: number | null;
  open: number | null;
  gapPercent: number | null;
}

export type DailyBar = {
  close: number;
  high: number;
  low: number;
  volume: number;
};

export type YahooFundamentals = {
  marketCap: number | null;
  pe: number | null;
  pb: number | null;
  dividendYield: number | null;
  debtToEquity: number | null;
};

/** Sector + fundamentals from one quoteSummary (deep shortlist only). */
export type YahooEnrichment = {
  sector: string | null;
  industry: string | null;
  companyName: string | null;
  fundamentals: YahooFundamentals;
};

/** Data retrieval only — no indicator math. Implements MarketDataProvider. */
const EMPTY_FUNDAMENTALS: YahooFundamentals = {
  marketCap: null,
  pe: null,
  pb: null,
  dividendYield: null,
  debtToEquity: null,
};

@Injectable()
export class YahooService {
  readonly name = 'yahoo';
  private readonly logger = new Logger(YahooService.name);
  private readonly yahoo = new YahooFinance({
    validation: { logErrors: false },
    suppressNotices: ['ripHistorical', 'yahooSurvey'],
  });
  /** IST-day cache: symbol → enrichment */
  private readonly enrichmentCache = new Map<
    string,
    { day: string; value: YahooEnrichment }
  >();

  async getQuote(symbol: string): Promise<PriceQuote | null> {
    const yahooSymbol = toYahooSymbol(symbol);
    try {
      const quote = await this.yahoo.quote(yahooSymbol);
      const price =
        typeof quote.regularMarketPrice === 'number'
          ? quote.regularMarketPrice
          : typeof quote.postMarketPrice === 'number'
            ? quote.postMarketPrice
            : null;
      if (price == null) {
        return null;
      }

      const previousClose =
        typeof quote.regularMarketPreviousClose === 'number'
          ? quote.regularMarketPreviousClose
          : null;
      const open =
        typeof quote.regularMarketOpen === 'number'
          ? quote.regularMarketOpen
          : null;
      const changePercent =
        typeof quote.regularMarketChangePercent === 'number'
          ? quote.regularMarketChangePercent
          : previousClose
            ? ((price - previousClose) / previousClose) * 100
            : null;
      const volume =
        typeof quote.regularMarketVolume === 'number'
          ? quote.regularMarketVolume
          : null;
      const gapPercent =
        open != null && previousClose
          ? ((open - previousClose) / previousClose) * 100
          : null;

      return {
        symbol: symbol.replace(/\.NS$/i, '').toUpperCase(),
        price,
        previousClose,
        changePercent,
        volume,
        open,
        gapPercent,
      };
    } catch (error) {
      this.logger.warn(
        `Quote failed for ${yahooSymbol}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async getQuotes(symbols: string[]): Promise<Map<string, PriceQuote>> {
    const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
    const map = new Map<string, PriceQuote>();
    // Bound concurrency for large NSE liquid sets
    const concurrency = 12;
    let index = 0;
    async function worker(this: YahooService) {
      while (index < unique.length) {
        const i = index;
        index += 1;
        const symbol = unique[i];
        const quote = await this.getQuote(symbol);
        if (quote) {
          map.set(symbol, quote);
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, unique.length) }, () =>
        worker.call(this),
      ),
    );
    return map;
  }

  async getIndexSnapshot(): Promise<Record<string, PriceQuote | null>> {
    const [nifty, bankNifty, vix] = await Promise.all([
      this.getQuote('^NSEI'),
      this.getQuote('^NSEBANK'),
      this.getQuote('^INDIAVIX'),
    ]);
    return {
      nifty: nifty ? { ...nifty, symbol: 'NIFTY' } : null,
      bankNifty: bankNifty ? { ...bankNifty, symbol: 'BANKNIFTY' } : null,
      indiaVix: vix ? { ...vix, symbol: 'INDIAVIX' } : null,
    };
  }

  async getDailyBars(symbol: string, lookbackDays = 320): Promise<DailyBar[]> {
    const yahooSymbol = toYahooSymbol(symbol);
    const period1 = new Date();
    period1.setUTCDate(period1.getUTCDate() - lookbackDays);
    try {
      const result = await this.yahoo.chart(yahooSymbol, {
        period1,
        period2: new Date(),
        interval: '1d',
      });
      return (result.quotes ?? [])
        .filter(
          (r) =>
            typeof r.close === 'number' &&
            typeof r.high === 'number' &&
            typeof r.low === 'number',
        )
        .map((r) => ({
          close: r.close as number,
          high: r.high as number,
          low: r.low as number,
          volume: typeof r.volume === 'number' ? r.volume : 0,
        }));
    } catch (error) {
      this.logger.warn(
        `History failed for ${yahooSymbol}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  async getFundamentals(symbol: string): Promise<YahooFundamentals> {
    const enrichment = await this.getEnrichment(symbol);
    return enrichment.fundamentals;
  }

  /**
   * Sector + fundamentals for one symbol. Soft-fails to nulls.
   * Cached per IST calendar day.
   */
  async getEnrichment(symbol: string): Promise<YahooEnrichment> {
    const day = istDateKey();
    const cached = this.enrichmentCache.get(symbol);
    if (cached?.day === day) {
      return cached.value;
    }

    const empty: YahooEnrichment = {
      sector: null,
      industry: null,
      companyName: null,
      fundamentals: { ...EMPTY_FUNDAMENTALS },
    };

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const value = await this.fetchEnrichmentOnce(symbol);
        this.enrichmentCache.set(symbol, { day, value });
        return value;
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 250 + Math.random() * 250));
        }
      }
    }

    this.logger.warn(
      `Enrichment failed for ${symbol}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
    this.enrichmentCache.set(symbol, { day, value: empty });
    return empty;
  }

  private async fetchEnrichmentOnce(symbol: string): Promise<YahooEnrichment> {
    const yahooSymbol = toYahooSymbol(symbol);
    const summary = await this.yahoo.quoteSummary(yahooSymbol, {
      modules: [
        'assetProfile',
        'price',
        'defaultKeyStatistics',
        'summaryDetail',
        'financialData',
      ],
    });
    const profile = summary.assetProfile;
    const price = summary.price;
    const stats = summary.defaultKeyStatistics;
    const detail = summary.summaryDetail;
    const fin = summary.financialData;

    const sector =
      typeof profile?.sector === 'string' && profile.sector.trim()
        ? profile.sector.trim()
        : null;
    const industry =
      typeof profile?.industry === 'string' && profile.industry.trim()
        ? profile.industry.trim()
        : null;
    const companyName =
      typeof price?.longName === 'string' && price.longName.trim()
        ? price.longName.trim()
        : typeof price?.shortName === 'string' && price.shortName.trim()
          ? price.shortName.trim()
          : null;

    return {
      sector,
      industry,
      companyName,
      fundamentals: {
        marketCap:
          typeof detail?.marketCap === 'number'
            ? detail.marketCap
            : typeof price?.marketCap === 'number'
              ? price.marketCap
              : null,
        pe: typeof detail?.trailingPE === 'number' ? detail.trailingPE : null,
        pb: typeof stats?.priceToBook === 'number' ? stats.priceToBook : null,
        dividendYield:
          typeof detail?.dividendYield === 'number'
            ? detail.dividendYield
            : null,
        debtToEquity:
          typeof fin?.debtToEquity === 'number' ? fin.debtToEquity : null,
      },
    };
  }
}

export async function mapPool<T>(
  symbols: string[],
  concurrency: number,
  worker: (symbol: string) => Promise<T>,
): Promise<Map<string, T>> {
  const results = new Map<string, T>();
  let index = 0;

  async function run() {
    while (index < symbols.length) {
      const current = index;
      index += 1;
      const symbol = symbols[current];
      results.set(symbol, await worker(symbol));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, symbols.length) }, () => run()),
  );
  return results;
}
