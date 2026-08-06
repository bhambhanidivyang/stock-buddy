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
import { getMarketSession, istDateKey } from '../market/market-clock';
import { UpdateRecommendationDto } from './dtos/update-recommendation.dto';
import { ManageHoldingsService } from './manage-holdings.service';
import { CandidateQuote, normalizePicks } from './pick-validator';

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private readonly accounts: AccountService,
    private readonly openai: OpenAiService,
    private readonly features: MarketFeatureEngine,
    private readonly holdings: ManageHoldingsService,
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
    return this.toHistoryDto(run);
  }

  async createRecommendation(userId: string) {
    const account = await this.accounts.getAccountForUser(userId);
    const marketTs = new Date();
    const marketSession = getMarketSession(marketTs);
    const availableCash = toNumber(account.cash);
    const config = loadRecommendationConfig();

    await this.assertUnderDailyLimit(account.id, config.maxRecommendationsPerDay);

    const [board, openTrades] = await Promise.all([
      this.features.buildBoard(config),
      this.trades.find({
        where: [
          { accountId: account.id, status: TradeStatus.OPEN },
          { accountId: account.id, status: TradeStatus.NEEDS_REVIEW },
        ],
      }),
    ]);

    // Manage OPEN lots first (code-owned levels). AI then sees updated exits.
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
    for (const c of board.candidates) {
      if (c.suggestedLevels) {
        levelsBySymbol.set(c.symbol, c.suggestedLevels);
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
    } else {
      board.pipelineFunnel.sentToAi = 0;
      board.pipelineFunnel.summary = [
        board.pipelineFunnel.summary.replace(/→ AI \d+/, '→ AI 0'),
        `cash dust < ₹${config.minDeployCashInr}`,
      ].join(' · ');
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
      new Set(board.candidates.map((c) => c.symbol)),
      quotesBySymbol,
      { config, levelsBySymbol },
    );

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

    this.logger.log(
      `Recommendation ${savedRun.id}: ${pipelineFunnel.summary} | allocated=${totalAllocated} reserved=${cashReserved} | holdingsUpdated=${holdingsManagement.filter((h) => h.changed).length}`,
    );

    return {
      id: savedRun.id,
      status: savedRun.status,
      marketTs: savedRun.marketTs,
      marketSession: savedRun.marketSession,
      availableCash: toNumber(savedRun.availableCash),
      totalAllocatedInr: toNumber(savedRun.totalAllocatedInr),
      cashReservedInr: toNumber(savedRun.cashReservedInr),
      portfolioSummary: savedRun.portfolioSummary,
      marketRegime: savedRun.marketRegime,
      confidence: savedRun.confidence,
      portfolioStrategy: savedRun.portfolioStrategy,
      model: savedRun.model,
      pipelineFunnel,
      holdingsManagement,
      rejectedCandidates,
      minDeployCashInr: config.minDeployCashInr,
      skipNewBuysReason: cashTooSmallForNewPicks
        ? ('LOW_CASH' as const)
        : null,
      /** Shortlist → buyable filter outcomes (full 120 accounting). */
      ...buildShortlistOutcomePayload(board, cashTooSmallForNewPicks),
      items: savedItems.map((item, index) => ({
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
        convictionRank: picks[index]?.convictionRank ?? index + 1,
      })),
    };
  }

  /**
   * Replace editable fields on a PENDING run. Items omitted from the payload
   * are removed (drop a stock from the plan). New symbols cannot be added here.
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
    if (run.status !== RecommendationRunStatus.PENDING) {
      throw new BadRequestException(
        `Recommendation ${runId} is ${run.status}; only PENDING plans can be edited`,
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

    return {
      id: savedRun.id,
      status: savedRun.status,
      marketTs: savedRun.marketTs,
      marketSession: savedRun.marketSession,
      availableCash: toNumber(savedRun.availableCash),
      totalAllocatedInr: toNumber(savedRun.totalAllocatedInr),
      cashReservedInr: toNumber(savedRun.cashReservedInr),
      portfolioSummary: savedRun.portfolioSummary,
      marketRegime: savedRun.marketRegime,
      confidence: savedRun.confidence,
      portfolioStrategy: savedRun.portfolioStrategy,
      model: savedRun.model,
      items: savedItems.map((item, index) => ({
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
        convictionRank: index + 1,
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
      status: 'BUYABLE' | 'REJECTED';
      reason: string | null;
      buyLow?: number;
      buyHigh?: number;
      sellTarget?: number;
      stopLoss?: number;
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
    }));
  const setupRejects = outcomes
    .filter((o) => o.status === 'REJECTED')
    .map((o) => ({
      symbol: o.symbol,
      reason: humanizeRejectReason(o.reason ?? 'rejected'),
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  return {
    shortlistedCount:
      board.pipelineFunnel.prioritized ?? board.priorityShortlist.length,
    buyableCount: buyable.length,
    setupRejectCount: setupRejects.length,
    /** Valid entry/stop/target plans from the shortlist (pre-AI). */
    buyableShortlist: buyable,
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

function humanizeRejectReason(raw: string): string {
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
  if (/NO_SETUP/i.test(text)) {
    return 'No pullback/breakout setup on the chart right now';
  }
  if (/NO_STOP_STRUCTURE|STOP_INSIDE|STOP_TOO_WIDE/i.test(text)) {
    return 'No safe stop-loss from chart structure';
  }
  if (/NO_TARGET|TARGET_NOT_ABOVE|TARGET_UNREALISTIC/i.test(text)) {
    return 'No realistic sell target from chart structure';
  }
  if (/NO_ENTRY|entry/i.test(text) && /tradePlan/i.test(text)) {
    return 'No valid buy entry zone';
  }
  if (/RR|risk.?reward|minTargetRr/i.test(text)) {
    return 'Risk/reward below minimum';
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
