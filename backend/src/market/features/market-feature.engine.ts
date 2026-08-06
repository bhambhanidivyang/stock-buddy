import { Injectable, Logger } from '@nestjs/common';
import {
  CONFIG_VERSION,
  FEATURE_VERSION,
  loadRecommendationConfig,
  SCHEMA_VERSION,
  type RecommendationConfig,
} from '../../config/recommendation.config';
import {
  adx,
  atr,
  atrPercent,
  bollinger,
  deathCrossRecent,
  distToExtremePct,
  ema,
  goldenCrossRecent,
  highLowOver,
  macd,
  periodReturn,
  relativeStrength,
  rsi,
  sectorMomentumFromChanges,
  trendFromEmas,
  volumeMultiple,
  type OhlcBar,
  type SectorMomentum,
} from '../indicators';
import { NseMarketService } from '../nse/nse-market.service';
import type { UniverseStock } from '../providers/universe.provider';
import { UniverseResolverService } from '../providers/universe-resolver.service';
import {
  mapPool,
  YahooService,
  type DailyBar,
  type PriceQuote,
  type YahooFundamentals,
} from '../yahoo.service';
import type {
  AiFacingCandidate,
  Candidate,
  CandidateBoard,
  CandidateFundamentals,
  EligibilityRejection,
  MarketContext,
  PriorityReasonRow,
} from './candidate.types';
import {
  buildTradePlan,
  toSuggestedLevels,
} from '../levels/trade-plan.engine';
import { prioritizeForResearch } from './research-prioritizer';
import { runResearchRanking } from '../ranking/research-ranking.engine';
import type { RankedStock } from '../ranking/research-ranking.engine';
import { rankSectors } from '../ranking/sector-rank';

@Injectable()
export class MarketFeatureEngine {
  private readonly logger = new Logger(MarketFeatureEngine.name);

  constructor(
    private readonly yahoo: YahooService,
    private readonly universeResolver: UniverseResolverService,
    private readonly nse: NseMarketService,
  ) {}

