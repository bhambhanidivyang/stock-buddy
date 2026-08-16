import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { toNumber } from '../common/money';
import {
  Account,
  ExecutionSession,
  RecommendationRun,
  Trade,
} from '../database/entities';
import {
  ExecutionSessionStatus,
  ExecutionStopReason,
  OrderSource,
  RecommendationRunStatus,
  TradeExitReason,
  TradeStatus,
} from '../database/enums';
import { loadLiveConfig } from '../live/live.config';
import { LiveMarketDataService } from '../live/live-market-data.service';
import { hardExitReason } from '../live/hard-exit';
import { validateBuy, validateSell } from '../live/order-safety.validator';
import type { ExecutionQuote } from '../live/types';
import { PaperBrokerService } from '../live/paper-broker.service';
import { PositionManagementService } from '../live/position-management.service';
import {
  canAcceptNewEntries,
  isForceFlatWindow,
  isMarketOpenForTrading,
  shouldRunEndOfDaySettlement,
} from '../market/market-clock';

@Injectable()
export class ExecutionLoopService implements OnModuleDestroy {
  private readonly logger = new Logger(ExecutionLoopService.name);
  private timer: NodeJS.Timeout | null = null;
  /** Full OMS sessions (entries + exits + EOD). */
  private readonly activeSessionIds = new Set<string>();
  /**
   * Exit-only watch for residual OPEN lots (e.g. session stopped early).
   * Target & stop still apply while the market is open. NEEDS_REVIEW is not watched.
   */
  private readonly watchedAccountIds = new Set<string>();
  private running = false;
  private readonly pollIntervalMs: number;
  /** Keys `${istDay}:${sessionId}` already EOD-settled. */
  private readonly eodSettledKeys = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly liveData: LiveMarketDataService,
    private readonly broker: PaperBrokerService,
    private readonly positionManagement: PositionManagementService,
    private readonly activityLogs: ActivityLogsService,
    private readonly dataSource: DataSource,
    @InjectRepository(ExecutionSession)
    private readonly sessions: Repository<ExecutionSession>,
    @InjectRepository(Trade)
    private readonly trades: Repository<Trade>,
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
    @InjectRepository(RecommendationRun)
    private readonly runs: Repository<RecommendationRun>,
  ) {
    this.pollIntervalMs = Number(
      this.config.get<string>('POLL_INTERVAL_MS', '10000'),
    );
  }

  onModuleDestroy() {
    this.stopTimer();
  }

  start(sessionId: string) {
    this.activeSessionIds.add(sessionId);
    this.ensureTimer();
    this.logger.log(
      `Execution loop watching session ${sessionId} (sessions=${this.activeSessionIds.size} exitWatches=${this.watchedAccountIds.size}) every ${this.pollIntervalMs}ms`,
    );
  }

  /** Exit-only monitor for carried OPEN lots (no waiting buys / no new entries). */
  watchAccountExits(accountId: string) {
    this.watchedAccountIds.add(accountId);
    this.ensureTimer();
    this.logger.log(
      `Exit watch on account ${accountId} (exitWatches=${this.watchedAccountIds.size})`,
    );
  }

  isWatchingAccountExits(accountId: string): boolean {
    return this.watchedAccountIds.has(accountId);
  }

  /** Stop one session, or all if omitted. */
  stop(sessionId?: string) {
    if (sessionId) {
      this.activeSessionIds.delete(sessionId);
    } else {
      this.activeSessionIds.clear();
    }
    this.maybeStopTimer();
  }

  private ensureTimer() {
    if (!this.timer) {
      void this.tick();
      this.timer = setInterval(() => {
        void this.tick();
      }, this.pollIntervalMs);
    }
  }

  private maybeStopTimer() {
    if (this.activeSessionIds.size === 0 && this.watchedAccountIds.size === 0) {
      this.stopTimer();
    }
  }

  private stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick() {
    if (
      this.running ||
      (this.activeSessionIds.size === 0 && this.watchedAccountIds.size === 0)
    ) {
      return;
    }
    this.running = true;
    const sessionIds = [...this.activeSessionIds];
    const coveredAccounts = new Set<string>();

    try {
      for (const sessionId of sessionIds) {
        const accountId = await this.tickSession(sessionId);
        if (accountId) {
          coveredAccounts.add(accountId);
        }
      }
      await this.tickExitWatches(coveredAccounts);
    } catch (error) {
      this.logger.error(
        `Execution tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async tickSession(sessionId: string): Promise<string | null> {
    try {
      const session = await this.sessions.findOne({
        where: { id: sessionId },
      });
      if (!session || session.status !== ExecutionSessionStatus.RUNNING) {
        this.activeSessionIds.delete(sessionId);
        this.maybeStopTimer();
        return null;
      }

      await this.processExits(session.accountId);

      if (canAcceptNewEntries()) {
        await this.processEntries(session);
      }

      // Do not await AI: hard stop/target must keep polling even while OpenAI runs.
      void this.positionManagement.onTick(session.accountId);

      if (shouldRunEndOfDaySettlement()) {
        await this.runEndOfDaySettlement(session);
      }

      await this.maybeCompleteSession(session);
      return session.accountId;
    } catch (error) {
      this.logger.error(
        `Execution tick failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** Manage target/stop for carried OPEN lots when no RUNNING OMS session. */
  private async tickExitWatches(coveredAccounts: Set<string>) {
    for (const accountId of [...this.watchedAccountIds]) {
      if (coveredAccounts.has(accountId)) {
        continue;
      }
      try {
        const openCount = await this.trades.count({
          where: { accountId, status: TradeStatus.OPEN },
        });
        if (openCount === 0) {
          this.watchedAccountIds.delete(accountId);
          this.maybeStopTimer();
          continue;
        }
        if (!isMarketOpenForTrading()) {
          continue;
        }
        await this.processExits(accountId);
        void this.positionManagement.onTick(accountId);
      } catch (error) {
        this.logger.error(
          `Exit watch failed for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async processEntries(session: ExecutionSession) {
    const waiting = await this.trades.find({
      where: {
        executionSessionId: session.id,
        status: TradeStatus.WAITING_BUY,
      },
    });
    if (waiting.length === 0) {
      return;
    }

    const liveConfig = loadLiveConfig();
    const account = await this.accounts.findOne({
      where: { id: session.accountId },
    });
    const availableCash = account ? toNumber(account.cash) : 0;
    const quotes = await this.liveData.getExecutionQuotes(
      waiting.map((t) => t.symbol),
    );

    for (const trade of waiting) {
      if (!this.activeSessionIds.has(session.id)) {
        return;
      }
      const quote = quotes.get(trade.symbol) ?? null;
      const safety = validateBuy(
        {
          symbol: trade.symbol,
          qty: trade.qty,
          buyLow: toNumber(trade.buyLow),
          buyHigh: toNumber(trade.buyHigh),
          quote,
          availableCash,
          marketOpen: isMarketOpenForTrading() && canAcceptNewEntries(),
          alreadyOpenQty: 0,
        },
        liveConfig,
      );
      if (!safety.ok || !quote) {
        if (safety.code !== 'OUTSIDE_ENTRY_BAND' && safety.code !== 'NO_QUOTE') {
          this.logger.warn(
            `BUY blocked ${trade.symbol}: ${safety.reason}`,
          );
        }
        continue;
      }
      const filled = await this.broker.buy({
        tradeId: trade.id,
        quote,
        source: OrderSource.OMS,
      });
      if (!filled.fill.filled) {
        this.logger.warn(
          `BUY not filled ${trade.symbol}: ${filled.fill.rejectReason ?? filled.fill.status}`,
        );
      }
    }
  }

  private async processExits(accountId: string) {
    const openTrades = await this.trades.find({
      where: { accountId, status: TradeStatus.OPEN },
    });
    if (openTrades.length === 0) {
      return;
    }

    const liveConfig = loadLiveConfig();
    const quotes = await this.liveData.getExecutionQuotes(
      openTrades.map((t) => t.symbol),
    );

    for (const trade of openTrades) {
      const quote = quotes.get(trade.symbol) ?? null;
      if (!quote) {
        continue;
      }
      const target = toNumber(trade.sellTarget);
      const stop = toNumber(trade.stopLoss);
      const reason = hardExitReason(quote.price, target, stop);
      if (!reason) {
        continue;
      }
      await this.safeSell(trade, quote, reason, liveConfig);
    }
  }

  /**
   * EOD paper policy:
   * - Cancel unfilled WAITING_BUY
   * - Live force-flat (15:15–15:30 IST): sell OPEN lots with mark > buy (EOD_PROFIT);
   *   park mark ≤ buy / no quote as NEEDS_REVIEW
   * - Missed window (after 15:30): no hard sells — all remaining OPEN → NEEDS_REVIEW
   * - Stop the execution session for the calendar day
   */
  private async runEndOfDaySettlement(session: ExecutionSession) {
    const dayKey = this.istDayKey();
    const settleKey = `${dayKey}:${session.id}`;
    if (this.eodSettledKeys.has(settleKey)) {
      return;
    }

    const openTrades = await this.trades.find({
      where: { accountId: session.accountId, status: TradeStatus.OPEN },
    });
    const waiting = await this.trades.find({
      where: {
        executionSessionId: session.id,
        status: TradeStatus.WAITING_BUY,
      },
    });

    if (openTrades.length === 0 && waiting.length === 0) {
      this.eodSettledKeys.add(settleKey);
      await this.stopSessionForEndOfDay(session);
      return;
    }

    const forceFlat = isForceFlatWindow();
    this.logger.log(
      `EOD wind-up session=${session.id} open=${openTrades.length} waitingBuy=${waiting.length} forceFlatWindow=${forceFlat}`,
    );

    for (const trade of waiting) {
      trade.status = TradeStatus.CLOSED;
      trade.exitReason = TradeExitReason.CANCELLED_EOD;
      await this.trades.save(trade);
    }

    if (openTrades.length > 0) {
      if (forceFlat) {
        const liveConfig = loadLiveConfig();
        const quotes = await this.liveData.getExecutionQuotes(
          openTrades.map((t) => t.symbol),
        );
        let sold = 0;
        let parked = 0;
        for (const trade of openTrades) {
          const buy = toNumber(trade.buyPrice ?? '0');
          const quote = quotes.get(trade.symbol) ?? null;
          const mark = quote?.price;
          if (mark != null && mark > buy && quote) {
            const ok = await this.safeSell(
              trade,
              quote,
              TradeExitReason.EOD_PROFIT,
              liveConfig,
            );
            if (ok) {
              sold += 1;
            } else {
              await this.markNeedsReview(
                trade.id,
                'EOD force-flat: live sell blocked (stale/unavailable quote)',
              );
              parked += 1;
            }
          } else {
            await this.markNeedsReview(
              trade.id,
              mark == null
                ? 'EOD force-flat: no live quote'
                : `EOD force-flat: mark ${mark} <= buy ${buy}`,
            );
            parked += 1;
          }
        }
        this.logger.log(
          `EOD force-flat account=${session.accountId} soldProfit=${sold} needsReview=${parked}`,
        );
      } else {
        // After cash close — hard sells need live open-market quotes.
        for (const trade of openTrades) {
          await this.markNeedsReview(trade.id, 'EOD after close: no hard sell');
        }
        this.logger.log(
          `EOD after-close park ${openTrades.length} OPEN → NEEDS_REVIEW account=${session.accountId}`,
        );
      }
    }

    this.eodSettledKeys.add(settleKey);
    await this.stopSessionForEndOfDay(session);

    // Rare: if anything is still OPEN (race), keep exit watch; NEEDS_REVIEW is parked.
    const stillOpen = await this.trades.count({
      where: { accountId: session.accountId, status: TradeStatus.OPEN },
    });
    if (stillOpen > 0) {
      this.watchAccountExits(session.accountId);
    }
    this.logger.log(`EOD settlement finished for ${settleKey}`);
  }

  private async markNeedsReview(tradeId: string, reason: string) {
    await this.dataSource.transaction(async (manager) => {
      const trade = await manager.findOne(Trade, {
        where: { id: tradeId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!trade || trade.status !== TradeStatus.OPEN) {
        return;
      }
      trade.status = TradeStatus.NEEDS_REVIEW;
      await manager.save(trade);
      this.logger.warn(
        `NEEDS_REVIEW ${trade.symbol} qty=${trade.qty} buy=${trade.buyPrice} (${reason})`,
      );
    });
  }

  private async stopSessionForEndOfDay(session: ExecutionSession) {
    const fresh = await this.sessions.findOne({ where: { id: session.id } });
    if (!fresh || fresh.status !== ExecutionSessionStatus.RUNNING) {
      return;
    }
    fresh.status = ExecutionSessionStatus.COMPLETED;
    fresh.stoppedAt = new Date();
    fresh.stopReason = ExecutionStopReason.END_OF_DAY;
    await this.sessions.save(fresh);

    await this.runs.update(
      { id: fresh.recommendationRunId },
      { status: RecommendationRunStatus.COMPLETED },
    );

    if (this.activeSessionIds.has(fresh.id)) {
      this.stop(fresh.id);
    }

    await this.activityLogs.append({
      accountId: fresh.accountId,
      category: 'EXECUTION',
      eventCode: 'EXEC_END',
      message: `Execution run ends (end of day) at ${(fresh.stoppedAt ?? new Date()).toISOString()}`,
      refId: fresh.id,
      meta: { stopReason: ExecutionStopReason.END_OF_DAY },
    });
  }

  private istDayKey(now = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }

  private async safeSell(
    trade: Trade,
    quote: ExecutionQuote,
    reason: TradeExitReason,
    liveConfig: ReturnType<typeof loadLiveConfig>,
  ): Promise<boolean> {
    const safety = validateSell(
      {
        symbol: trade.symbol,
        requestedQty: trade.qty,
        heldQty: trade.qty,
        status: trade.status,
        quote,
        marketOpen: isMarketOpenForTrading(),
      },
      liveConfig,
    );
    if (!safety.ok) {
      this.logger.warn(`SELL blocked ${trade.symbol} (${reason}): ${safety.reason}`);
      return false;
    }
    const sold = await this.broker.sell({
      tradeId: trade.id,
      quote,
      reason,
      source: OrderSource.OMS,
    });
    if (!sold.fill.filled) {
      this.logger.warn(
        `SELL not filled ${trade.symbol}: ${sold.fill.rejectReason ?? sold.fill.status}`,
      );
      return false;
    }
    return true;
  }

  private async maybeCompleteSession(session: ExecutionSession) {
    const fresh = await this.sessions.findOne({ where: { id: session.id } });
    if (!fresh || fresh.status !== ExecutionSessionStatus.RUNNING) {
      return;
    }

    const waiting = await this.trades.count({
      where: {
        executionSessionId: session.id,
        status: TradeStatus.WAITING_BUY,
      },
    });
    if (waiting > 0) {
      return;
    }

    // OPEN lots still managed by target/stop (and later EOD). NEEDS_REVIEW is parked.
    const openCount = await this.trades.count({
      where: {
        accountId: session.accountId,
        status: In([TradeStatus.OPEN]),
      },
    });
    if (openCount > 0) {
      return;
    }

    fresh.status = ExecutionSessionStatus.COMPLETED;
    fresh.stoppedAt = new Date();
    fresh.stopReason = ExecutionStopReason.ALL_CLOSED;
    await this.sessions.save(fresh);

    await this.runs.update(
      { id: fresh.recommendationRunId },
      { status: RecommendationRunStatus.COMPLETED },
    );

    if (this.activeSessionIds.has(fresh.id)) {
      this.stop(fresh.id);
    }
    this.logger.log(`Execution session ${fresh.id} completed`);

    await this.activityLogs.append({
      accountId: fresh.accountId,
      category: 'EXECUTION',
      eventCode: 'EXEC_END',
      message: `Execution run ends (all closed) at ${(fresh.stoppedAt ?? new Date()).toISOString()}`,
      refId: fresh.id,
      meta: { stopReason: ExecutionStopReason.ALL_CLOSED },
    });
  }
}
