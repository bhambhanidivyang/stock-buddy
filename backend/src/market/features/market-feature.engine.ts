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
  simpleReturn,
  trendFromEmas,
  volumeMultiple,
  type OhlcBar,
  type SectorMomentum,
} from '../indicators';
import {
  BHAV_MAX_AGE_DAYS,
  isBhavSyncSatisfied,
} from '../nse/bhav-sync';
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
  RankingPoolDiagnostics,
  ResearchScoredRow,
} from './candidate.types';
import {
  classifyCandidateStatus,
  type StatusReasonCode,
} from '../levels/candidate-status';
import {
  buildTradePlan,
  toSuggestedLevels,
} from '../levels/trade-plan.engine';
import { prioritizeForResearch } from './research-prioritizer';
import { runResearchRanking } from '../ranking/research-ranking.engine';
import type { RankedStock } from '../ranking/research-ranking.engine';
import { rankSectors } from '../ranking/sector-rank';
import { gateRankingDeepPool } from '../ranking/ranking-pool-gate';

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
    const boardStartedMs = Date.now();
    const quotesAsOf = new Date().toISOString();
    const dataFreshness = quotesAsOf;
    const eligibilityRejected: EligibilityRejection[] = [];

    this.logger.log('Board stage: resolving universe…');
    const { stocks: universe, providerName } =
      await this.universeResolver.resolve(config);
    const universeSize = universe.length;
    this.logger.log(
      `Board stage: universe ready size=${universeSize} provider=${providerName}`,
    );

    // --- Bhav / ADTV (liquidity) ---
    // Always ensure market history before research: Get recommendations relies
    // on this path (not only the Settings sync button).
    this.logger.log('Board stage: syncing bhav / ADTV…');
    let bhavAsOf: string | null = null;
    let adtvMap = new Map<string, number>();
    let freshness: 'INTRADAY_LIVE' | 'EOD_BHAV' = 'INTRADAY_LIVE';
    const rankingCfgEarly = config.ranking;
    const bhavSyncDays = Math.max(
      5,
      config.adtvLookbackDays,
      rankingCfgEarly.bhavLookbackSessions,
    );
    try {
      const bhavSync = await this.nse.ensureBhavSynced(bhavSyncDays);
      bhavAsOf = bhavSync.tradeDate;
      const ready = isBhavSyncSatisfied({
        distinctSessions: bhavSync.sessions,
        latestTradeDate: bhavAsOf,
        minSessions: bhavSyncDays,
        maxAgeDays: BHAV_MAX_AGE_DAYS,
      });
      this.logger.log(
        `Pre-recommend market sync: sessions=${bhavSync.sessions}/${bhavSyncDays} latest=${bhavAsOf ?? 'null'} ready=${ready}`,
      );
      if (!ready && rankingCfgEarly.shortlistMode === 'ranking') {
        this.logger.error(
          `Bhav not ready after sync (need ≥${bhavSyncDays} fresh sessions); research ranking will fail closed`,
        );
      }
      if (bhavAsOf) {
        adtvMap = await this.nse.getAdtvMap(
          universe.map((u) => u.symbol),
          config.adtvLookbackDays,
        );
      }
    } catch (error) {
      this.logger.error(
        `Pre-recommend market sync failed: ${error instanceof Error ? error.message : String(error)}`,
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
    this.logger.log(
      `Board stage: fetching live quotes for ${quoteSymbols.length} liquid symbol(s)…`,
    );
    const quotesStartedMs = Date.now();
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
    this.logger.log(
      `Board stage: quotes done in ${Date.now() - quotesStartedMs}ms ok=${withQuotes.length} failed=${quoteFailedSymbols.length}`,
    );

    // --- Shortlist: Activity OR Research Ranking ---
    const rankingCfg = config.ranking;
    const useRanking = rankingCfg.shortlistMode === 'ranking';
    this.logger.log(
      `Board stage: shortlist mode=${rankingCfg.shortlistMode} (quotes=${withQuotes.length})…`,
    );
    let shortlist: PriorityReasonRow[] = [];
    let researchMeta: {
      regime?: CandidateBoard['marketContext']['researchRegime'];
      sectorRanks?: CandidateBoard['marketContext']['sectorRanks'];
      liquidBreadth?: CandidateBoard['marketContext']['liquidBreadth'];
      poolSize?: number;
      eligibleSectors?: string[];
      rankingDiagnostics?: RankingPoolDiagnostics;
      researchScoredTop?: ResearchScoredRow[];
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
      if (ranked.meta.rankingDiagnostics?.failed) {
        this.logger.error(
          `Research ranking FAILED CLOSED: ${ranked.meta.rankingDiagnostics.failReason}`,
        );
      }
      this.logger.log(
        `Research ranking: regime=${ranked.meta.regime?.label ?? 'n/a'} pool=${ranked.meta.poolSize ?? 0} top=${shortlist.length} sectors=${(ranked.meta.eligibleSectors ?? []).join(',') || 'none'} coverage=${((ranked.meta.rankingDiagnostics?.return20Coverage ?? 0) * 100).toFixed(1)}% failed=${ranked.meta.rankingDiagnostics?.failed ?? false}`,
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
    this.logger.log(
      `Board stage: deep-fetch history+enrichment for ${deepSymbols.length} shortlist symbol(s)…`,
    );
    const deepStartedMs = Date.now();
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
      `Enrichment shortlist=${deepSymbols.length}: sector=${sectorKnown} fundamentals=${fundamentalsKnown} (${Date.now() - deepStartedMs}ms)`,
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

    const shortlistOutcomeBySymbol = new Map<
      string,
      {
        symbol: string;
        status: 'BUYABLE' | 'WATCH' | 'RED';
        reasonCode: StatusReasonCode;
        reason: string | null;
        buyLow?: number;
        buyHigh?: number;
        sellTarget?: number;
        stopLoss?: number;
        riskReward?: number;
        setupType?: string;
        planQuality?: string;
      }
    >();

    for (const row of deepTargets) {
      const bars = historyBySymbol.get(row.stock.symbol) ?? [];
      if (bars.length < config.minHistoryBars) {
        const reason = `history ${bars.length} < min ${config.minHistoryBars}`;
        shortlistOutcomeBySymbol.set(row.stock.symbol, {
          symbol: row.stock.symbol,
          status: 'RED',
          reasonCode: 'HISTORY_TOO_SHORT',
          reason,
        });
      }
    }

    const statusCounts = { BUYABLE: 0, WATCH: 0, RED: 0 };
    const watchReasonCounts = new Map<string, number>();
    const redReasonCounts = new Map<string, number>();
    let buyableGreen = 0;
    let buyableAmber = 0;
    const researchMetaBySymbol = new Map(
      priorityShortlist.map((p, i) => [
        p.symbol,
        { rank: i + 1, score: p.score },
      ]),
    );

    for (const c of candidates) {
      statusCounts[c.candidateStatus] += 1;
      const plan = c.tradePlan;
      const levels =
        c.candidateStatus === 'BUYABLE' && c.suggestedLevels
          ? c.suggestedLevels
          : plan && plan.buyHigh > 0
            ? {
                buyLow: plan.buyLow,
                buyHigh: plan.buyHigh,
                sellTarget: plan.sellTarget > 0 ? plan.sellTarget : undefined,
                stopLoss: plan.stopLoss > 0 ? plan.stopLoss : undefined,
              }
            : null;

      shortlistOutcomeBySymbol.set(c.symbol, {
        symbol: c.symbol,
        status: c.candidateStatus,
        reasonCode: c.statusReasonCode,
        reason: c.statusReason,
        buyLow: levels?.buyLow,
        buyHigh: levels?.buyHigh,
        sellTarget: levels?.sellTarget,
        stopLoss: levels?.stopLoss,
        riskReward:
          plan?.riskReward && plan.riskReward > 0 ? plan.riskReward : undefined,
        setupType: plan?.setupType,
        planQuality: plan?.planQuality,
      });

      if (c.candidateStatus === 'BUYABLE') {
        if (plan?.planQuality === 'AMBER') buyableAmber += 1;
        else buyableGreen += 1;
      } else {
        const bucket = c.statusReasonCode;
        const map =
          c.candidateStatus === 'WATCH' ? watchReasonCounts : redReasonCounts;
        map.set(bucket, (map.get(bucket) ?? 0) + 1);
        eligibilityRejected.push({
          symbol: c.symbol,
          reason: `${c.candidateStatus} ${c.statusReasonCode}${
            c.statusReason ? `: ${c.statusReason}` : ''
          }`,
        });
      }

      const rm = researchMetaBySymbol.get(c.symbol);
      const detail = plan?.rejectionDetail;
      const riskPct =
        detail?.riskPct ??
        (plan && plan.buyHigh > 0 && plan.stopLoss > 0
          ? (plan.buyHigh - plan.stopLoss) / plan.buyHigh
          : null);
      const riskAtr =
        detail?.riskAtr ??
        (plan && plan.atrUsed > 0 && plan.stopLoss > 0
          ? (plan.buyHigh - plan.stopLoss) / plan.atrUsed
          : null);
      const extension =
        detail?.entryOvershootAtr != null
          ? detail.entryOvershootAtr
          : null;
      this.logger.log(
        [
          `Top40 ${c.symbol}`,
          `rank=${rm?.rank ?? '?'}`,
          `score=${rm?.score != null ? rm.score.toFixed(1) : '?'}`,
          `status=${c.candidateStatus}`,
          `reason=${c.statusReasonCode}`,
          `setup=${plan?.setupType ?? 'NONE'}`,
          `ltp=${c.quote.price}`,
          `entry=${plan && plan.buyHigh > 0 ? `${plan.buyLow}-${plan.buyHigh}` : '—'}`,
          `stop=${plan && plan.stopLoss > 0 ? plan.stopLoss : '—'}`,
          `target=${plan && plan.sellTarget > 0 ? plan.sellTarget : '—'}`,
          `riskPct=${riskPct != null ? (riskPct * 100).toFixed(1) + '%' : '—'}`,
          `riskATR=${riskAtr != null ? riskAtr.toFixed(2) : '—'}`,
          `RR=${plan?.riskReward && plan.riskReward > 0 ? plan.riskReward : '—'}`,
          `extATR=${extension != null ? extension.toFixed(2) : '—'}`,
          detail?.stopStructurePrice != null
            ? `structure=${detail.stopStructurePrice}`
            : null,
          c.statusReason ? `msg=${c.statusReason}` : null,
        ]
          .filter(Boolean)
          .join(' '),
      );
    }

    const buyable = candidates.filter((c) => c.candidateStatus === 'BUYABLE');
    const featureRejected = statusCounts.WATCH + statusCounts.RED;

    this.logger.log(
      `Top ${deepTargets.length}: BUYABLE=${statusCounts.BUYABLE} (green=${buyableGreen} amber=${buyableAmber}) WATCH=${statusCounts.WATCH} RED=${statusCounts.RED + historyRejected}`,
    );
    if (watchReasonCounts.size > 0) {
      const known = [
        'STOP_TOO_WIDE',
        'NO_VALID_ENTRY',
        'ENTRY_TOO_EXTENDED',
        'TARGET_TOO_CLOSE',
        'NO_STRUCTURAL_TARGET',
      ];
      let other = 0;
      const parts: string[] = [];
      for (const code of known) {
        const n = watchReasonCounts.get(code) ?? 0;
        if (n > 0) parts.push(`${code}=${n}`);
      }
      for (const [code, n] of watchReasonCounts) {
        if (!known.includes(code)) other += n;
      }
      if (other > 0) parts.push(`OTHER=${other}`);
      this.logger.log(`WATCH reasons: ${parts.join(' | ')}`);
    }
    if (redReasonCounts.size > 0 || historyRejected > 0) {
      const parts = [...redReasonCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([reason, count]) => `${reason}=${count}`);
      if (historyRejected > 0) {
        parts.push(`HISTORY_TOO_SHORT=${historyRejected}`);
      }
      this.logger.log(`RED reasons: ${parts.join(' | ')}`);
    }
    // Representative STOP_TOO_WIDE samples with full geometry for diagnosis.
    const stopWideSamples = candidates
      .filter((c) => c.statusReasonCode === 'STOP_TOO_WIDE')
      .slice(0, 8);
    for (const c of stopWideSamples) {
      const p = c.tradePlan;
      const d = p?.rejectionDetail;
      this.logger.log(
        `STOP_TOO_WIDE sample ${c.symbol}: LTP=${c.quote.price} buyLow=${p?.buyLow ?? '—'} buyHigh=${p?.buyHigh ?? '—'} stop=${p?.stopLoss ?? '—'} ATR=${p?.atrUsed ?? c.technical.atr14 ?? '—'} riskPct=${d?.riskPct ?? '—'} riskATR=${d?.riskAtr ?? '—'} swing/structure=${d?.stopStructurePrice ?? '—'} PDL=${c.structure.prevDayLow ?? '—'} setup=${p?.setupType ?? '—'}`,
      );
    }
    if (buyable.length > 0) {
      this.logger.log(
        `BUYABLE list: ${buyable
          .map((c) => {
            const p = c.suggestedLevels ?? c.tradePlan;
            return `${c.symbol} entry=${p?.buyLow}-${p?.buyHigh} stop=${p?.stopLoss} tgt=${p?.sellTarget} RR=${p?.riskReward} setup=${c.tradePlan?.setupType}`;
          })
          .join(' | ')}`,
      );
    }
    if (buyableAmber > 0) {
      const amberLines = buyable
        .filter((c) => c.tradePlan?.planQuality === 'AMBER')
        .map((c) => {
          const reasons =
            c.tradePlan?.rejectionDetail?.amberReasons?.join('; ') ?? 'amber';
          return `${c.symbol}: ${reasons}`;
        });
      this.logger.log(`Buyable amber detail: ${amberLines.join(' | ')}`);
    }

    // Preserve prioritizer order — keep full Top-40 (BUYABLE+WATCH+RED) for AI context.
    const order = new Map(shortlist.map((p, i) => [p.symbol, i]));
    candidates.sort(
      (a, b) => (order.get(a.symbol) ?? 999) - (order.get(b.symbol) ?? 999),
    );

    const shortlistOutcomes = shortlist.map((p) => {
      const existing = shortlistOutcomeBySymbol.get(p.symbol);
      if (existing) {
        return existing;
      }
      return {
        symbol: p.symbol,
        status: 'RED' as const,
        reasonCode: 'NOT_EVALUATED' as const,
        reason: 'not evaluated in deep pass',
      };
    });

    for (const symbol of quoteFailedSymbols) {
      eligibilityRejected.push({ symbol, reason: 'quote fetch failed' });
    }

    const marketContext = this.buildMarketContext(
      buyable,
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
      featureReady: buyable.length,
      featureRejected,
      sentToAi: candidates.length,
      freshness,
      bhavAsOf,
      quotesAsOf,
      shortlistMode: rankingCfg.shortlistMode,
      researchPool: researchMeta.poolSize,
      eligibleSectors: researchMeta.eligibleSectors,
      rankingFailed: researchMeta.rankingDiagnostics?.failed ?? false,
      rankingFailReason: researchMeta.rankingDiagnostics?.failReason ?? null,
      return20Coverage: researchMeta.rankingDiagnostics?.return20Coverage,
      summary: [
        `universe ${universeSize}(${providerName})`,
        `liquid ${liquid.length}`,
        `quotes ${withQuotes.length}`,
        `${rankingCfg.shortlistMode} ${shortlist.length}`,
        researchMeta.rankingDiagnostics?.failed
          ? `rankingFAIL`
          : null,
        `BUYABLE ${buyable.length}`,
        `WATCH ${statusCounts.WATCH}`,
        `RED ${statusCounts.RED + historyRejected}`,
        `→ AI ${candidates.length}`,
        freshness,
      ]
        .filter(Boolean)
        .join(' · '),
    };

    this.logger.log(
      `Pipeline funnel: ${pipelineFunnel.summary} (${Date.now() - boardStartedMs}ms)`,
    );

    return {
      versions: {
        schemaVersion: SCHEMA_VERSION,
        featureVersion: FEATURE_VERSION,
        configVersion: CONFIG_VERSION,
      },
      config: { ...config },
      strategyProfile: config.strategyProfile,
      marketContext,
      candidates,
      // Keep a sample of early filters + always keep shortlist outcomes separately.
      eligibilityRejected: eligibilityRejected.slice(0, 200),
      pipelineFunnel,
      priorityShortlist,
      shortlistOutcomes,
      researchScoredTop: researchMeta.researchScoredTop,
      rankingDiagnostics: researchMeta.rankingDiagnostics,
    };
  }

  toAiCandidates(
    board: CandidateBoard,
    config: RecommendationConfig,
  ): AiFacingCandidate[] {
    const researchBySymbol = new Map(
      board.priorityShortlist.map((p, i) => [p.symbol, { row: p, rank: i + 1 }]),
    );
    return board.candidates.map((c) => {
      const pri = researchBySymbol.get(c.symbol);
      const detail = c.tradePlan?.rejectionDetail;
      const riskPercent =
        detail?.riskPct ??
        (c.tradePlan && c.tradePlan.buyHigh > 0 && c.tradePlan.stopLoss > 0
          ? (c.tradePlan.buyHigh - c.tradePlan.stopLoss) / c.tradePlan.buyHigh
          : null);
      const riskATR =
        detail?.riskAtr ??
        (c.tradePlan && c.tradePlan.atrUsed > 0 && c.tradePlan.stopLoss > 0
          ? (c.tradePlan.buyHigh - c.tradePlan.stopLoss) / c.tradePlan.atrUsed
          : null);
      const extension = detail?.entryOvershootAtr ?? null;
      const researchBlock =
        pri != null &&
        (pri.row.research != null || config.ranking.shortlistMode === 'ranking')
          ? {
              researchScore: pri.row.score,
              rank: pri.rank,
              reasons: pri.row.reasons,
              ...pri.row.research,
            }
          : undefined;
      const compactPlan =
        c.tradePlan == null
          ? null
          : {
              setupType: c.tradePlan.setupType,
              entryReason: c.tradePlan.entryReason,
              stopReason: c.tradePlan.stopReason,
              targetReason: c.tradePlan.targetReason,
              buyLow: c.tradePlan.buyLow,
              buyHigh: c.tradePlan.buyHigh,
              stopLoss: c.tradePlan.stopLoss,
              sellTarget: c.tradePlan.sellTarget,
              risk: c.tradePlan.risk,
              reward: c.tradePlan.reward,
              riskReward: c.tradePlan.riskReward,
              riskPercent,
              riskATR,
              extension,
              planQuality: c.tradePlan.planQuality,
              validationStatus: c.tradePlan.validationStatus,
              rejectionCode: c.tradePlan.rejectionCode,
              atrUsed: c.tradePlan.atrUsed,
              method: c.tradePlan.method,
            };
      const base = config.aiIncludeExtendedTechnical
        ? {
            ...c,
            tradePlan: compactPlan,
            researchRank: pri?.rank,
            riskPercent,
            riskATR,
            extension,
          }
        : {
            symbol: c.symbol,
            companyName: c.companyName,
            sector: c.sector,
            candidateStatus: c.candidateStatus,
            statusReasonCode: c.statusReasonCode,
            statusReason: c.statusReason,
            researchRank: pri?.rank,
            riskPercent,
            riskATR,
            extension,
            quote: c.quote,
            technical: c.technical,
            structure: c.structure,
            fundamentals: c.fundamentals,
            suggestedLevels: c.suggestedLevels,
            tradePlan: compactPlan,
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

    const rsi14 = rsi(closes, 14);
    const missingCore: string[] = [];
    if (rsi14 == null) missingCore.push('rsi14');
    if (ema50 == null) missingCore.push('ema50');
    if (atr14 == null) missingCore.push('atr14');

    const missingFields: string[] = [...missingCore];

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
    let classified = classifyCandidateStatus({
      missingCore,
      plan: tradePlan,
    });
    let suggestedLevels =
      classified.status === 'BUYABLE' ? toSuggestedLevels(tradePlan) : null;
    if (classified.status === 'BUYABLE' && suggestedLevels == null) {
      classified = {
        status: 'WATCH',
        reasonCode: 'NO_VALID_ENTRY',
        reason: 'plan marked buyable but suggestedLevels missing',
      };
    }
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
        rsi14,
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
      candidateStatus: classified.status,
      statusReasonCode: classified.reasonCode,
      statusReason: classified.reason,
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
      rankingDiagnostics?: RankingPoolDiagnostics;
      researchScoredTop?: ResearchScoredRow[];
    };
  }> {
    const { withQuotes, adtvMap, config } = input;
    const ranking = config.ranking;
    const symbols = withQuotes.map((w) => w.stock.symbol);
    const swingLb = ranking.rsLbSwing;
    const closeLookback = ranking.bhavLookbackSessions;
    const rankStartedMs = Date.now();

    // Cheap closes from bhav for sector RS + advance/decline (simple-return units)
    this.logger.log(
      `Ranking stage: loading bhav close series for ${symbols.length} symbol(s) lookback=${closeLookback}…`,
    );
    const closeMap = await this.nse.getCloseSeriesMap(symbols, closeLookback);
    this.logger.log(
      `Ranking stage: close series ready mapSize=${closeMap.size}/${symbols.length} (${Date.now() - rankStartedMs}ms)`,
    );
    if (closeMap.size === 0 && symbols.length > 0) {
      this.logger.error(
        `Close series empty for ${symbols.length} liquid symbols (lookback=${closeLookback}); check trade_date key normalization`,
      );
    }

    // Sector enrichment for liquid set (IST-day cached)
    this.logger.log(
      `Ranking stage: Yahoo sector enrichment for ${symbols.length} liquid symbol(s)…`,
    );
    const enrichStartedMs = Date.now();
    const enrichmentBySymbol = await mapPool(symbols, 8, (symbol) =>
      this.yahoo.getEnrichment(symbol),
    );
    this.logger.log(
      `Ranking stage: sector enrichment done (${Date.now() - enrichStartedMs}ms)`,
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
        const r5 = simpleReturn(closes, 5);
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

    // Sector membership + cheap simple returns for ALL liquid (Stage 2)
    const sectorMembers = withQuotes.map(({ stock }) => {
      const closes = closeMap.get(stock.symbol) ?? [];
      return {
        symbol: stock.symbol,
        sector: resolveSector(stock.symbol, stock.sector),
        return20: simpleReturn(closes, swingLb),
        return5: simpleReturn(closes, Math.min(5, swingLb)),
        closes,
      };
    });

    const return20Count = sectorMembers.filter((m) => m.return20 != null).length;
    const return20Coverage =
      sectorMembers.length > 0 ? return20Count / sectorMembers.length : 0;
    this.logger.log(
      `Ranking return20 coverage=${(return20Coverage * 100).toFixed(1)}% (${return20Count}/${sectorMembers.length}); bhavLookback=${closeLookback} need≥${swingLb + 1}`,
    );

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

    const gate = gateRankingDeepPool({
      members: sectorMembers,
      eligibleSectors,
      config: ranking,
    });

    this.logger.log(
      `Ranking pool gate: ok=${gate.ok} deep=${gate.diagnostics.deepPoolSize} inSector=${gate.diagnostics.inSectorCount} outside=${gate.diagnostics.outsideCount} first=${gate.diagnostics.deepPoolFirst} last=${gate.diagnostics.deepPoolLast} fallbackUsed=${gate.diagnostics.fallbackUsed}${gate.diagnostics.failReason ? ` reason=${gate.diagnostics.failReason}` : ''}`,
    );

    if (!gate.ok) {
      return {
        priorityShortlist: [],
        meta: {
          liquidBreadth,
          poolSize: 0,
          eligibleSectors,
          rankingDiagnostics: gate.diagnostics,
          researchScoredTop: [],
        },
      };
    }

    const deepSymbols = gate.deepSymbols;

    this.logger.log(
      `Ranking deep-fetch ${deepSymbols.length} symbols (eligible sectors=${eligibleSectors.join(',') || 'none'})…`,
    );
    const deepRankStartedMs = Date.now();

    const historyBySymbol = await mapPool(deepSymbols, 10, (symbol) =>
      this.yahoo.getDailyBars(symbol, 420),
    );
    this.logger.log(
      `Ranking stage: deep bars ready for ${historyBySymbol.size}/${deepSymbols.length} (${Date.now() - deepRankStartedMs}ms)`,
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

    const researchScoredTop: ResearchScoredRow[] = result.allScored
      .slice(0, 100)
      .map((r) => ({
        rank: r.rank,
        symbol: r.symbol,
        sector: r.sector,
        overallScore: r.overallScore,
        relativeStrengthScore: r.relativeStrengthScore,
        trendScore: r.trendScore,
        nearHighScore: r.nearHighScore,
        persistenceScore: r.persistenceScore,
        sectorScore: r.sectorScore,
        volumeScore: r.volumeScore,
        isWildcard: r.isWildcard,
        reasons: r.reasons,
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
        rankingDiagnostics: {
          ...gate.diagnostics,
          eligibleSectors: result.eligibleSectors,
        },
        researchScoredTop,
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
      rankingDiagnostics?: RankingPoolDiagnostics;
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
      rankingDiagnostics: researchMeta.rankingDiagnostics,
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
