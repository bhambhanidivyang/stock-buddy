import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { And, DataSource, In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { AccountService } from '../account/account.service';
import { toNumber } from '../common/money';
import {
  ExecutionSession,
  RecommendationItem,
  RecommendationRun,
  Trade,
} from '../database/entities';
import {
  ExecutionSessionStatus,
  ExecutionStopReason,
  RecommendationRunStatus,
  TradeExitReason,
  TradeStatus,
} from '../database/enums';
import { istDateKey } from '../market/market-clock';
import { YahooService } from '../market/yahoo.service';
import { ExecutionLoopService } from './execution-loop.service';

@Injectable()
export class ExecuteService implements OnModuleInit {
  private readonly logger = new Logger(ExecuteService.name);

  constructor(
    private readonly accounts: AccountService,
    private readonly loop: ExecutionLoopService,
    private readonly yahoo: YahooService,
    private readonly dataSource: DataSource,
    @InjectRepository(RecommendationRun)
    private readonly runs: Repository<RecommendationRun>,
    @InjectRepository(RecommendationItem)
    private readonly items: Repository<RecommendationItem>,
    @InjectRepository(ExecutionSession)
    private readonly sessions: Repository<ExecutionSession>,
    @InjectRepository(Trade)
    private readonly trades: Repository<Trade>,
  ) {}

  async onModuleInit() {
    const running = await this.sessions.find({
      where: { status: ExecutionSessionStatus.RUNNING },
      order: { startedAt: 'DESC' },
    });
    for (const session of running) {
      this.logger.log(`Resuming execution session ${session.id}`);
      this.loop.start(session.id);
    }

    // Swing carry: resume target/stop polling for OPEN lots even when OMS is IDLE.
    const openLots = await this.trades.find({
      where: { status: TradeStatus.OPEN },
      select: ['accountId'],
    });
    const accountIds = [...new Set(openLots.map((t) => t.accountId))];
    for (const accountId of accountIds) {
      const alreadyCovered = running.some((s) => s.accountId === accountId);
      if (!alreadyCovered) {
        this.logger.log(
          `Resuming exit watch for account ${accountId} (OPEN lots, no RUNNING session)`,
        );
        this.loop.watchAccountExits(accountId);
      }
    }
  }

  async startExecution(userId: string, recommendationId?: string) {
    const account = await this.accounts.getAccountForUser(userId);

    const run = recommendationId
      ? await this.runs.findOne({
          where: { id: recommendationId, accountId: account.id },
        })
      : await this.runs.findOne({
          where: {
            accountId: account.id,
            status: RecommendationRunStatus.PENDING,
          },
          order: { createdAt: 'DESC' },
        });

    if (!run) {
      throw new NotFoundException(
        recommendationId
          ? `Recommendation ${recommendationId} not found`
          : 'No PENDING recommendation found. Call POST /recommendations first.',
      );
    }

    if (
      run.status !== RecommendationRunStatus.PENDING &&
      run.status !== RecommendationRunStatus.EXECUTING
    ) {
      throw new BadRequestException(
        `Recommendation ${run.id} is ${run.status} and cannot be executed`,
      );
    }

    if (!isSameIstTradingDay(run.marketTs, new Date())) {
      throw new BadRequestException(
        `Recommendation ${run.id} is not from today's IST trading day (marketTs=${run.marketTs.toISOString()}). Generate a fresh plan.`,
      );
    }

    const items = await this.items.find({
      where: { recommendationRunId: run.id },
      order: { sortOrder: 'ASC' },
    });
    if (items.length === 0) {
      throw new BadRequestException(
        'Recommendation has no items (low-conviction / empty plan). Nothing to execute.',
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const existingRunning = await manager.find(ExecutionSession, {
        where: {
          accountId: account.id,
          status: ExecutionSessionStatus.RUNNING,
        },
      });

      for (const prior of existingRunning) {
        prior.status = ExecutionSessionStatus.STOPPED;
        prior.stoppedAt = new Date();
        prior.stopReason = ExecutionStopReason.REPLACED;
        await manager.save(prior);

        await manager.update(
          Trade,
          {
            executionSessionId: prior.id,
            status: TradeStatus.WAITING_BUY,
          },
          {
            status: TradeStatus.CLOSED,
            exitReason: TradeExitReason.CANCELLED_SUPERSEDED,
          },
        );

        if (prior.recommendationRunId !== run.id) {
          await manager.update(
            RecommendationRun,
            { id: prior.recommendationRunId },
            { status: RecommendationRunStatus.SUPERSEDED },
          );
        }
      }

      // Supersede other pending runs so latest execute is unambiguous next time
      await manager
        .createQueryBuilder()
        .update(RecommendationRun)
        .set({ status: RecommendationRunStatus.SUPERSEDED })
        .where('account_id = :accountId', { accountId: account.id })
        .andWhere('status = :status', {
          status: RecommendationRunStatus.PENDING,
        })
        .andWhere('id != :runId', { runId: run.id })
        .execute();

      const session = await manager.save(
        manager.create(ExecutionSession, {
          accountId: account.id,
          recommendationRunId: run.id,
          status: ExecutionSessionStatus.RUNNING,
          startedAt: new Date(),
        }),
      );

      // Allow second lots: same symbol may already be OPEN / NEEDS_REVIEW.
      const createdTrades: Trade[] = [];
      const addOnSymbols: string[] = [];

      const heldSymbols = new Set(
        (
          await manager.find(Trade, {
            where: [
              { accountId: account.id, status: TradeStatus.OPEN },
              { accountId: account.id, status: TradeStatus.NEEDS_REVIEW },
            ],
          })
        ).map((t) => t.symbol),
      );

      for (const item of items) {
        if (heldSymbols.has(item.symbol)) {
          addOnSymbols.push(item.symbol);
        }

        const trade = await manager.save(
          manager.create(Trade, {
            accountId: account.id,
            recommendationItemId: item.id,
            executionSessionId: session.id,
            symbol: item.symbol,
            qty: item.qty,
            role: item.role,
            buyLow: item.buyLow,
            buyHigh: item.buyHigh,
            sellTarget: item.sellTarget,
            stopLoss: item.stopLoss,
            summary: item.summary,
            status: TradeStatus.WAITING_BUY,
          }),
        );
        createdTrades.push(trade);
      }

      await manager.update(
        RecommendationRun,
        { id: run.id },
        { status: RecommendationRunStatus.EXECUTING },
      );

      return { session, createdTrades, addOnSymbols };
    });

    this.loop.start(result.session.id);
    this.logger.log(
      `Started execution session ${result.session.id} for recommendation ${run.id} trades=${result.createdTrades.length} addOns=${result.addOnSymbols.join(',') || 'none'}`,
    );

    return {
      sessionId: result.session.id,
      recommendationId: run.id,
      status: result.session.status,
      startedAt: result.session.startedAt,
      waitingBuyCount: result.createdTrades.length,
      addOnSymbols: result.addOnSymbols,
      trades: result.createdTrades.map((trade) => ({
        id: trade.id,
        symbol: trade.symbol,
        qty: trade.qty,
        status: trade.status,
        buyLow: trade.buyLow,
        buyHigh: trade.buyHigh,
        sellTarget: trade.sellTarget,
        stopLoss: trade.stopLoss,
        role: trade.role,
      })),
    };
  }

  async getStatus(userId: string) {
    const account = await this.accounts.getAccountForUser(userId);
    const session = await this.sessions.findOne({
      where: { accountId: account.id, status: ExecutionSessionStatus.RUNNING },
      order: { startedAt: 'DESC' },
    });
    const lastSession =
      session ??
      (await this.sessions.findOne({
        where: { accountId: account.id },
        order: { startedAt: 'DESC' },
      }));

    const { start: dayStart, end: dayEnd } = istDayBoundsUtc();
    const liveTrades = await this.trades.find({
      where: {
        accountId: account.id,
        status: In([
          TradeStatus.WAITING_BUY,
          TradeStatus.OPEN,
          TradeStatus.NEEDS_REVIEW,
        ]),
      },
      order: { updatedAt: 'DESC' },
    });
    const soldToday = await this.trades.find({
      where: {
        accountId: account.id,
        status: TradeStatus.CLOSED,
        exitReason: In([
          TradeExitReason.TARGET,
          TradeExitReason.STOP,
          TradeExitReason.EOD_PROFIT,
          TradeExitReason.HUMAN_SELL,
        ]),
        sellAt: And(MoreThanOrEqual(dayStart), LessThan(dayEnd)),
      },
      order: { sellAt: 'DESC' },
    });

    const quoteSymbols = [
      ...new Set(
        [...liveTrades, ...soldToday]
          .filter((t) => t.status !== TradeStatus.CLOSED)
          .map((t) => t.symbol),
      ),
    ];
    const quotes =
      quoteSymbols.length > 0
        ? await this.yahoo.getQuotes(quoteSymbols)
        : new Map();

    const legs = [...liveTrades, ...soldToday].map((trade) =>
      this.toExecutionLeg(trade, quotes.get(trade.symbol)?.price ?? null),
    );

    const waitingBuy = legs.filter((l) => l.state === 'WAITING_BUY').length;
    const openPositions = legs.filter((l) => l.state === 'OPEN').length;
    const needsReviewPositions = legs.filter(
      (l) => l.state === 'NEEDS_REVIEW',
    ).length;
    const soldPositions = legs.filter((l) => l.state === 'SOLD').length;
    const managingExits =
      Boolean(session) ||
      (this.loop.isWatchingAccountExits(account.id) && openPositions > 0);

    const active =
      waitingBuy > 0 || openPositions > 0 || Boolean(session) || managingExits;
    const phase = session
      ? waitingBuy > 0
        ? ('BUYING' as const)
        : ('MANAGING' as const)
      : openPositions > 0 && managingExits
        ? ('MANAGING' as const)
        : needsReviewPositions > 0
          ? ('NEEDS_REVIEW' as const)
          : ('IDLE' as const);

    const headline = buildExecutionHeadline({
      phase,
      waitingBuy,
      openPositions,
      needsReviewPositions,
      soldPositions,
      sessionRunning: Boolean(session),
    });

    return {
      status: session ? ('RUNNING' as const) : ('IDLE' as const),
      phase,
      active,
      headline,
      sessionId: session?.id ?? null,
      recommendationId: session?.recommendationRunId ?? null,
      startedAt: session?.startedAt ?? null,
      waitingBuy,
      openPositions,
      needsReviewPositions,
      soldPositions,
      managingExits,
      lastSession: lastSession
        ? {
            sessionId: lastSession.id,
            status: lastSession.status,
            stopReason: lastSession.stopReason,
            startedAt: lastSession.startedAt,
            stoppedAt: lastSession.stoppedAt,
          }
        : null,
      legs,
      asOf: new Date().toISOString(),
      day: istDateKey(),
    };
  }

  private toExecutionLeg(trade: Trade, mark: number | null) {
    const buyPrice =
      trade.buyPrice != null ? toNumber(trade.buyPrice) : null;
    const sellTarget = toNumber(trade.sellTarget);
    const stopLoss = toNumber(trade.stopLoss);
    const sellPrice =
      trade.sellPrice != null ? toNumber(trade.sellPrice) : null;
    const realizedPnl =
      trade.realizedPnl != null ? toNumber(trade.realizedPnl) : null;

    if (trade.status === TradeStatus.WAITING_BUY) {
      return {
        tradeId: trade.id,
        symbol: trade.symbol,
        qty: trade.qty,
        role: trade.role,
        state: 'WAITING_BUY' as const,
        statusLabel: 'Waiting buy',
        detail: `Buy when price is in ${toNumber(trade.buyLow)} – ${toNumber(trade.buyHigh)}`,
        buyLow: toNumber(trade.buyLow),
        buyHigh: toNumber(trade.buyHigh),
        buyPrice: null,
        sellTarget,
        stopLoss,
        mark,
        sellPrice: null,
        exitReason: null,
        realizedPnl: null,
        buyAt: null,
        sellAt: null,
      };
    }

    if (trade.status === TradeStatus.OPEN) {
      return {
        tradeId: trade.id,
        symbol: trade.symbol,
        qty: trade.qty,
        role: trade.role,
        state: 'OPEN' as const,
        statusLabel: 'Open',
        detail: `Chasing sell target ${sellTarget} (stop ${stopLoss})`,
        buyLow: toNumber(trade.buyLow),
        buyHigh: toNumber(trade.buyHigh),
        buyPrice,
        sellTarget,
        stopLoss,
        mark,
        sellPrice: null,
        exitReason: null,
        realizedPnl: null,
        buyAt: trade.buyAt,
        sellAt: null,
      };
    }

    if (trade.status === TradeStatus.NEEDS_REVIEW) {
      return {
        tradeId: trade.id,
        symbol: trade.symbol,
        qty: trade.qty,
        role: trade.role,
        state: 'NEEDS_REVIEW' as const,
        statusLabel: 'Needs review',
        detail: 'Parked — no auto sell; decide in Portfolio',
        buyLow: toNumber(trade.buyLow),
        buyHigh: toNumber(trade.buyHigh),
        buyPrice,
        sellTarget,
        stopLoss,
        mark,
        sellPrice: null,
        exitReason: null,
        realizedPnl: null,
        buyAt: trade.buyAt,
        sellAt: null,
      };
    }

    // CLOSED with a real exit
    const exitLabel = soldStatusLabel(trade.exitReason);
    return {
      tradeId: trade.id,
      symbol: trade.symbol,
      qty: trade.qty,
      role: trade.role,
      state: 'SOLD' as const,
      statusLabel: exitLabel.label,
      detail: exitLabel.detail(sellTarget, sellPrice, realizedPnl),
      buyLow: toNumber(trade.buyLow),
      buyHigh: toNumber(trade.buyHigh),
      buyPrice,
      sellTarget,
      stopLoss,
      mark: null,
      sellPrice,
      exitReason: trade.exitReason,
      realizedPnl,
      buyAt: trade.buyAt,
      sellAt: trade.sellAt,
    };
  }

  async stopExecution(userId: string) {
    const account = await this.accounts.getAccountForUser(userId);
    const session = await this.sessions.findOne({
      where: { accountId: account.id, status: ExecutionSessionStatus.RUNNING },
    });
    if (!session) {
      return { status: 'IDLE' as const };
    }

    this.loop.stop(session.id);

    await this.dataSource.transaction(async (manager) => {
      session.status = ExecutionSessionStatus.STOPPED;
      session.stoppedAt = new Date();
      session.stopReason = ExecutionStopReason.MANUAL;
      await manager.save(session);

      await manager.update(
        Trade,
        {
          executionSessionId: session.id,
          status: TradeStatus.WAITING_BUY,
        },
        {
          status: TradeStatus.CLOSED,
          exitReason: TradeExitReason.CANCELLED_SUPERSEDED,
        },
      );

      await manager.update(
        RecommendationRun,
        { id: session.recommendationRunId },
        { status: RecommendationRunStatus.SUPERSEDED },
      );
    });

    const openLeft = await this.trades.count({
      where: { accountId: account.id, status: TradeStatus.OPEN },
    });
    if (openLeft > 0) {
      this.loop.watchAccountExits(account.id);
    }

    return {
      status: session.status,
      sessionId: session.id,
      stopReason: session.stopReason,
    };
  }
}

function isSameIstTradingDay(a: Date, b: Date): boolean {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(a) === fmt.format(b);
}

function istDayBoundsUtc(now = new Date()): { start: Date; end: Date } {
  const day = istDateKey(now);
  return {
    start: new Date(`${day}T00:00:00+05:30`),
    end: new Date(`${day}T24:00:00+05:30`),
  };
}

function buildExecutionHeadline(input: {
  phase: 'BUYING' | 'MANAGING' | 'NEEDS_REVIEW' | 'IDLE';
  waitingBuy: number;
  openPositions: number;
  needsReviewPositions: number;
  soldPositions: number;
  sessionRunning: boolean;
}): string {
  const parts: string[] = [];
  if (input.sessionRunning) {
    parts.push('Live session');
  } else if (input.openPositions > 0) {
    parts.push('Managing open exits');
  } else if (input.needsReviewPositions > 0) {
    parts.push('Waiting on human review');
  } else {
    parts.push('Nothing active');
  }
  if (input.waitingBuy > 0) {
    parts.push(`${input.waitingBuy} waiting buy`);
  }
  if (input.openPositions > 0) {
    parts.push(`${input.openPositions} open`);
  }
  if (input.soldPositions > 0) {
    parts.push(`${input.soldPositions} sold today`);
  }
  if (input.needsReviewPositions > 0) {
    parts.push(`${input.needsReviewPositions} need review`);
  }
  return parts.join(' · ');
}

function soldStatusLabel(reason: TradeExitReason | null): {
  label: string;
  detail: (
    target: number,
    sellPrice: number | null,
    pnl: number | null,
  ) => string;
} {
  switch (reason) {
    case TradeExitReason.TARGET:
      return {
        label: 'Sold — target hit',
        detail: (target, sellPrice, pnl) =>
          `Target was ${target}; sold @ ${sellPrice ?? '—'}${pnl != null ? ` · P&L ${pnl}` : ''}`,
      };
    case TradeExitReason.STOP:
      return {
        label: 'Sold — stop hit',
        detail: (_t, sellPrice, pnl) =>
          `Sold @ ${sellPrice ?? '—'}${pnl != null ? ` · P&L ${pnl}` : ''}`,
      };
    case TradeExitReason.EOD_PROFIT:
      return {
        label: 'Sold — EOD profit',
        detail: (_t, sellPrice, pnl) =>
          `Force-sold in profit @ ${sellPrice ?? '—'}${pnl != null ? ` · P&L ${pnl}` : ''}`,
      };
    case TradeExitReason.HUMAN_SELL:
      return {
        label: 'Sold — manual',
        detail: (_t, sellPrice, pnl) =>
          `Human sell @ ${sellPrice ?? '—'}${pnl != null ? ` · P&L ${pnl}` : ''}`,
      };
    default:
      return {
        label: 'Sold',
        detail: (_t, sellPrice, pnl) =>
          `Sold @ ${sellPrice ?? '—'}${pnl != null ? ` · P&L ${pnl}` : ''}`,
      };
  }
}
