import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { And, In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { AccountService } from '../account/account.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { OpenAiService } from '../ai/openai.service';
import { loadRecommendationConfig } from '../config/recommendation.config';
import { moneyString, priceString, roundMoney, toNumber } from '../common/money';
import {
  RecommendationItem,
  RecommendationRun,
  Trade,
} from '../database/entities';
import {
  RecommendationItemRole,
  RecommendationRunStatus,
  TradeStatus,
} from '../database/enums';
import type { SuggestedLevels } from '../market/features/candidate.types';
import { MarketFeatureEngine } from '../market/features/market-feature.engine';
import {
  getMarketSession,
  isSameIstTradingDay,
  istDateKey,
} from '../market/market-clock';
import { normalizeNseSymbol } from '../market/symbols';
import { AddRecommendationItemDto } from './dtos/add-recommendation-item.dto';
import { UpdateRecommendationDto } from './dtos/update-recommendation.dto';
import { ManageHoldingsService } from './manage-holdings.service';
import { CandidateQuote, normalizePicks } from './pick-validator';

/** Manual + AI plan size soft cap (matches AI pick limit). */
const MAX_PLAN_ITEMS = 5;

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private readonly accounts: AccountService,
    private readonly openai: OpenAiService,
    private readonly features: MarketFeatureEngine,
    private readonly holdings: ManageHoldingsService,
    private readonly activityLogs: ActivityLogsService,
    @InjectRepository(RecommendationRun)
    private readonly runs: Repository<RecommendationRun>,
    @InjectRepository(RecommendationItem)
    private readonly items: Repository<RecommendationItem>,
    @InjectRepository(Trade)
    private readonly trades: Repository<Trade>,
  ) {}

  async listRecommendations(userId: string, limit = 50) {
    const account = await this.accounts.getAccountForUser(userId);
    const take = Math.min(100, Math.max(1, Math.floor(limit)));
    const runs = await this.runs.find({
      where: { accountId: account.id },
      relations: ['items', 'executionSessions'],
      order: { createdAt: 'DESC' },
      take,
    });
    // Demote any EXECUTABLE from a prior IST day so history stays accurate.
    for (const run of runs) {
      if (
        run.status === RecommendationRunStatus.EXECUTABLE &&
        !isSameIstTradingDay(new Date(run.marketTs))
      ) {
        run.status = RecommendationRunStatus.PENDING;
        await this.runs.save(run);
      }
    }
    return runs.map((run) => this.toHistoryDto(run));
  }

  async getRecommendation(userId: string, runId: string) {
    const account = await this.accounts.getAccountForUser(userId);
    const run = await this.runs.findOne({
      where: { id: runId, accountId: account.id },
      relations: ['items', 'executionSessions'],
    });
    if (!run) {
      throw new NotFoundException(`Recommendation ${runId} not found`);
    }
    return this.toDetailDto(run);
  }

  /** Current Executable plan for the account (full customize payload), if any. */
  async getExecutablePlan(userId: string) {
    const account = await this.accounts.getAccountForUser(userId);
    const run = await this.runs.findOne({
      where: {
        accountId: account.id,
        status: RecommendationRunStatus.EXECUTABLE,
      },
      relations: ['items', 'executionSessions'],
      order: { createdAt: 'DESC' },
    });
    if (!run) {
      return { plan: null as null };
    }
    if (!isSameIstTradingDay(new Date(run.marketTs))) {
      // Stale executable from a prior session — demote so UI stays clean.
      run.status = RecommendationRunStatus.PENDING;
      await this.runs.save(run);
      return { plan: null as null };
    }
    return { plan: this.toDetailDto(run) };
  }

  /**
   * Mark a today's PENDING plan as the sole EXECUTABLE (customizable) plan.
   * Previous EXECUTABLE for this account becomes PENDING again.
   */
  async markExecutablePlan(userId: string, runId: string) {
    const account = await this.accounts.getAccountForUser(userId);
    const run = await this.runs.findOne({
      where: { id: runId, accountId: account.id },
      relations: ['items', 'executionSessions'],
    });
    if (!run) {
      throw new NotFoundException(`Recommendation ${runId} not found`);
    }
    if (!isSameIstTradingDay(new Date(run.marketTs))) {
      throw new BadRequestException(
        'Only plans from today\'s IST trading day can be marked Executable',
      );
    }
    if (
      run.status !== RecommendationRunStatus.PENDING &&
      run.status !== RecommendationRunStatus.EXECUTABLE
    ) {
      throw new BadRequestException(
        `Recommendation ${runId} is ${run.status}; only PENDING plans can be marked Executable`,
      );
    }

    await this.promoteToExecutable(account.id, run);
    const fresh = await this.runs.findOne({
      where: { id: run.id },
      relations: ['items', 'executionSessions'],
    });
    return this.toDetailDto(fresh!);
  }

  async createRecommendation(userId: string) {
    const account = await this.accounts.getAccountForUser(userId);
    const marketTs = new Date();
    const marketSession = getMarketSession(marketTs);
    const availableCash = toNumber(account.cash);
    const config = loadRecommendationConfig();
    const startedMs = Date.now();

    this.logger.log(
      `Recommendation start user=${userId.slice(0, 8)}… session=${marketSession} cash=${availableCash} mode=${config.ranking.shortlistMode}`,
    );
    await this.activityLogs.append({
      accountId: account.id,
      category: 'RECOMMENDATION',
      eventCode: 'REC_START',
      message: `Recommendation run start at ${marketTs.toISOString()} (session=${marketSession}, cash=₹${availableCash.toLocaleString('en-IN')})`,
    });

    await this.assertUnderDailyLimit(account.id, config.maxRecommendationsPerDay);

    this.logger.log('Recommendation stage: building market board…');
    const [board, openTrades] = await Promise.all([
      this.features.buildBoard(config),
      this.trades.find({
        where: [
          { accountId: account.id, status: TradeStatus.OPEN },
          { accountId: account.id, status: TradeStatus.NEEDS_REVIEW },
        ],
      }),
    ]);
    this.logger.log(
      `Recommendation stage: board ready in ${Date.now() - startedMs}ms · openLots=${openTrades.length}`,
    );
    const funnel = board.pipelineFunnel;
    await this.activityLogs.append({
      accountId: account.id,
      category: 'RECOMMENDATION',
      eventCode: 'REC_UNIVERSE',
      message: `Universe created: ${funnel.universe} symbols (${funnel.universeProvider ?? 'nse'})`,
      meta: { universe: funnel.universe },
    });
    const illiquidFiltered =
      (funnel.liquidRejected ?? Math.max(0, funnel.universe - (funnel.liquidEligible ?? 0)));
    await this.activityLogs.append({
      accountId: account.id,
      category: 'RECOMMENDATION',
      eventCode: 'REC_LIQUID_FILTER',
      message: `Filtered ${illiquidFiltered} illiquid stocks → liquid ${funnel.liquidEligible ?? 0}`,
      meta: { illiquidFiltered, liquid: funnel.liquidEligible },
    });
    await this.activityLogs.append({
      accountId: account.id,
      category: 'RECOMMENDATION',
      eventCode: 'REC_QUOTE_POOL',
      message: `Filtered to research/priority pool ${
        funnel.researchPool ?? funnel.prioritized ?? funnel.quotesOk
      } (quotes ok ${funnel.quotesOk}, failed ${funnel.quotesFailed})`,
      meta: {
        quotesOk: funnel.quotesOk,
        quotesFailed: funnel.quotesFailed,
        prioritized: funnel.prioritized,
        researchPool: funnel.researchPool,
      },
    });
    await this.activityLogs.append({
      accountId: account.id,
      category: 'RECOMMENDATION',
      eventCode: 'REC_TOP40',
      message: `Filtered to Top ${board.priorityShortlist.length}: ${board.priorityShortlist.map((c) => c.symbol).join(', ') || '—'}`,
      meta: { symbols: board.priorityShortlist.map((c) => c.symbol) },
    });

    // Manage OPEN lots first (code-owned levels). AI then sees updated exits.
    this.logger.log('Recommendation stage: managing open holdings…');
    const holdingsManagement = await this.holdings.retargetOpenHoldings({
      openTrades,
      board,
      config,
    });
    const openHoldings = openTrades.map((trade) => ({
      symbol: trade.symbol,
      qty: trade.qty,
      buyPrice: toNumber(trade.buyPrice ?? '0'),
      sellTarget: toNumber(trade.sellTarget),
      stopLoss: toNumber(trade.stopLoss),
      status: trade.status,
    }));

    const aiCandidates = this.features.toAiCandidates(board, config);
    board.pipelineFunnel.sentToAi = aiCandidates.length;
    board.pipelineFunnel.summary = [
      `universe ${board.pipelineFunnel.universe}(${board.pipelineFunnel.universeProvider})`,
      `liquid ${board.pipelineFunnel.liquidEligible}`,
      `quotes ${board.pipelineFunnel.quotesOk}`,
      `priority ${board.pipelineFunnel.prioritized}`,
      `deep ${board.pipelineFunnel.featureReady}`,
      `→ AI ${board.pipelineFunnel.sentToAi}`,
      board.pipelineFunnel.freshness,
    ].join(' · ');

    const levelsBySymbol = new Map<string, SuggestedLevels>();
    const buyableSymbols = new Set<string>();
    for (const c of board.candidates) {
      if (c.candidateStatus === 'BUYABLE' && c.suggestedLevels) {
        levelsBySymbol.set(c.symbol, c.suggestedLevels);
        buyableSymbols.add(c.symbol);
      }
    }

    const cashTooSmallForNewPicks =
      availableCash < config.minDeployCashInr;

    this.logger.log(
      `Building recommendations at ${marketTs.toISOString()} session=${marketSession} cash=${availableCash} | ${board.pipelineFunnel.summary}${
        cashTooSmallForNewPicks
          ? ` | skip new picks (cash < ₹${config.minDeployCashInr})`
          : ''
      }`,
    );

    let model = 'none';
    let response: Awaited<
      ReturnType<OpenAiService['createRecommendationPlan']>
    >['response'] = {
      marketRegime: 'UNCERTAIN',
      confidence: 'LOW',
      portfolioStrategy: {
        style: 'DEFENSIVE',
        targetPositions: 0,
        cashReservePercent: 100,
        hedge: false,
        reason: cashTooSmallForNewPicks
          ? `availableCash ₹${availableCash} below minDeployCashInr ₹${config.minDeployCashInr}; holdings managed only.`
          : 'No plan',
      },
      portfolioSummary: cashTooSmallForNewPicks
        ? `Only ₹${availableCash.toLocaleString('en-IN')} cash is free. New buys need at least ₹${config.minDeployCashInr.toLocaleString('en-IN')}. Existing open holdings were still checked for updated targets and stops; no new stocks were suggested.`
        : '',
      cashReservedInr: availableCash,
      totalAllocatedInr: 0,
      picks: [],
      rejectedCandidates: [],
    };
    let aiMetadata: Awaited<
      ReturnType<OpenAiService['createRecommendationPlan']>
    >['aiMetadata'] = {
      model: 'none',
      promptVersion: config.promptVersion,
      temperature: null,
      tokensPrompt: null,
      tokensCompletion: null,
      costUsd: null,
      provider: 'none',
    };
    let promptHash = '';
    let userPrompt = '';

    if (!cashTooSmallForNewPicks) {
      this.logger.log(
        `Recommendation stage: calling AI with ${aiCandidates.length} candidate(s)…`,
      );
      const sentNames = aiCandidates.map((c: { symbol: string }) => c.symbol);
      await this.activityLogs.append({
        accountId: account.id,
        category: 'RECOMMENDATION',
        eventCode: 'REC_SENT_AI',
        message: `Sent to AI — ${sentNames.length}: ${sentNames.join(', ') || '—'}`,
        meta: { symbols: sentNames },
      });
      const aiStartedMs = Date.now();
      const plan = await this.openai.createRecommendationPlan({
        marketTs: marketTs.toISOString(),
        marketSession,
        availableCash,
        openHoldings,
        marketContext: board.marketContext,
        candidates: aiCandidates,
        versions: board.versions,
        rules: config,
      });
      model = plan.model;
      response = plan.response;
      aiMetadata = plan.aiMetadata;
      promptHash = plan.promptHash;
      userPrompt = plan.userPrompt;
      this.logger.log(
        `Recommendation stage: AI done in ${Date.now() - aiStartedMs}ms model=${model} picks=${response.picks?.length ?? 0}`,
      );
      const aiPickLines = (response.picks ?? []).map(
        (p) =>
          `${p.symbol} (${p.investRatioPct ?? '?'}%: ${p.summary?.trim() || 'selected'})`,
      );
      await this.activityLogs.append({
        accountId: account.id,
        category: 'RECOMMENDATION',
        eventCode: 'REC_AI_PROPOSED',
        message: `Proposed by AI — ${response.picks?.length ?? 0}: ${aiPickLines.join(' | ') || '—'}`,
        meta: {
          picks: (response.picks ?? []).map((p) => ({
            symbol: p.symbol,
            investRatioPct: p.investRatioPct ?? null,
            summary: p.summary,
          })),
        },
      });
    } else {
      this.logger.log(
        `Recommendation stage: skip AI (cash ₹${availableCash} < min ₹${config.minDeployCashInr})`,
      );
      board.pipelineFunnel.sentToAi = 0;
      board.pipelineFunnel.summary = [
        board.pipelineFunnel.summary.replace(/→ AI \d+/, '→ AI 0'),
        `cash dust < ₹${config.minDeployCashInr}`,
      ].join(' · ');
      await this.activityLogs.append({
        accountId: account.id,
        category: 'RECOMMENDATION',
        eventCode: 'REC_SENT_AI',
        message: `Sent to AI — 0 (skipped: cash ₹${availableCash.toLocaleString('en-IN')} < min ₹${config.minDeployCashInr.toLocaleString('en-IN')})`,
        meta: { symbols: [], skipped: true },
      });
      await this.activityLogs.append({
        accountId: account.id,
        category: 'RECOMMENDATION',
        eventCode: 'REC_AI_PROPOSED',
        message: 'Proposed by AI — 0: —',
        meta: { picks: [] },
      });
    }

    // Belt: overwrite AI prices with suggestedLevels before validation
    const leveledPicks = (response.picks ?? []).map((pick) => {
      const symbol = pick.symbol?.trim().toUpperCase().replace(/\.NS$/i, '');
      const levels = symbol ? levelsBySymbol.get(symbol) : undefined;
      if (!levels) {
        return pick;
      }
      return {
        ...pick,
        buyLow: levels.buyLow,
        buyHigh: levels.buyHigh,
        stopLoss: levels.stopLoss,
        sellTarget: levels.sellTarget,
      };
    });

    const quotesBySymbol = new Map<string, CandidateQuote>();
    for (const c of board.candidates) {
      quotesBySymbol.set(c.symbol, {
        symbol: c.symbol,
        price: c.quote.price,
        volume: c.quote.volume,
        sector: c.sector,
      });
    }

    const { picks, rejected: validatorRejected } = normalizePicks(
      leveledPicks,
      availableCash,
      buyableSymbols,
      quotesBySymbol,
      { config, levelsBySymbol },
    );

    await this.activityLogs.append({
      accountId: account.id,
      category: 'RECOMMENDATION',
      eventCode: 'REC_VALIDATED',
      message: `Validated: kept ${picks.length} [${picks.map((p) => p.symbol).join(', ') || '—'}] · removed ${validatorRejected.length}${
        validatorRejected.length
          ? ` [${validatorRejected.map((r) => `${r.symbol}: ${r.reason}`).join(' | ')}]`
          : ''
      }`,
      meta: {
        kept: picks.map((p) => p.symbol),
        removed: validatorRejected,
      },
    });

    const totalAllocated = roundMoney(
      picks.reduce((sum, pick) => sum + pick.allocationInr, 0),
    );
    const cashReserved = roundMoney(
      Math.max(0, availableCash - totalAllocated),
    );

    const portfolioStrategy = response.portfolioStrategy
      ? {
          style: response.portfolioStrategy.style,
          targetPositions: response.portfolioStrategy.targetPositions,
          cashReservePercent: response.portfolioStrategy.cashReservePercent,
          hedge: response.portfolioStrategy.hedge,
          reason: response.portfolioStrategy.reason?.trim() || '',
        }
      : null;

    const aiRejected = (response.rejectedCandidates ?? [])
      .filter(
        (r) =>
          typeof r?.symbol === 'string' &&
          r.symbol.trim() &&
          typeof r?.reason === 'string' &&
          r.reason.trim(),
      )
      .map((r) => ({
        symbol: r.symbol.trim().toUpperCase().replace(/\.NS$/i, ''),
        reason: r.reason.trim(),
      }));

    const rejectedCandidates = [
      ...validatorRejected.map((r) => ({
        symbol: r.symbol,
        reason: `Validator: ${r.reason}`,
      })),
      ...aiRejected.filter(
        (r) => !validatorRejected.some((v) => v.symbol === r.symbol),
      ),
    ].slice(0, 8);

    let portfolioSummaryText =
      response.portfolioSummary?.trim() ||
      (picks.length === 0
        ? 'No high-conviction trades; cash reserved.'
        : '');
    if (validatorRejected.length > 0) {
      const dropped = validatorRejected
        .map((r) => `${r.symbol} (${r.reason})`)
        .join('; ');
      portfolioSummaryText = [
        portfolioSummaryText,
        `Validator removed ${validatorRejected.length} AI pick(s): ${dropped}. Allocations/cash below reflect the surviving book.`,
      ]
        .filter(Boolean)
        .join('\n\n');
    }

    const pipelineFunnel = {
      ...board.pipelineFunnel,
      sentToAi: aiCandidates.length,
      aiPicksProposed: (response.picks ?? []).length,
      validatorAccepted: picks.length,
      validatorRejected: validatorRejected.length,
      summary: [
        board.pipelineFunnel.summary,
        `AI proposed ${(response.picks ?? []).length}`,
        `validator kept ${picks.length}`,
      ].join(' · '),
    };

    const contextSnapshot = {
      versions: board.versions,
      config,
      strategyProfile: board.strategyProfile,
      marketTs: marketTs.toISOString(),
      marketSession,
      availableCash,
      openHoldings,
      holdingsManagement,
      marketContext: board.marketContext,
      candidateSnapshot: board.candidates,
      eligibilityRejected: board.eligibilityRejected,
      priorityShortlist: board.priorityShortlist,
      shortlistOutcomes: board.shortlistOutcomes,
      researchScoredTop: board.researchScoredTop ?? [],
      rankingDiagnostics: board.rankingDiagnostics ?? null,
      pipelineFunnel,
      aiPayloadNote: config.aiIncludeExtendedTechnical
        ? 'includes technicalExtended'
        : 'technicalExtended omitted from AI payload',
      promptHash,
      ...(config.storeFullAiPrompt ? { aiPrompt: userPrompt } : {}),
      validator: {
        accepted: picks.map((p) => p.symbol),
        rejected: validatorRejected,
      },
    };

    const run = this.runs.create({
      accountId: account.id,
      status: RecommendationRunStatus.PENDING,
      marketTs,
      marketSession,
      availableCash: moneyString(availableCash),
      portfolioSummary: portfolioSummaryText,
      marketRegime: response.marketRegime ?? null,
      confidence: response.confidence ?? null,
      portfolioStrategy,
      totalAllocatedInr: moneyString(totalAllocated),
      cashReservedInr: moneyString(cashReserved),
      contextSnapshot,
      aiRaw: {
        response,
        aiMetadata,
        promptHash,
      } as unknown as Record<string, unknown>,
      model,
    });

    const savedRun = await this.runs.save(run);
    const savedItems =
      picks.length === 0
        ? []
        : await this.items.save(
            picks.map((pick, index) =>
              this.items.create({
                recommendationRunId: savedRun.id,
                symbol: pick.symbol,
                qty: pick.qty,
                allocationInr: moneyString(pick.allocationInr),
                buyLow: priceString(pick.buyLow),
                buyHigh: priceString(pick.buyHigh),
                sellTarget: priceString(pick.sellTarget),
                stopLoss: priceString(pick.stopLoss),
                role: pick.role as RecommendationItemRole,
                summary: pick.summary,
                sortOrder: index,
              }),
            ),
          );

    // New generate becomes the sole Executable (customizable) plan.
    savedRun.items = savedItems;
    await this.promoteToExecutable(account.id, savedRun);

    this.logger.log(
      `Recommendation ${savedRun.id}: ${pipelineFunnel.summary} | allocated=${totalAllocated} reserved=${cashReserved} | holdingsUpdated=${holdingsManagement.filter((h) => h.changed).length} | total=${Date.now() - startedMs}ms`,
    );
    await this.activityLogs.append({
      accountId: account.id,
      category: 'RECOMMENDATION',
      eventCode: 'REC_END',
      message: `Recommendation run ends (${savedRun.id}) · allocated ₹${totalAllocated.toLocaleString('en-IN')} · ${Date.now() - startedMs}ms`,
      refId: savedRun.id,
      meta: { allocated: totalAllocated, reserved: cashReserved },
    });

    const fresh = await this.runs.findOne({
      where: { id: savedRun.id },
      relations: ['items', 'executionSessions'],
    });
    const detail = this.toDetailDto(fresh!);
    return {
      ...detail,
      holdingsManagement,
      rejectedCandidates,
      minDeployCashInr: config.minDeployCashInr,
      skipNewBuysReason: cashTooSmallForNewPicks
        ? ('LOW_CASH' as const)
        : null,
    };
  }

  /**
   * Add a BUYABLE shortlist name into the Executable plan (user override of AI).
   * Levels are copied from the run's stored shortlist outcomes — never invented.
   */
  async addBuyableItem(
    userId: string,
    runId: string,
    dto: AddRecommendationItemDto,
  ) {
    const account = await this.accounts.getAccountForUser(userId);
    const run = await this.runs.findOne({
      where: { id: runId, accountId: account.id },
      relations: ['items'],
    });
    if (!run) {
      throw new NotFoundException(`Recommendation ${runId} not found`);
    }
    if (run.status !== RecommendationRunStatus.EXECUTABLE) {
      throw new BadRequestException(
        `Recommendation ${runId} is ${run.status}; only the Executable plan can be edited`,
      );
    }

    const symbol = normalizeNseSymbol(dto.symbol);
    if (!symbol) {
      throw new BadRequestException('Invalid symbol');
    }

    const existing = [...(run.items ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    if (existing.some((i) => i.symbol === symbol)) {
      throw new BadRequestException(`${symbol} is already on the buy list`);
    }
    if (existing.length >= MAX_PLAN_ITEMS) {
      throw new BadRequestException(
        `Buy list already has ${MAX_PLAN_ITEMS} names (maximum)`,
      );
    }

    const snap = (run.contextSnapshot ?? {}) as {
      shortlistOutcomes?: Array<{
        symbol: string;
        status: string;
        buyLow?: number;
        buyHigh?: number;
        sellTarget?: number;
        stopLoss?: number;
      }>;
      candidateSnapshot?: Array<{ symbol: string; sector?: string }>;
    };
    const outcome = (snap.shortlistOutcomes ?? []).find(
      (o) => o.symbol === symbol && o.status === 'BUYABLE',
    );
    if (
      !outcome ||
      outcome.buyLow == null ||
      outcome.buyHigh == null ||
      outcome.sellTarget == null ||
      outcome.stopLoss == null
    ) {
      throw new BadRequestException(
        `${symbol} is not in today's Buyable shortlist with a full trade plan`,
      );
    }

    const buyLow = Number(outcome.buyLow);
    const buyHigh = Number(outcome.buyHigh);
    const sellTarget = Number(outcome.sellTarget);
    const stopLoss = Number(outcome.stopLoss);
    if (
      !(
        stopLoss < buyLow &&
        buyLow < buyHigh &&
        buyHigh < sellTarget &&
        buyHigh > 0
      )
    ) {
      throw new BadRequestException(
        `${symbol}: stored levels failed geometry checks`,
      );
    }

    const config = loadRecommendationConfig();
    const availableCash = toNumber(run.availableCash);
    const alreadyAllocated = roundMoney(
      existing.reduce((sum, i) => sum + toNumber(i.allocationInr), 0),
    );
    const remaining = roundMoney(availableCash - alreadyAllocated);
    const maxAlloc = roundMoney(availableCash * config.maxAllocPct);
    const minAlloc = roundMoney(availableCash * config.minAllocPct);
    const budget = Math.min(remaining, maxAlloc);
    const qty = Math.floor(budget / buyHigh);
    if (qty < 1) {
      throw new BadRequestException(
        `Not enough free cash to add ${symbol} (need at least ~₹${buyHigh.toFixed(2)} for 1 share under caps)`,
      );
    }
    let allocation = roundMoney(qty * buyHigh);
    if (allocation < minAlloc) {
      throw new BadRequestException(
        `${symbol}: sized allocation ₹${allocation} is below the ${config.minAllocPct * 100}% minimum (₹${minAlloc})`,
      );
    }

    const sector =
      (snap.candidateSnapshot ?? []).find((c) => c.symbol === symbol)?.sector ??
      'Unknown';
    const sectorCount = existing.filter((i) => {
      const s =
        (snap.candidateSnapshot ?? []).find((c) => c.symbol === i.symbol)
          ?.sector ?? 'Unknown';
      return s === sector;
    }).length;
    if (sectorCount >= config.maxPerSector) {
      throw new BadRequestException(
        `Already have ${config.maxPerSector} name(s) in sector ${sector}`,
      );
    }

    const created = await this.items.save(
      this.items.create({
        recommendationRunId: run.id,
        symbol,
        qty,
        allocationInr: moneyString(allocation),
        buyLow: priceString(buyLow),
        buyHigh: priceString(buyHigh),
        sellTarget: priceString(sellTarget),
        stopLoss: priceString(stopLoss),
        role: RecommendationItemRole.PRIMARY,
        summary: `Added from Buyable shortlist (${symbol}).`,
        sortOrder: existing.length,
      }),
    );

    const totalAllocated = roundMoney(alreadyAllocated + allocation);
    run.totalAllocatedInr = moneyString(totalAllocated);
    run.cashReservedInr = moneyString(
      Math.max(0, availableCash - totalAllocated),
    );
    await this.runs.save(run);

    this.logger.log(
      `Recommendation ${run.id}: added buyable ${symbol} qty=${qty} alloc=${allocation}`,
    );

    const fresh = await this.runs.findOne({
      where: { id: run.id },
      relations: ['items', 'executionSessions'],
    });
    return this.toDetailDto(fresh!);
  }

  /**
   * Replace editable fields on the Executable run. Items omitted from the payload
   * are removed (drop a stock from the plan). New symbols cannot be added here
   * — use addBuyableItem for Buyable shortlist adds.
   */
  async updateRecommendation(
    userId: string,
    runId: string,
    dto: UpdateRecommendationDto,
  ) {
    const account = await this.accounts.getAccountForUser(userId);
    const run = await this.runs.findOne({
      where: { id: runId, accountId: account.id },
    });
    if (!run) {
      throw new NotFoundException(`Recommendation ${runId} not found`);
    }
    if (run.status !== RecommendationRunStatus.EXECUTABLE) {
      throw new BadRequestException(
        `Recommendation ${runId} is ${run.status}; only the Executable plan can be edited`,
      );
    }

    const existing = await this.items.find({
      where: { recommendationRunId: run.id },
    });
    const byId = new Map(existing.map((item) => [item.id, item]));

    const seen = new Set<string>();
    let totalAllocated = 0;
    const availableCash = toNumber(run.availableCash);

    for (const patch of dto.items) {
      if (seen.has(patch.id)) {
        throw new BadRequestException(`Duplicate item id ${patch.id}`);
      }
      seen.add(patch.id);

      const item = byId.get(patch.id);
      if (!item) {
        throw new BadRequestException(
          `Item ${patch.id} is not part of recommendation ${runId}`,
        );
      }

      if (patch.buyLow > patch.buyHigh) {
        throw new BadRequestException(
          `${item.symbol}: buyLow must be <= buyHigh`,
        );
      }
      if (patch.stopLoss >= patch.buyLow) {
        throw new BadRequestException(
          `${item.symbol}: stopLoss must be below buyLow`,
        );
      }
      if (patch.sellTarget <= patch.buyHigh) {
        throw new BadRequestException(
          `${item.symbol}: sellTarget must be above buyHigh`,
        );
      }

      const qty = Math.floor(patch.qty);
      if (qty < 1) {
        throw new BadRequestException(`${item.symbol}: qty must be >= 1`);
      }

      const allocation = roundMoney(patch.allocationInr);
      totalAllocated = roundMoney(totalAllocated + allocation);

      item.qty = qty;
      item.allocationInr = moneyString(allocation);
      item.buyLow = priceString(patch.buyLow);
      item.buyHigh = priceString(patch.buyHigh);
      item.sellTarget = priceString(patch.sellTarget);
      item.stopLoss = priceString(patch.stopLoss);
    }

    if (totalAllocated > availableCash + 0.01) {
      throw new BadRequestException(
        `Total allocation ₹${totalAllocated} exceeds available cash ₹${availableCash}`,
      );
    }

    const keepIds = [...seen];
    const toRemove = existing.filter((item) => !seen.has(item.id));
    if (toRemove.length > 0) {
      await this.items.delete({
        id: In(toRemove.map((item) => item.id)),
      });
    }

    const toSave = keepIds.map((id, index) => {
      const item = byId.get(id)!;
      item.sortOrder = index;
      return item;
    });
    const savedItems = await this.items.save(toSave);

    const cashReserved = roundMoney(
      Math.max(0, availableCash - totalAllocated),
    );
    run.totalAllocatedInr = moneyString(totalAllocated);
    run.cashReservedInr = moneyString(cashReserved);
    const savedRun = await this.runs.save(run);

    this.logger.log(
      `Recommendation ${run.id} edited: items=${savedItems.length} removed=${toRemove.length} allocated=${totalAllocated}`,
    );

    const fresh = await this.runs.findOne({
      where: { id: savedRun.id },
      relations: ['items', 'executionSessions'],
    });
    return this.toDetailDto(fresh!);
  }

  private async promoteToExecutable(
    accountId: string,
    run: RecommendationRun,
  ): Promise<void> {
    await this.runs
      .createQueryBuilder()
      .update(RecommendationRun)
      .set({ status: RecommendationRunStatus.PENDING })
      .where('account_id = :accountId', { accountId })
      .andWhere('status = :status', {
        status: RecommendationRunStatus.EXECUTABLE,
      })
      .andWhere('id != :runId', { runId: run.id })
      .execute();

    if (run.status !== RecommendationRunStatus.EXECUTABLE) {
      run.status = RecommendationRunStatus.EXECUTABLE;
      await this.runs.save(run);
    }
  }

  /** Full customize payload reconstructed from contextSnapshot + items. */
  private toDetailDto(run: RecommendationRun) {
    const items = [...(run.items ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    const snap = (run.contextSnapshot ?? {}) as {
      shortlistOutcomes?: Array<{
        symbol: string;
        status: 'BUYABLE' | 'WATCH' | 'RED';
        reasonCode?: string;
        reason: string | null;
        buyLow?: number;
        buyHigh?: number;
        sellTarget?: number;
        stopLoss?: number;
        riskReward?: number;
        setupType?: string;
      }>;
      priorityShortlist?: Array<{ symbol: string }>;
      pipelineFunnel?: {
        prioritized?: number;
        featureReady?: number;
        [key: string]: unknown;
      };
      validator?: { rejected?: Array<{ symbol: string; reason: string }> };
    };
    const aiRaw = (run.aiRaw ?? {}) as {
      response?: { rejectedCandidates?: Array<{ symbol: string; reason: string }> };
    };
    const cashBlocked = false;
    const shortlistPayload = buildShortlistOutcomePayload(
      {
        priorityShortlist: snap.priorityShortlist ?? [],
        shortlistOutcomes: snap.shortlistOutcomes ?? [],
        pipelineFunnel: snap.pipelineFunnel ?? {},
      },
      cashBlocked,
    );
    const rejectedCandidates =
      aiRaw.response?.rejectedCandidates ??
      snap.validator?.rejected ??
      [];

    return {
      id: run.id,
      status: run.status,
      createdAt: run.createdAt,
      marketTs: run.marketTs,
      marketSession: run.marketSession,
      availableCash: toNumber(run.availableCash),
      totalAllocatedInr: toNumber(run.totalAllocatedInr),
      cashReservedInr: toNumber(run.cashReservedInr),
      portfolioSummary: run.portfolioSummary,
      marketRegime: run.marketRegime,
      confidence: run.confidence,
      portfolioStrategy: run.portfolioStrategy,
      model: run.model,
      pipelineFunnel: snap.pipelineFunnel,
      rejectedCandidates,
      isExecutablePlan: run.status === RecommendationRunStatus.EXECUTABLE,
      canMarkExecutable: false,
      ...shortlistPayload,
      items: items.map((item, index) => ({
        id: item.id,
        symbol: item.symbol,
        qty: item.qty,
        allocationInr: toNumber(item.allocationInr),
        buyLow: toNumber(item.buyLow),
        buyHigh: toNumber(item.buyHigh),
        sellTarget: toNumber(item.sellTarget),
        stopLoss: toNumber(item.stopLoss),
        role: item.role,
        summary: item.summary,
        convictionRank:
          (Number.isFinite(item.sortOrder) ? item.sortOrder : index) + 1,
      })),
    };
  }

  private toHistoryDto(run: RecommendationRun) {
    const items = [...(run.items ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    const sessions = run.executionSessions ?? [];
    const executed = sessions.length > 0;
    const bought =
      executed ||
      run.status === RecommendationRunStatus.EXECUTING ||
      run.status === RecommendationRunStatus.COMPLETED;
    const today = isSameIstTradingDay(new Date(run.marketTs));
    const isExecutablePlan =
      run.status === RecommendationRunStatus.EXECUTABLE;
    const canMarkExecutable =
      today && run.status === RecommendationRunStatus.PENDING;

    return {
      id: run.id,
      status: run.status,
      createdAt: run.createdAt,
      marketTs: run.marketTs,
      marketSession: run.marketSession,
      availableCash: toNumber(run.availableCash),
      totalAllocatedInr: toNumber(run.totalAllocatedInr),
      cashReservedInr: toNumber(run.cashReservedInr),
      portfolioSummary: run.portfolioSummary,
      marketRegime: run.marketRegime,
      confidence: run.confidence,
      portfolioStrategy: run.portfolioStrategy,
      model: run.model,
      bought,
      boughtLabel: bought ? 'yes' : 'no',
      executionSessionCount: sessions.length,
      isExecutablePlan,
      canMarkExecutable,
      items: items.map((item, index) => ({
        id: item.id,
        symbol: item.symbol,
        qty: item.qty,
        allocationInr: toNumber(item.allocationInr),
        buyLow: toNumber(item.buyLow),
        buyHigh: toNumber(item.buyHigh),
        sellTarget: toNumber(item.sellTarget),
        stopLoss: toNumber(item.stopLoss),
        role: item.role,
        summary: item.summary,
        convictionRank:
          (Number.isFinite(item.sortOrder) ? item.sortOrder : index) + 1,
      })),
    };
  }

  private async assertUnderDailyLimit(
    accountId: string,
    maxPerDay: number,
  ): Promise<void> {
    const { start, end } = istDayBoundsUtc();
    const used = await this.runs.count({
      where: {
        accountId,
        createdAt: And(MoreThanOrEqual(start), LessThan(end)),
      },
    });
    if (used >= maxPerDay) {
      throw new HttpException(
        `Daily recommendation limit reached. Try again tomorrow.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

/** Inclusive start / exclusive end of the current IST calendar day, as UTC Dates. */
function istDayBoundsUtc(now = new Date()): { start: Date; end: Date } {
  const day = istDateKey(now);
  const start = new Date(`${day}T00:00:00+05:30`);
  const end = new Date(`${day}T24:00:00+05:30`);
  return { start, end };
}

function buildShortlistOutcomePayload(
  board: {
    priorityShortlist: Array<{ symbol: string }>;
    shortlistOutcomes: Array<{
      symbol: string;
      status: 'BUYABLE' | 'WATCH' | 'RED';
      reasonCode?: string;
      reason: string | null;
      buyLow?: number;
      buyHigh?: number;
      sellTarget?: number;
      stopLoss?: number;
      riskReward?: number;
      setupType?: string;
    }>;
    pipelineFunnel: { prioritized?: number; featureReady?: number };
  },
  cashBlocked: boolean,
) {
  const outcomes = board.shortlistOutcomes ?? [];
  const buyable = outcomes
    .filter((o) => o.status === 'BUYABLE')
    .map((o) => ({
      symbol: o.symbol,
      buyLow: o.buyLow ?? null,
      buyHigh: o.buyHigh ?? null,
      sellTarget: o.sellTarget ?? null,
      stopLoss: o.stopLoss ?? null,
      riskReward: o.riskReward ?? null,
      setupType: o.setupType ?? null,
    }));
  const watchList = outcomes
    .filter((o) => o.status === 'WATCH')
    .map((o) => ({
      symbol: o.symbol,
      reasonCode: o.reasonCode ?? null,
      reason: humanizeRejectReason(o.reason ?? 'watch'),
      buyLow: o.buyLow ?? null,
      buyHigh: o.buyHigh ?? null,
      sellTarget: o.sellTarget ?? null,
      stopLoss: o.stopLoss ?? null,
      riskReward: o.riskReward ?? null,
      setupType: o.setupType ?? null,
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  const redList = outcomes
    .filter((o) => o.status === 'RED')
    .map((o) => ({
      symbol: o.symbol,
      reasonCode: o.reasonCode ?? null,
      reason: humanizeRejectReason(o.reason ?? 'rejected'),
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  // Backward-compatible aliases: setupRejects = WATCH + RED (not buyable now).
  const setupRejects = [...watchList, ...redList].map((o) => ({
    symbol: o.symbol,
    reason: o.reason,
  }));

  const watchReasonRows = watchList.map((o) => ({
    symbol: o.symbol,
    reason: humanizeReasonCode(o.reasonCode) || o.reason,
  }));
  const redReasonRows = redList.map((o) => ({
    symbol: o.symbol,
    reason: humanizeReasonCode(o.reasonCode) || o.reason,
  }));

  return {
    shortlistedCount:
      board.pipelineFunnel.prioritized ?? board.priorityShortlist.length,
    buyableCount: buyable.length,
    watchCount: watchList.length,
    redCount: redList.length,
    setupRejectCount: setupRejects.length,
    /** Actionable structural plans (pre-AI). Strong ≠ buyable. */
    buyableShortlist: buyable,
    /** Strong names that should not be bought at current levels. */
    watchShortlist: watchList,
    /** Hard rejects (invalid data / history). */
    redShortlist: redList,
    watchReasons: aggregateRejectReasons(watchReasonRows),
    redReasons: aggregateRejectReasons(redReasonRows),
    setupRejectReasons: aggregateRejectReasons(setupRejects),
    setupRejects,
    /** Why AI may not have been asked even if buyableCount > 0. */
    buyableBlockedReason: cashBlocked
      ? ('LOW_CASH' as const)
      : buyable.length === 0
        ? ('NO_BUYABLE_SETUPS' as const)
        : null,
  };
}

function aggregateRejectReasons(
  rejects: Array<{ symbol: string; reason: string }>,
  limit = 12,
): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rejects) {
    const reason = row.reason;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([reason, count]) => ({ reason, count }));
}

function humanizeReasonCode(code: string | null | undefined): string | null {
  if (code == null || !String(code).trim()) return null;
  const key = String(code).trim().toUpperCase();
  const map: Record<string, string> = {
    STOP_TOO_WIDE: 'Stop would risk too much of the position',
    NO_VALID_ENTRY: 'No clear buy zone from chart structure right now',
    ENTRY_TOO_EXTENDED: 'Price already ran past a sensible buy zone',
    TARGET_TOO_CLOSE: 'Upside to next resistance is too small vs risk',
    TARGET_TOO_FAR: 'Target is too far for a 1–5 day swing',
    NO_STRUCTURAL_TARGET: 'No clear sell target from chart structure',
    EXCESSIVE_RISK: 'Risk is too high for this account',
    INVALID_DATA: 'Market data missing or unreliable',
    SPIKE_SUSPECT: 'Price action looks abnormal / spike-like',
    BROKEN_STRUCTURE: 'Chart structure looks broken for a long trade',
    HISTORY_TOO_SHORT: 'Not enough daily history yet',
    NOT_EVALUATED: 'Not fully checked in this run',
    OK: 'Ready to consider',
  };
  return map[key] ?? null;
}

function humanizeRejectReason(raw: string): string {
  const fromCode = humanizeReasonCode(raw);
  if (fromCode) return fromCode;

  const text = raw.trim();
  // Group all "price X < min 20" into one bucket (was flooding the UI as unique lines).
  if (
    /(bhav|live)?\s*price\s+[\d.]+\s*<\s*min\s+[\d.]+/i.test(text) ||
    /price\s+[\d.]+\s*<\s*min\s+[\d.]+/i.test(text)
  ) {
    const min = text.match(/min\s+([\d.]+)/i)?.[1] ?? '20';
    return `Share price below ₹${min} minimum (filtered as too cheap)`;
  }
  if (/history\s+\d+\s*<\s*min\s+\d+/i.test(text)) {
    const min = text.match(/min\s+(\d+)/i)?.[1] ?? '220';
    return `Not enough daily history (need ~${min} sessions; often new listings)`;
  }
  if (/quote fetch failed/i.test(text)) {
    return 'Live quote unavailable';
  }
  if (/missing core technicals/i.test(text)) {
    return 'Missing indicators needed for a valid trade plan';
  }
  if (/ENTRY_TOO_EXTENDED|ENTRY_EXTENDED/i.test(text)) {
    return 'Entry already moved too far (extended)';
  }
  if (/NO_VALID_ENTRY|NO_SETUP|ENTRY_MISSED/i.test(text)) {
    return 'No defensible buy entry from market structure right now';
  }
  if (/STOP_TOO_WIDE|NO_STOP_STRUCTURE|STOP_INSIDE/i.test(text)) {
    return 'Stop geometry unattractive or missing from structure';
  }
  if (/TARGET_TOO_CLOSE|RR_TOO_LOW/i.test(text)) {
    return 'Target/resistance too close for attractive risk/reward';
  }
  if (/TARGET_TOO_FAR/i.test(text)) {
    return 'Target is too far for a 1–5 day swing';
  }
  if (/NO_STRUCTURAL_TARGET|NO_TARGET|TARGET_NOT_ABOVE|TARGET_UNREALISTIC/i.test(
    text,
  )) {
    return 'No structural sell target above entry';
  }
  if (/EXCESSIVE_RISK/i.test(text)) {
    return 'Risk objectively too high';
  }
  if (/INVALID_DATA|INSUFFICIENT_FEATURES/i.test(text)) {
    return 'Invalid or insufficient market data';
  }
  if (/NO_ENTRY|entry/i.test(text) && /tradePlan/i.test(text)) {
    return 'No valid buy entry zone';
  }
  if (/RR|risk.?reward|minTargetRr/i.test(text)) {
    return 'Risk/reward geometry unattractive';
  }
  if (/tradePlan\s+(\w+)/i.test(text)) {
    const code = text.match(/tradePlan\s+(\w+)/i)?.[1] ?? 'INVALID';
    const detail = text.includes(':')
      ? text.slice(text.indexOf(':') + 1).trim()
      : '';
    if (/no setup/i.test(detail)) {
      return 'No pullback/breakout setup on the chart right now';
    }
    return detail
      ? `Setup rejected (${code}): ${detail}`
      : `Setup rejected (${code})`;
  }
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}
