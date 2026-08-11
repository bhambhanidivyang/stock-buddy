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
import { isSameIstTradingDay, istDateKey } from '../market/market-clock';
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
            status: RecommendationRunStatus.EXECUTABLE,
          },
          order: { createdAt: 'DESC' },
        });

    if (!run) {
      throw new NotFoundException(
        recommendationId
          ? `Recommendation ${recommendationId} not found`
          : 'No Executable plan found. Generate a recommendation and Mark as Executable Plan first.',
      );
    }

    if (
      run.status !== RecommendationRunStatus.EXECUTABLE &&
      run.status !== RecommendationRunStatus.EXECUTING
    ) {
      throw new BadRequestException(
        `Recommendation ${run.id} is ${run.status}. Mark it as the Executable plan first (today's plans only).`,
      );
    }

    if (!isSameIstTradingDay(new Date(run.marketTs), new Date())) {
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

      // Supersede other unused today's plans so only this session remains active
      await manager
        .createQueryBuilder()
        .update(RecommendationRun)
        .set({ status: RecommendationRunStatus.SUPERSEDED })
        .where('account_id = :accountId', { accountId: account.id })
        .andWhere('status IN (:...statuses)', {
          statuses: [
            RecommendationRunStatus.PENDING,
            RecommendationRunStatus.EXECUTABLE,
          ],
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

    const realizedPnlToday = round2(
      legs
        .filter((l) => l.state === 'SOLD')
        .reduce((sum, l) => sum + (l.realizedPnl ?? 0), 0),
    );
    const unrealizedPnlOpen = round2(
      legs
        .filter((l) => l.state === 'OPEN' || l.state === 'NEEDS_REVIEW')
        .reduce((sum, l) => sum + (l.unrealizedPnl ?? 0), 0),
    );
    const qtyBoughtToday = legs
      .filter((l) => l.qtyBought > 0)
      .reduce((sum, l) => sum + l.qtyBought, 0);
    const qtyHeld = legs.reduce((sum, l) => sum + l.qtyHeld, 0);
    const qtySoldToday = legs.reduce((sum, l) => sum + l.qtySold, 0);

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
      qtyBoughtToday,
      qtyHeld,
      qtySoldToday,
      realizedPnlToday,
      unrealizedPnlOpen,
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

  /**
   * Past execution sessions (newest first) with per-trade fill detail.
   * Includes buy/sell prices, qty, exit reason, and realized P&L from DB.
   */
  async listHistory(userId: string, limit = 30) {
    const account = await this.accounts.getAccountForUser(userId);
    const take = Math.min(100, Math.max(1, Math.floor(limit)));
    const sessions = await this.sessions.find({
      where: { accountId: account.id },
      order: { startedAt: 'DESC' },
      take,
    });
    if (sessions.length === 0) {
      return [];
    }

    const sessionIds = sessions.map((s) => s.id);
    const trades = await this.trades.find({
      where: { executionSessionId: In(sessionIds) },
      order: { createdAt: 'ASC' },
    });
    const bySession = new Map<string, Trade[]>();
    for (const trade of trades) {
      const list = bySession.get(trade.executionSessionId) ?? [];
      list.push(trade);
      bySession.set(trade.executionSessionId, list);
    }

    return sessions.map((session) => {
      const sessionTrades = bySession.get(session.id) ?? [];
      const legs = sessionTrades.map((trade) =>
        this.toHistoryLeg(trade),
      );
      const filledBuys = legs.filter((l) => l.qtyBought > 0);
      const sold = legs.filter((l) => l.qtySold > 0);
      const stillOpen = legs.filter(
        (l) => l.state === 'OPEN' || l.state === 'NEEDS_REVIEW',
      );
      const realizedPnl = round2(
        sold.reduce((sum, l) => sum + (l.realizedPnl ?? 0), 0),
      );

      return {
        sessionId: session.id,
        status: session.status,
        stopReason: session.stopReason,
        startedAt: session.startedAt,
        stoppedAt: session.stoppedAt,
        recommendationId: session.recommendationRunId,
        tradeCount: legs.length,
        qtyBought: filledBuys.reduce((sum, l) => sum + l.qtyBought, 0),
        qtySold: sold.reduce((sum, l) => sum + l.qtySold, 0),
        qtyHeld: stillOpen.reduce((sum, l) => sum + l.qtyHeld, 0),
        realizedPnl,
        legs,
      };
    });
  }

  private toHistoryLeg(trade: Trade) {
    const buyPrice =
      trade.buyPrice != null ? toNumber(trade.buyPrice) : null;
    const sellPrice =
      trade.sellPrice != null ? toNumber(trade.sellPrice) : null;
    const realizedPnl =
      trade.realizedPnl != null ? toNumber(trade.realizedPnl) : null;
    const isSold =
      trade.status === TradeStatus.CLOSED &&
      trade.exitReason != null &&
      trade.exitReason !== TradeExitReason.CANCELLED_EOD &&
      trade.exitReason !== TradeExitReason.CANCELLED_SUPERSEDED;
    const isCancelled =
      trade.status === TradeStatus.CLOSED &&
      (trade.exitReason === TradeExitReason.CANCELLED_EOD ||
        trade.exitReason === TradeExitReason.CANCELLED_SUPERSEDED);
    const isOpen =
      trade.status === TradeStatus.OPEN ||
      trade.status === TradeStatus.NEEDS_REVIEW;
    const isWaiting = trade.status === TradeStatus.WAITING_BUY;

    let state:
      | 'WAITING_BUY'
      | 'OPEN'
      | 'NEEDS_REVIEW'
      | 'SOLD'
      | 'CANCELLED' = 'OPEN';
    if (isWaiting) state = 'WAITING_BUY';
    else if (trade.status === TradeStatus.NEEDS_REVIEW) state = 'NEEDS_REVIEW';
    else if (isSold) state = 'SOLD';
    else if (isCancelled) state = 'CANCELLED';
    else if (isOpen) state = 'OPEN';

    return {
      tradeId: trade.id,
      symbol: trade.symbol,
      qty: trade.qty,
      state,
      exitReason: trade.exitReason,
      buyLow: toNumber(trade.buyLow),
      buyHigh: toNumber(trade.buyHigh),
      buyPrice,
      sellTarget: toNumber(trade.sellTarget),
      stopLoss: toNumber(trade.stopLoss),
      sellPrice: isSold ? sellPrice : null,
      qtyBought: isWaiting || isCancelled ? 0 : trade.qty,
      qtyHeld: isOpen ? trade.qty : 0,
      qtySold: isSold ? trade.qty : 0,
      realizedPnl: isSold ? realizedPnl : null,
      buyAt: trade.buyAt,
      sellAt: trade.sellAt,
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
        priceKind: mark != null ? ('MARK' as const) : null,
        qtyBought: 0,
        qtyHeld: 0,
        qtySold: 0,
        exitReason: null,
        realizedPnl: null,
        unrealizedPnl: null,
        buyAt: null,
        sellAt: null,
      };
    }

    if (trade.status === TradeStatus.OPEN) {
      const unrealizedPnl =
        mark != null && buyPrice != null
          ? round2((mark - buyPrice) * trade.qty)
          : null;
      return {
        tradeId: trade.id,
        symbol: trade.symbol,
        qty: trade.qty,
        role: trade.role,
        state: 'OPEN' as const,
        statusLabel: 'Holding',
        detail: `Holding ${trade.qty} · chasing target ${sellTarget} (stop ${stopLoss})`,
        buyLow: toNumber(trade.buyLow),
        buyHigh: toNumber(trade.buyHigh),
        buyPrice,
        sellTarget,
        stopLoss,
        mark,
        sellPrice: null,
        priceKind: mark != null ? ('MARK' as const) : null,
        qtyBought: trade.qty,
        qtyHeld: trade.qty,
        qtySold: 0,
        exitReason: null,
        realizedPnl: null,
        unrealizedPnl,
        buyAt: trade.buyAt,
        sellAt: null,
      };
    }

    if (trade.status === TradeStatus.NEEDS_REVIEW) {
      const unrealizedPnl =
        mark != null && buyPrice != null
          ? round2((mark - buyPrice) * trade.qty)
          : null;
      return {
        tradeId: trade.id,
        symbol: trade.symbol,
        qty: trade.qty,
        role: trade.role,
        state: 'NEEDS_REVIEW' as const,
        statusLabel: 'Needs review',
        detail: `Holding ${trade.qty} parked — decide in Portfolio`,
        buyLow: toNumber(trade.buyLow),
        buyHigh: toNumber(trade.buyHigh),
        buyPrice,
        sellTarget,
        stopLoss,
        mark,
        sellPrice: null,
        priceKind: mark != null ? ('MARK' as const) : null,
        qtyBought: trade.qty,
        qtyHeld: trade.qty,
        qtySold: 0,
        exitReason: null,
        realizedPnl: null,
        unrealizedPnl,
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
      priceKind: sellPrice != null ? ('SOLD' as const) : null,
      qtyBought: trade.qty,
      qtyHeld: 0,
      qtySold: trade.qty,
      exitReason: trade.exitReason,
      realizedPnl,
      unrealizedPnl: null,
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