  async buildBoard(
    config: RecommendationConfig = loadRecommendationConfig(),
  ): Promise<CandidateBoard> {
    const quotesAsOf = new Date().toISOString();
    const dataFreshness = quotesAsOf;
    const eligibilityRejected: EligibilityRejection[] = [];

    const { stocks: universe, providerName } =
      await this.universeResolver.resolve(config);
    const universeSize = universe.length;

    // --- Bhav / ADTV (liquidity) ---
    let bhavAsOf: string | null = null;
    let adtvMap = new Map<string, number>();
    let freshness: 'INTRADAY_LIVE' | 'EOD_BHAV' = 'INTRADAY_LIVE';
    try {
      const bhavSync = await this.nse.ensureBhavSynced(
        Math.max(5, config.adtvLookbackDays),
      );
      bhavAsOf = bhavSync.tradeDate;
      if (bhavAsOf) {
        adtvMap = await this.nse.getAdtvMap(
          universe.map((u) => u.symbol),
          config.adtvLookbackDays,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Bhav sync skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Liquid pre-filter using bhav ADTV + last close when available
    const liquid: UniverseStock[] = [];
    let liquidRejected = 0;
    if (adtvMap.size > 0) {
      const bhavRows = bhavAsOf
        ? await this.nse.getBhavRowsForDate(bhavAsOf)
        : new Map();
      for (const stock of universe) {
        const adtv = adtvMap.get(stock.symbol);
        const bhav = bhavRows.get(stock.symbol);
        const px = bhav ? Number(bhav.close) : null;
        if (px != null && px < config.minPrice) {
          liquidRejected += 1;
          eligibilityRejected.push({
            symbol: stock.symbol,
            reason: `bhav price ${px} < min ${config.minPrice}`,
          });
          continue;
        }
        if (adtv == null || adtv < config.minAdtvInr) {
          liquidRejected += 1;
          continue;
        }
        liquid.push(stock);
      }
    } else {
      // No bhav yet: quote full EQ list (slower); ADTV filter applies after sync
      liquid.push(...universe);
    }

    this.logger.log(
      `Universe ${universeSize} via ${providerName}; liquid=${liquid.length} (bhavAsOf=${bhavAsOf ?? 'n/a'})`,
    );

    // --- Live quotes on liquid set ---
    const quoteSymbols = liquid.map((s) => s.symbol);
    const quotes = await this.yahoo.getQuotes(quoteSymbols);
    const quoteFailedSymbols: string[] = [];
    const withQuotes: Array<{ stock: UniverseStock; quote: PriceQuote }> = [];
    for (const stock of liquid) {
      const quote = quotes.get(stock.symbol);
      if (!quote) {
        quoteFailedSymbols.push(stock.symbol);
        continue;
      }
      if (quote.price < config.minPrice) {
        liquidRejected += 1;
        eligibilityRejected.push({
          symbol: stock.symbol,
          reason: `live price ${quote.price} < min ${config.minPrice}`,
        });
        continue;
      }
      withQuotes.push({ stock, quote });
    }

    // --- Shortlist: Activity OR Research Ranking ---
    const rankingCfg = config.ranking;
    const useRanking = rankingCfg.shortlistMode === 'ranking';

    let shortlist: PriorityReasonRow[] = [];
    let researchMeta: {
      regime?: CandidateBoard['marketContext']['researchRegime'];
      sectorRanks?: CandidateBoard['marketContext']['sectorRanks'];
      liquidBreadth?: CandidateBoard['marketContext']['liquidBreadth'];
      poolSize?: number;
      eligibleSectors?: string[];
    } = {};

    const [indicesEarly, niftyBarsEarly, bankBarsEarly] = await Promise.all([
      this.yahoo.getIndexSnapshot(),
      this.yahoo.getDailyBars('^NSEI'),
      this.yahoo.getDailyBars('^NSEBANK'),
    ]);
    const niftyCloses = niftyBarsEarly.map((b) => b.close);
    const bankCloses = bankBarsEarly.map((b) => b.close);
    const niftyTrend = trendFromEmas(
      ema(niftyCloses, 20),
      ema(niftyCloses, 50),
    );
    const bankNiftyTrend = trendFromEmas(
      ema(bankCloses, 20),
      ema(bankCloses, 50),
    );

    if (useRanking) {
      const ranked = await this.shortlistByResearchRanking({
        withQuotes,
        adtvMap,
        niftyCloses,
        niftyTrend,
        bankNiftyTrend,
        indices: indicesEarly,
        config,
      });
      shortlist = ranked.priorityShortlist;
      researchMeta = ranked.meta;
      this.logger.log(
        `Research ranking: regime=${ranked.meta.regime?.label} pool=${ranked.meta.poolSize} top=${shortlist.length} sectors=${(ranked.meta.eligibleSectors ?? []).join(',')}`,
      );
    } else {
      const priorityInputs = withQuotes.map(({ stock, quote }) => {
        const dayValue =
          quote.volume != null ? quote.price * quote.volume : null;
        return {
          symbol: stock.symbol,
          changePercent: quote.changePercent,
          gapPercent: quote.gapPercent,
          volume: quote.volume,
          adtv: adtvMap.get(stock.symbol) ?? null,
          dayValue,
        };
      });
      const prioritized = prioritizeForResearch(priorityInputs, config);
      shortlist = prioritized.slice(0, config.candidateLimit).map((p) => ({
        symbol: p.symbol,
        score: p.score,
        reasons: p.reasons,
      }));
    }

    const shortlistSet = new Set(shortlist.map((p) => p.symbol));
    const priorityShortlist = shortlist;

    const deepTargets = withQuotes.filter((w) =>
      shortlistSet.has(w.stock.symbol),
    );
    const deepSymbols = deepTargets.map((t) => t.stock.symbol);

    // --- Deep bars + Yahoo sector/fundamentals (shortlist only) ---
    const [historyBySymbol, enrichmentBySymbol] = await Promise.all([
      mapPool(deepSymbols, 8, (symbol) =>
        this.yahoo.getDailyBars(symbol, 420),
      ),
      mapPool(deepSymbols, 6, (symbol) => this.yahoo.getEnrichment(symbol)),
    ]);

    const sectorKnown = [...enrichmentBySymbol.values()].filter(
      (e) => e.sector,
    ).length;
    const fundamentalsKnown = [...enrichmentBySymbol.values()].filter((e) =>
      hasAnyFundamental(e.fundamentals),
    ).length;
    this.logger.log(
      `Enrichment shortlist=${deepSymbols.length}: sector=${sectorKnown} fundamentals=${fundamentalsKnown}`,
    );

    const indices = indicesEarly;

    const resolvedSector = (symbol: string, fallback: string) => {
      const fromYahoo = enrichmentBySymbol.get(symbol)?.sector;
      if (fromYahoo) return fromYahoo;
      return fallback && fallback !== 'Unknown' ? fallback : 'Unknown';
    };

    const sectorChanges = new Map<string, Array<number | null>>();
    for (const { stock, quote } of deepTargets) {
      const sector = resolvedSector(stock.symbol, stock.sector);
      const list = sectorChanges.get(sector) ?? [];
      list.push(quote.changePercent);
      sectorChanges.set(sector, list);
    }
    const sectorMomentum = new Map<string, SectorMomentum>();
    for (const [sector, changes] of sectorChanges) {
      sectorMomentum.set(sector, sectorMomentumFromChanges(changes));
    }

    const deepEligible: typeof deepTargets = [];
    let historyRejected = 0;
    for (const row of deepTargets) {
      const bars = historyBySymbol.get(row.stock.symbol) ?? [];
      if (bars.length < config.minHistoryBars) {
        historyRejected += 1;
        eligibilityRejected.push({
          symbol: row.stock.symbol,
          reason: `history ${bars.length} < min ${config.minHistoryBars}`,
        });
        continue;
      }
      deepEligible.push(row);
    }

    const candidates: Candidate[] = deepEligible.map(({ stock, quote }) => {
      const enrichment = enrichmentBySymbol.get(stock.symbol);
      const sector = resolvedSector(stock.symbol, stock.sector);
      return this.buildCandidate({
        symbol: stock.symbol,
        companyName:
          enrichment?.companyName?.trim() ||
          stock.companyName ||
          stock.symbol,
        sector,
        quote,
        bars: historyBySymbol.get(stock.symbol) ?? [],
        niftyCloses,
        sectorMomentum: sectorMomentum.get(sector) ?? 'NEUTRAL',
        fundamentals: toCandidateFundamentals(enrichment),
        config,
        dataFreshness,
      });
    });

    const usable: Candidate[] = [];
    let featureRejected = 0;
    const shortlistOutcomeBySymbol = new Map<
      string,
      {
        symbol: string;
        status: 'BUYABLE' | 'REJECTED';
        reason: string | null;
        buyLow?: number;
        buyHigh?: number;
        sellTarget?: number;
        stopLoss?: number;
      }
    >();

    for (const row of deepTargets) {
      const bars = historyBySymbol.get(row.stock.symbol) ?? [];
      if (bars.length < config.minHistoryBars) {
        shortlistOutcomeBySymbol.set(row.stock.symbol, {
          symbol: row.stock.symbol,
          status: 'REJECTED',
          reason: `history ${bars.length} < min ${config.minHistoryBars}`,
        });
      }
    }

    for (const c of candidates) {
      const coreOk =
        c.technical.rsi14 != null &&
        c.technical.ema50 != null &&
        c.technical.atr14 != null &&
        c.suggestedLevels != null &&
        c.tradePlan?.validationStatus === 'VALID';
      if (!coreOk) {
        featureRejected += 1;
        const planReason =
          c.tradePlan?.rejectionCode != null
            ? `tradePlan ${c.tradePlan.rejectionCode}${
                c.tradePlan.rejectionDetail.message
                  ? `: ${c.tradePlan.rejectionDetail.message}`
                  : ''
              }`
            : 'missing core technicals or VALID tradePlan';
        eligibilityRejected.push({
          symbol: c.symbol,
          reason: planReason,
        });
        shortlistOutcomeBySymbol.set(c.symbol, {
          symbol: c.symbol,
          status: 'REJECTED',
          reason: planReason,
        });
      } else {
        usable.push(c);
        shortlistOutcomeBySymbol.set(c.symbol, {
          symbol: c.symbol,
          status: 'BUYABLE',
          reason: null,
          buyLow: c.suggestedLevels?.buyLow,
          buyHigh: c.suggestedLevels?.buyHigh,
          sellTarget: c.suggestedLevels?.sellTarget,
          stopLoss: c.suggestedLevels?.stopLoss,
        });
      }
    }

    // Preserve prioritizer order
    const order = new Map(shortlist.map((p, i) => [p.symbol, i]));
    usable.sort(
      (a, b) => (order.get(a.symbol) ?? 999) - (order.get(b.symbol) ?? 999),
    );

    const shortlistOutcomes = shortlist.map((p) => {
      const existing = shortlistOutcomeBySymbol.get(p.symbol);
      if (existing) {
        return existing;
      }
      return {
        symbol: p.symbol,
        status: 'REJECTED' as const,
        reason: 'not evaluated in deep pass',
      };
    });

    for (const symbol of quoteFailedSymbols) {
      eligibilityRejected.push({ symbol, reason: 'quote fetch failed' });
    }

    const marketContext = this.buildMarketContext(
      usable,
      indices,
      niftyTrend,
      bankNiftyTrend,
      sectorMomentum,
      researchMeta,
    );

    if (bhavAsOf && withQuotes.length === 0) {
      freshness = 'EOD_BHAV';
    }

    const pipelineFunnel = {
      universe: universeSize,
      universeProvider: providerName,
      liquidEligible: liquid.length,
      liquidRejected,
      quotesOk: withQuotes.length,
      quotesFailed: quoteFailedSymbols.length,
      prioritized: shortlist.length,
      eligibilityPassed: deepEligible.length,
      eligibilityRejected: historyRejected + quoteFailedSymbols.length,
      featureReady: usable.length,
      featureRejected,
      sentToAi: usable.length,
      freshness,
      bhavAsOf,
      quotesAsOf,
      shortlistMode: rankingCfg.shortlistMode,
      researchPool: researchMeta.poolSize,
      eligibleSectors: researchMeta.eligibleSectors,
      summary: [
        `universe ${universeSize}(${providerName})`,
        `liquid ${liquid.length}`,
        `quotes ${withQuotes.length}`,
        `${rankingCfg.shortlistMode} ${shortlist.length}`,
        `deep ${usable.length}`,
        `→ AI ${usable.length}`,
        freshness,
      ].join(' · '),
    };

    this.logger.log(`Pipeline funnel: ${pipelineFunnel.summary}`);

    return {
      versions: {
        schemaVersion: SCHEMA_VERSION,
        featureVersion: FEATURE_VERSION,
        configVersion: CONFIG_VERSION,
      },
      config: { ...config },
      strategyProfile: config.strategyProfile,
      marketContext,
      candidates: usable,
      // Keep a sample of early filters + always keep shortlist outcomes separately.
      eligibilityRejected: eligibilityRejected.slice(0, 200),
      pipelineFunnel,
      priorityShortlist,
      shortlistOutcomes,
    };
  }

  toAiCandidates(
    board: CandidateBoard,
    config: RecommendationConfig,
  ): AiFacingCandidate[] {
    const researchBySymbol = new Map(
      board.priorityShortlist.map((p) => [p.symbol, p]),
    );
    return board.candidates.map((c) => {
      const pri = researchBySymbol.get(c.symbol);
      const researchBlock =
        pri?.research != null || (pri != null && config.ranking.shortlistMode === 'ranking')
          ? {
              researchScore: pri.score,
              reasons: pri.reasons,
              ...pri.research,
            }
          : undefined;
      const base = config.aiIncludeExtendedTechnical
        ? { ...c }
        : {
            symbol: c.symbol,
            companyName: c.companyName,
            sector: c.sector,
            quote: c.quote,
            technical: c.technical,
            structure: c.structure,
            fundamentals: c.fundamentals,
            suggestedLevels: c.suggestedLevels,
            tradePlan: c.tradePlan,
            metadata: c.metadata,
          };
      return researchBlock
        ? { ...base, research: researchBlock }
        : base;
    });
  }

  private buildCandidate(input: {
    symbol: string;
    companyName: string;
    sector: string;
    quote: PriceQuote;
    bars: DailyBar[];
    niftyCloses: number[];
    sectorMomentum: SectorMomentum;
    fundamentals: CandidateFundamentals;
    config: RecommendationConfig;
    dataFreshness: string;
  }): Candidate {
    const { quote, bars, config } = input;
    const closes = bars.map((b) => b.close);
    const volumes = bars.map((b) => b.volume);
    const price = quote.price;

    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);
    const ema200 = ema(closes, 200);
    const atr14 = atr(bars, 14);
    const macdRes = macd(closes);
    const adxRes = adx(bars, 14);
    const bb = bollinger(closes, 20);
    const prev = bars.length >= 2 ? bars[bars.length - 2] : null;
    const prevDayHigh = prev?.high ?? null;
    const prevDayLow = prev?.low ?? null;
    const range52 = highLowOver(bars, Math.min(252, bars.length));

    const missingFields: string[] = [];
    if (rsi(closes, 14) == null) missingFields.push('rsi14');
    if (ema50 == null) missingFields.push('ema50');
    if (atr14 == null) missingFields.push('atr14');

    const rvol20 = volumeMultiple(volumes, 20);
    const tradePlan = buildTradePlan({
      bars,
      ltp: price,
      atr: atr14,
      ema20,
      ema50,
      prevDayHigh,
      prevDayLow,
      rvol20,
      adx14: adxRes?.adx ?? null,
      config: config.levels,
    });
    const suggestedLevels = toSuggestedLevels(tradePlan);
    if (suggestedLevels == null) {
      missingFields.push('suggestedLevels');
      if (tradePlan.rejectionCode) {
        missingFields.push(`tradePlan:${tradePlan.rejectionCode}`);
      }
    }

    return {
      symbol: input.symbol,
      companyName: input.companyName,
      sector: input.sector,
      quote: {
        price,
        previousClose: quote.previousClose,
        changePercent: quote.changePercent,
        volume: quote.volume,
        gapPercent: quote.gapPercent,
      },
      technical: {
        rsi14: rsi(closes, 14),
        ema20,
        ema50,
        ema200,
        emaAligned:
          ema20 != null && ema50 != null && ema200 != null
            ? ema20 > ema50 && ema50 > ema200
            : null,
        priceAboveEma20: ema20 != null ? price > ema20 : null,
        priceAboveEma50: ema50 != null ? price > ema50 : null,
        priceAboveEma200: ema200 != null ? price > ema200 : null,
        goldenCross: goldenCrossRecent(closes, 5),
        deathCross: deathCrossRecent(closes, 5),
        macd: macdRes?.macd ?? null,
        macdSignal: macdRes?.signal ?? null,
        macdHist: macdRes?.hist ?? null,
        adx14: adxRes?.adx ?? null,
        plusDi: adxRes?.plusDi ?? null,
        minusDi: adxRes?.minusDi ?? null,
        atr14,
        atrPercent: atrPercent(bars, 14),
        rvol20,
        relativeStrength20: relativeStrength(closes, input.niftyCloses, 20),
        trend: trendFromEmas(ema20, ema50),
        sectorMomentum: input.sectorMomentum,
      },
      structure: {
        prevDayHigh,
        prevDayLow,
        distToPdhPct: distToExtremePct(price, prevDayHigh),
        distToPdlPct: distToExtremePct(price, prevDayLow),
        return5d: periodReturn(closes, 5),
        return20d: periodReturn(closes, 20),
        dist52wHighPct: distToExtremePct(price, range52.high),
        dist52wLowPct: distToExtremePct(price, range52.low),
      },
      fundamentals: input.fundamentals,
      suggestedLevels,
      tradePlan,
      technicalExtended: {
        bollingerPercentB: bb?.percentB ?? null,
        bollingerWidth: bb?.width ?? null,
        roc20: periodReturn(closes, 20),
      },
      metadata: {
        schemaVersion: SCHEMA_VERSION,
        featureVersion: FEATURE_VERSION,
        configVersion: CONFIG_VERSION,
        barCount: bars.length,
        missingFields,
        dataFreshness: input.dataFreshness,
      },
    };
  }

  private async shortlistByResearchRanking(input: {
    withQuotes: Array<{ stock: UniverseStock; quote: PriceQuote }>;
    adtvMap: Map<string, number>;
    niftyCloses: number[];
    niftyTrend: ReturnType<typeof trendFromEmas>;
    bankNiftyTrend: ReturnType<typeof trendFromEmas>;
    indices: Record<string, PriceQuote | null>;
    config: RecommendationConfig;
  }): Promise<{
    priorityShortlist: PriorityReasonRow[];
    meta: {
      regime?: MarketContext['researchRegime'];
      sectorRanks?: MarketContext['sectorRanks'];
      liquidBreadth?: MarketContext['liquidBreadth'];
      poolSize?: number;
      eligibleSectors?: string[];
    };
  }> {
    const { withQuotes, adtvMap, config } = input;
    const ranking = config.ranking;
    const symbols = withQuotes.map((w) => w.stock.symbol);

    // Cheap 21d closes from bhav for sector RS + advance/decline
    const closeMap = await this.nse.getCloseSeriesMap(symbols, 25);

    // Sector enrichment for liquid set (IST-day cached)
    const enrichmentBySymbol = await mapPool(symbols, 8, (symbol) =>
      this.yahoo.getEnrichment(symbol),
    );

    const resolveSector = (symbol: string, fallback: string) => {
      const fromYahoo = enrichmentBySymbol.get(symbol)?.sector;
      if (fromYahoo) return fromYahoo;
      return fallback && fallback !== 'Unknown' ? fallback : 'Unknown';
    };

    let advance1d = 0;
    let advance5d = 0;
    let breadthN = 0;
    for (const closes of closeMap.values()) {
      if (closes.length < 2) continue;
      breadthN += 1;
      if (closes[closes.length - 1] > closes[closes.length - 2]) {
        advance1d += 1;
      }
      if (closes.length >= 6) {
        const r5 = periodReturn(closes, 5);
        if (r5 != null && r5 > 0) advance5d += 1;
      }
    }

    const liquidBreadth =
      breadthN > 0
        ? {
            advance1d: advance1d / breadthN,
            advance5d: advance5d / breadthN,
            total: breadthN,
          }
        : undefined;

    // Sector membership + cheap returns for ALL liquid (Stage 2)
    const sectorMembers = withQuotes.map(({ stock }) => {
      const closes = closeMap.get(stock.symbol) ?? [];
      return {
        symbol: stock.symbol,
        sector: resolveSector(stock.symbol, stock.sector),
        return20: periodReturn(closes, 20),
        return5: periodReturn(closes, 5),
        closes,
      };
    });

    // Identify top sectors first (cheap), then deep-fetch Yahoo bars for those + wildcards
    const sectorRanksPreview = rankSectors({
      members20: sectorMembers.map((m) => ({
        symbol: m.symbol,
        sector: m.sector,
        returnL: m.return20,
      })),
      members5: sectorMembers.map((m) => ({
        symbol: m.symbol,
        sector: m.sector,
        returnL: m.return5,
      })),
      minSectorMembers: ranking.minSectorMembers,
    });
    const eligibleSectors = sectorRanksPreview
      .slice(0, ranking.sectorTopN)
      .map((s) => s.sector);
    const eligibleSet = new Set(eligibleSectors);

    let inSector = sectorMembers.filter((m) => eligibleSet.has(m.sector));
    // Fallback when Yahoo sectors are sparse: deep-fetch top liquid by 20d return
    if (inSector.length < ranking.perSectorPool) {
      this.logger.warn(
        `Few sector-tagged names in eligible sectors (${inSector.length}); falling back to top 20d performers`,
      );
      inSector = [...sectorMembers]
        .sort((a, b) => (b.return20 ?? -99) - (a.return20 ?? -99))
        .slice(0, ranking.sectorTopN * ranking.perSectorPool);
    }
    const outside = sectorMembers
      .filter((m) => !eligibleSet.has(m.sector) || eligibleSet.size === 0)
      .sort((a, b) => (b.return20 ?? -99) - (a.return20 ?? -99))
      .slice(0, ranking.wildcardCandidatePool);

    const deepSymbols = [
      ...new Set([...inSector, ...outside].map((m) => m.symbol)),
    ];

    this.logger.log(
      `Ranking deep-fetch ${deepSymbols.length} symbols (eligible sectors=${eligibleSectors.join(',') || 'none'})`,
    );

    const historyBySymbol = await mapPool(deepSymbols, 10, (symbol) =>
      this.yahoo.getDailyBars(symbol, 420),
    );

    const stocks = deepSymbols.map((symbol) => {
      const meta = sectorMembers.find((m) => m.symbol === symbol)!;
      const bars = (historyBySymbol.get(symbol) ?? []) as OhlcBar[];
      return {
        symbol,
        sector: meta.sector,
        bars,
        return20: meta.return20,
        return5: meta.return5,
        adtv: adtvMap.get(symbol) ?? null,
      };
    });

    const vix = input.indices.indiaVix;
    const result = runResearchRanking({
      stocks,
      niftyCloses: input.niftyCloses,
      regime: {
        niftyTrend: input.niftyTrend,
        bankNiftyTrend: input.bankNiftyTrend,
        advanceDecline1d: liquidBreadth?.advance1d ?? null,
        advanceDecline5d: liquidBreadth?.advance5d ?? null,
        sectorBreadth: null,
        indiaVixPrice: vix?.price ?? null,
        indiaVixChangePercent: vix?.changePercent ?? null,
      },
      config: ranking,
    });

    const topK = Math.min(ranking.topK, config.candidateLimit);
    const top = result.top.slice(0, topK);

    const priorityShortlist: PriorityReasonRow[] = top.map((r: RankedStock) => ({
      symbol: r.symbol,
      score: r.overallScore,
      reasons: r.reasons,
      research: {
        relativeStrengthScore: r.relativeStrengthScore ?? undefined,
        trendScore: r.trendScore ?? undefined,
        nearHighScore: r.nearHighScore ?? undefined,
        persistenceScore: r.persistenceScore ?? undefined,
        sectorScore: r.sectorScore ?? undefined,
        volumeScore: r.volumeScore ?? undefined,
        isWildcard: r.isWildcard,
      },
    }));

    return {
      priorityShortlist,
      meta: {
        regime: {
          label: result.regime.label,
          score: result.regime.score,
          reasons: result.regime.reasons,
        },
        sectorRanks: result.sectorRanks.slice(0, 12).map((s) => ({
          sector: s.sector,
          score: s.score,
          rank: s.rank,
          sectorRs20: s.sectorRs20,
        })),
        liquidBreadth,
        poolSize: result.poolSize,
        eligibleSectors: result.eligibleSectors,
      },
    };
  }

  private buildMarketContext(
    candidates: Candidate[],
    indices: Record<string, PriceQuote | null>,
    niftyTrend: ReturnType<typeof trendFromEmas>,
    bankNiftyTrend: ReturnType<typeof trendFromEmas>,
    sectorMomentum: Map<string, SectorMomentum>,
    researchMeta: {
      regime?: MarketContext['researchRegime'];
      sectorRanks?: MarketContext['sectorRanks'];
      liquidBreadth?: MarketContext['liquidBreadth'];
    } = {},
  ): MarketContext {
    const up = candidates.filter((c) => c.technical.trend === 'UP').length;
    const down = candidates.filter((c) => c.technical.trend === 'DOWN').length;
    const sideways = candidates.filter(
      (c) => c.technical.trend === 'SIDEWAYS',
    ).length;
    const withCore = candidates.filter(
      (c) =>
        c.technical.rsi14 != null &&
        c.technical.ema50 != null &&
        c.technical.atr14 != null,
    ).length;
    const withLevels = candidates.filter(
      (c) => c.suggestedLevels != null,
    ).length;
    const mostlyNull =
      candidates.length > 0 && withCore / candidates.length < 0.5;

    const byVolume = [...candidates]
      .filter((c) => c.quote.volume != null)
      .sort((a, b) => (b.quote.volume ?? 0) - (a.quote.volume ?? 0))
      .slice(0, 15)
      .map((c) => c.symbol);
    const gapUp = [...candidates]
      .filter((c) => (c.quote.gapPercent ?? 0) >= 1)
      .sort((a, b) => (b.quote.gapPercent ?? 0) - (a.quote.gapPercent ?? 0))
      .slice(0, 10)
      .map((c) => c.symbol);
    const gapDown = [...candidates]
      .filter((c) => (c.quote.gapPercent ?? 0) <= -1)
      .sort((a, b) => (a.quote.gapPercent ?? 0) - (b.quote.gapPercent ?? 0))
      .slice(0, 10)
      .map((c) => c.symbol);

    const vix = indices.indiaVix;

    return {
      indices,
      niftyTrend,
      bankNiftyTrend,
      indiaVix: vix
        ? { price: vix.price, changePercent: vix.changePercent }
        : null,
      researchRegime: researchMeta.regime,
      sectorRanks: researchMeta.sectorRanks,
      breadth: { up, down, sideways, total: candidates.length },
      liquidBreadth: researchMeta.liquidBreadth,
      sectorMomentum: Object.fromEntries(sectorMomentum.entries()),
      technicalCoverage: {
        total: candidates.length,
        withCoreTechnicals: withCore,
        withLevels,
        mostlyNull,
        note: mostlyNull
          ? 'Core technicals missing for most candidates — prefer high cash or empty picks.'
          : 'Technicals populated for majority of eligible candidates.',
      },
      screens: {
        highestVolumeToday: byVolume,
        gapUp,
        gapDown,
      },
    };
  }
}

function toCandidateFundamentals(
  enrichment: { fundamentals: YahooFundamentals } | undefined,
): CandidateFundamentals {
  const f = enrichment?.fundamentals;
  return {
    marketCap: f?.marketCap ?? null,
    pe: f?.pe ?? null,
    pb: f?.pb ?? null,
    dividendYield: f?.dividendYield ?? null,
    debtToEquity: f?.debtToEquity ?? null,
  };
}

function hasAnyFundamental(f: YahooFundamentals): boolean {
  return (
    f.marketCap != null ||
    f.pe != null ||
    f.pb != null ||
    f.dividendYield != null ||
    f.debtToEquity != null
  );
}
