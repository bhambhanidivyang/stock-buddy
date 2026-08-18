import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { priceString, toNumber } from '../common/money';
import {
  PositionManagementDecision,
  Trade,
} from '../database/entities';
import {
  ManagementPhase,
  OrderSource,
  TradeExitReason,
  TradeStatus,
} from '../database/enums';
import {
  getMarketSession,
  isMarketOpenForTrading,
} from '../market/market-clock';
import { AiPositionService } from './ai-position.service';
import { shouldRunAiCycle, newEventsSince, eventKey } from './ai-cadence';
import {
  phaseAfterDecision,
  validateAiDecision,
} from './decision-validator';
import { isHeldQuoteTooOld } from './execution-quote-age';
import { loadLiveConfig } from './live.config';
import { LiveMarketDataService } from './live-market-data.service';
import { detectMarketEvents } from './market-event.engine';
import { updateIfStillOpen } from './open-trade-mutation';
import { validateSell } from './order-safety.validator';
import { PaperBrokerService } from './paper-broker.service';
import {
  buildPositionSnapshot,
  derivePhase,
  type TradeSnapshotInput,
} from './position-snapshot';
import {
  AI_POSITION_PROMPT_VERSION,
  type AiPositionDecision,
  type ExecutionQuote,
  type LiveConfig,
  type MarketEvent,
  type PositionSnapshot,
} from './types';

type CyclePositionSummary = {
  symbol: string;
  action: string;
  allow: boolean;
  reason: string;
  validation: string;
  confidence: number;
  ltp: number;
  pnlPct: number;
  pnl: number;
  qty: number;
  entryPrice: number;
  currentStop: number;
  currentTarget: number;
  suggestedStop: number | null;
  suggestedExitPrice: number | null;
  appliedStop: number | null;
  fillPrice: number | null;
  fillQty: number | null;
  events: Array<{ type: string; message: string }>;
};

@Injectable()
export class PositionManagementService {
  private readonly logger = new Logger(PositionManagementService.name);
  private readonly lastAiAt = new Map<string, number>();
  private readonly previousSnapshots = new Map<string, PositionSnapshot>();
  private readonly seenEventKeys = new Map<string, Set<string>>();
  private evaluating = new Set<string>();

  constructor(
    private readonly liveData: LiveMarketDataService,
    private readonly ai: AiPositionService,
    private readonly broker: PaperBrokerService,
    private readonly activityLogs: ActivityLogsService,
    @InjectRepository(Trade)
    private readonly trades: Repository<Trade>,
    @InjectRepository(PositionManagementDecision)
    private readonly decisions: Repository<PositionManagementDecision>,
  ) {}

  /**
   * Cheap per-tick hook: update HWM/phase, optionally run AI.
   * Hard stop/target exits must already have been processed by the OMS loop.
   */
  async onTick(
    accountId: string,
    quotes?: Map<string, ExecutionQuote>,
  ): Promise<void> {
    try {
      await this.onTickUnsafe(accountId, quotes);
    } catch (error) {
      this.logger.error(
        `Position monitor tick failed account=${accountId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * OMS must fire-and-forget this. Errors are swallowed by onTick() so an AI
   * failure cannot become an unhandled rejection or block hard stops.
   */
  private async onTickUnsafe(
    accountId: string,
    quotes?: Map<string, ExecutionQuote>,
  ): Promise<void> {
    if (this.evaluating.has(accountId)) {
      return;
    }
    if (!isMarketOpenForTrading()) {
      return;
    }

    const config = loadLiveConfig();
    const openTrades = await this.trades.find({
      where: { accountId, status: TradeStatus.OPEN },
    });
    if (openTrades.length === 0) {
      this.lastAiAt.delete(accountId);
      this.seenEventKeys.delete(accountId);
      return;
    }

    const now = new Date();
    const liveQuotes =
      quotes ??
      (await this.liveData.getExecutionQuotes(
        openTrades.map((t) => t.symbol),
        now,
      ));

    await this.recordMarks(openTrades, liveQuotes, config);

    if (!config.mgmtEnabled) {
      return;
    }

    const refreshed = await this.trades.find({
      where: { accountId, status: TradeStatus.OPEN },
    });
    if (refreshed.length === 0) {
      return;
    }

    const lightSnapshots = refreshed
      .map((trade) => {
        const quote = liveQuotes.get(trade.symbol);
        if (!quote) {
          return null;
        }
        return buildPositionSnapshot({
          trade: toTradeInput(trade),
          quote,
          now,
        });
      })
      .filter((s): s is PositionSnapshot => s != null);

    const events: MarketEvent[] = [];
    for (const snap of lightSnapshots) {
      const prev = this.previousSnapshots.get(snap.tradeId) ?? null;
      events.push(...detectMarketEvents(snap, config, prev));
      this.previousSnapshots.set(snap.tradeId, snap);
    }

    const seen = this.seenEventKeys.get(accountId) ?? new Set<string>();
    const freshEvents = newEventsSince(events, seen);
    const last = this.lastAiAt.get(accountId) ?? oldestReview(refreshed);
    const cadence = shouldRunAiCycle({
      nowMs: now.getTime(),
      lastAiAtMs: last === 0 ? null : last,
      intervalMs: config.aiIntervalMs,
      newEventCount: freshEvents.length,
      eventAiEnabled: config.eventAiEnabled,
    });
    if (!cadence.run) {
      return;
    }

    this.evaluating.add(accountId);
    try {
      await this.runAiCycle({
        accountId,
        trades: refreshed,
        quotes: liveQuotes,
        events: cadence.triggeredBy === 'EVENT' ? freshEvents : events,
        triggeredBy: cadence.triggeredBy,
        config,
        now,
      });
      const nextSeen = this.seenEventKeys.get(accountId) ?? new Set<string>();
      for (const event of events) {
        nextSeen.add(eventKey(event));
      }
      this.seenEventKeys.set(accountId, nextSeen);
    } catch (error) {
      this.logger.error(
        `Position AI cycle failed account=${accountId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      const nextSeen = this.seenEventKeys.get(accountId) ?? new Set<string>();
      for (const event of events) {
        nextSeen.add(eventKey(event));
      }
      this.seenEventKeys.set(accountId, nextSeen);
    } finally {
      this.lastAiAt.set(accountId, Date.now());
      this.evaluating.delete(accountId);
    }
  }

  private async recordMarks(
    trades: Trade[],
    quotes: Map<string, ExecutionQuote>,
    _config: LiveConfig,
  ) {
    for (const trade of trades) {
      const quote = quotes.get(trade.symbol);
      if (!quote || !(quote.price > 0) || !trade.buyPrice) {
        continue;
      }
      const buy = toNumber(trade.buyPrice);
      const hwm = Math.max(
        toNumber(trade.highWaterMark ?? '0'),
        quote.price,
        buy,
      );
      const pnlPct = buy > 0 ? ((quote.price - buy) / buy) * 100 : 0;
      const maxPct = Math.max(toNumber(trade.maxUnrealizedPct ?? '0'), pnlPct);
      const stop = toNumber(trade.stopLoss);
      const pnl = (quote.price - buy) * trade.qty;
      const phase = derivePhase(trade.managementPhase, pnl, stop, buy);

      const changed =
        trade.highWaterMark !== priceString(hwm) ||
        trade.maxUnrealizedPct !== maxPct.toFixed(4) ||
        trade.managementPhase !== phase;
      if (!changed) {
        continue;
      }
      await updateIfStillOpen(this.trades, trade.id, {
        highWaterMark: priceString(hwm),
        maxUnrealizedPct: maxPct.toFixed(4),
        managementPhase: phase,
      });
    }
  }

  private async runAiCycle(input: {
    accountId: string;
    trades: Trade[];
    quotes: Map<string, ExecutionQuote>;
    events: MarketEvent[];
    triggeredBy: string;
    config: LiveConfig;
    now: Date;
  }) {
    const index = await this.liveData.getExecutionIndexSnapshot(input.now);
    const marketContext = {
      niftyPrice: index.nifty?.price ?? null,
      niftyChangePct: index.nifty?.changePercent ?? null,
      bankNiftyChangePct: index.bankNifty?.changePercent ?? null,
      indiaVix: index.indiaVix?.price ?? null,
    };

    const snapshots: PositionSnapshot[] = [];
    for (const trade of input.trades) {
      const quote = input.quotes.get(trade.symbol);
      if (!quote) {
        this.logger.warn(
          `Skipping AI for ${trade.symbol}: no live quote`,
        );
        continue;
      }
      const [bars1m, bars5m] = await Promise.all([
        this.liveData.getIntradayBars(trade.symbol, '1m', 120),
        this.liveData.getIntradayBars(trade.symbol, '5m', 240),
      ]);
      snapshots.push(
        buildPositionSnapshot({
          trade: toTradeInput(trade),
          quote,
          bars1m,
          bars5m,
          marketContext,
          now: input.now,
        }),
      );
    }
    if (snapshots.length === 0) {
      return;
    }

    const aiResult = await this.ai.evaluatePortfolio({
      marketTs: input.now.toISOString(),
      marketSession: getMarketSession(input.now),
      triggeredBy: input.triggeredBy,
      events: input.events,
      positions: snapshots,
    });

    const bySymbol = new Map(
      aiResult.response.positions.map((p) => [p.symbol.toUpperCase(), p]),
    );

    const summaries: CyclePositionSummary[] = [];
    for (const snapshot of snapshots) {
      const decision = bySymbol.get(snapshot.symbol);
      if (!decision) {
        summaries.push(
          await this.persistDecision({
            accountId: input.accountId,
            snapshot,
            events: input.events.filter((e) => e.symbol === snapshot.symbol),
            triggeredBy: input.triggeredBy,
            promptHash: aiResult.promptHash,
            decision: {
              symbol: snapshot.symbol,
              action: 'HOLD',
              confidence: 0,
              reason: 'AI omitted this symbol; default HOLD',
              suggestedStop: null,
              suggestedExitPrice: null,
            },
            verdict: {
              allow: true,
              reason: 'Default HOLD — AI omitted symbol',
              effectiveStop: null,
              executeExit: false,
              applyStop: false,
            },
            config: input.config,
          }),
        );
        continue;
      }
      const applied = await this.applyDecision({
        accountId: input.accountId,
        snapshot,
        decision,
        events: input.events.filter((e) => e.symbol === snapshot.symbol),
        triggeredBy: input.triggeredBy,
        promptHash: aiResult.promptHash,
        quotes: input.quotes,
        config: input.config,
      });
      if (applied) {
        summaries.push(applied);
      }
    }

    const kept = summaries.filter((s): s is CyclePositionSummary => s != null);
    await this.activityLogs.append({
      accountId: input.accountId,
      category: 'POSITION_MANAGEMENT',
      eventCode: 'PM_REVIEW',
      message: reviewActivityMessage(input.triggeredBy, kept),
      refId: null,
      meta: {
        triggeredBy: input.triggeredBy,
        promptHash: aiResult.promptHash,
        portfolioSummary: aiResult.response.portfolioSummary,
        positions: kept,
      },
    });
  }

  private async applyDecision(input: {
    accountId: string;
    snapshot: PositionSnapshot;
    decision: AiPositionDecision;
    events: MarketEvent[];
    triggeredBy: string;
    promptHash: string;
    quotes: Map<string, ExecutionQuote>;
    config: LiveConfig;
  }): Promise<CyclePositionSummary | null> {
    let verdict = validateAiDecision(
      input.decision,
      input.snapshot,
      input.config,
    );
    const trade = await this.trades.findOne({
      where: { id: input.snapshot.tradeId },
    });
    if (!trade || trade.status !== TradeStatus.OPEN) {
      return this.persistDecision({
        accountId: input.accountId,
        snapshot: input.snapshot,
        events: input.events,
        triggeredBy: input.triggeredBy,
        promptHash: input.promptHash,
        decision: input.decision,
        verdict: {
          allow: false,
          reason: 'Position no longer OPEN; AI action ignored',
          effectiveStop: null,
          executeExit: false,
          applyStop: false,
        },
        config: input.config,
      });
    }

    let brokerOrderId: string | null = null;
    let brokerStatus: string | null = null;
    let fillPrice: number | null = null;
    let fillQty: number | null = null;
    let pnlAfter: number | null = null;
    let phaseAfter = phaseAfterDecision(
      input.snapshot,
      input.decision,
      verdict,
    );

    if (verdict.allow && verdict.executeExit) {
      const now = new Date();
      const fresh = await this.liveData.getExecutionQuote(trade.symbol, now);
      const held = input.quotes.get(trade.symbol) ?? null;
      const quote =
        fresh ??
        (held && !isHeldQuoteTooOld(held, now, input.config.quoteMaxAgeMs)
          ? held
          : null);
      const sellCheck = validateSell(
        {
          symbol: trade.symbol,
          requestedQty: trade.qty,
          heldQty: trade.qty,
          status: trade.status,
          quote,
          marketOpen: isMarketOpenForTrading(),
        },
        input.config,
      );
      if (!sellCheck.ok || !quote) {
        verdict.allow = false;
        verdict.reason = `EXIT_NOW blocked by safety: ${sellCheck.reason}`;
        verdict.executeExit = false;
        await updateIfStillOpen(this.trades, trade.id, {
          lastAiReviewAt: now,
          lastAiAction: input.decision.action,
        });
      } else {
        const sold = await this.broker.sell({
          tradeId: trade.id,
          quote,
          reason: TradeExitReason.AI_EXIT,
          source: OrderSource.AI,
        });
        brokerOrderId = sold.fill.orderId || null;
        brokerStatus = sold.fill.status;
        if (sold.fill.filled) {
          fillPrice = sold.fill.fillPrice;
          fillQty = sold.fill.fillQty;
          pnlAfter = sold.pnl;
        } else {
          verdict.allow = false;
          verdict.reason = `Broker did not fill EXIT_NOW: ${sold.fill.rejectReason ?? sold.fill.status}`;
          await updateIfStillOpen(this.trades, trade.id, {
            lastAiReviewAt: now,
            lastAiAction: input.decision.action,
          });
        }
      }
    } else if (verdict.allow && verdict.applyStop && verdict.effectiveStop != null) {
      const stillOpen = await updateIfStillOpen(this.trades, trade.id, {
        stopLoss: priceString(verdict.effectiveStop),
        managementPhase: phaseAfter,
        lastAiReviewAt: new Date(),
        lastAiAction: input.decision.action,
      });
      if (!stillOpen) {
        verdict.allow = false;
        verdict.reason = 'Position was no longer OPEN; stop not applied';
        verdict.applyStop = false;
      }
    } else if (verdict.allow) {
      const stillOpen = await updateIfStillOpen(this.trades, trade.id, {
        managementPhase: phaseAfter,
        lastAiReviewAt: new Date(),
        lastAiAction: input.decision.action,
      });
      if (!stillOpen) {
        verdict.allow = false;
        verdict.reason = 'Position was no longer OPEN; AI action not applied';
      }
    } else {
      await updateIfStillOpen(this.trades, trade.id, {
        lastAiReviewAt: new Date(),
        lastAiAction: input.decision.action,
      });
      phaseAfter = trade.managementPhase ?? ManagementPhase.ACTIVE;
    }

    return this.persistDecision({
      accountId: input.accountId,
      snapshot: input.snapshot,
      events: input.events,
      triggeredBy: input.triggeredBy,
      promptHash: input.promptHash,
      decision: input.decision,
      verdict: {
        ...verdict,
        reason: verdict.reason,
      },
      config: input.config,
      brokerOrderId,
      brokerStatus,
      fillPrice,
      fillQty,
      pnlAfter,
      phaseAfter,
    });
  }

  private async persistDecision(input: {
    accountId: string;
    snapshot: PositionSnapshot;
    events: MarketEvent[];
    triggeredBy: string;
    promptHash: string;
    decision: AiPositionDecision;
    verdict: ReturnType<typeof validateAiDecision>;
    config: LiveConfig;
    brokerOrderId?: string | null;
    brokerStatus?: string | null;
    fillPrice?: number | null;
    fillQty?: number | null;
    pnlAfter?: number | null;
    phaseAfter?: ManagementPhase | null;
  }): Promise<CyclePositionSummary> {
    const phaseAfter =
      input.phaseAfter ??
      phaseAfterDecision(input.snapshot, input.decision, input.verdict);
    const row = this.decisions.create({
      accountId: input.accountId,
      tradeId: input.snapshot.tradeId,
      symbol: input.snapshot.symbol,
      triggeredBy: input.triggeredBy,
      events: input.events,
      snapshot: input.snapshot as unknown as Record<string, unknown>,
      aiInputVersion: AI_POSITION_PROMPT_VERSION,
      promptHash: input.promptHash,
      aiAction: input.decision.action,
      aiConfidence: String(input.decision.confidence),
      aiReason: input.decision.reason,
      suggestedStop:
        input.decision.suggestedStop != null
          ? priceString(input.decision.suggestedStop)
          : null,
      suggestedExitPrice:
        input.decision.suggestedExitPrice != null
          ? priceString(input.decision.suggestedExitPrice)
          : null,
      validationResult: input.verdict.allow ? 'ALLOW' : 'BLOCK',
      validationReason: input.verdict.reason,
      phaseBefore: input.snapshot.managementPhase,
      phaseAfter,
      brokerOrderId: input.brokerOrderId ?? null,
      brokerStatus: input.brokerStatus ?? null,
      fillPrice:
        input.fillPrice != null ? priceString(input.fillPrice) : null,
      fillQty: input.fillQty ?? null,
      pnlAfter:
        input.pnlAfter != null ? input.pnlAfter.toFixed(2) : null,
    });
    await this.decisions.save(row);

    return {
      symbol: input.snapshot.symbol,
      action: input.decision.action,
      allow: input.verdict.allow,
      reason: input.decision.reason,
      validation: input.verdict.reason,
      confidence: input.decision.confidence,
      ltp: input.snapshot.currentLtp,
      pnlPct: input.snapshot.currentPnlPct,
      pnl: input.snapshot.currentPnl,
      qty: input.snapshot.qty,
      entryPrice: input.snapshot.entryPrice,
      currentStop: input.snapshot.currentStop,
      currentTarget: input.snapshot.currentTarget,
      suggestedStop: input.decision.suggestedStop,
      suggestedExitPrice: input.decision.suggestedExitPrice,
      appliedStop: input.verdict.effectiveStop,
      fillPrice: input.fillPrice ?? null,
      fillQty: input.fillQty ?? null,
      events: input.events.map((e) => ({ type: e.type, message: e.message })),
    };
  }
}

function toTradeInput(trade: Trade): TradeSnapshotInput {
  return {
    id: trade.id,
    symbol: trade.symbol,
    qty: trade.qty,
    status: trade.status,
    managementPhase: trade.managementPhase,
    buyPrice: toNumber(trade.buyPrice ?? '0'),
    buyAt: trade.buyAt,
    buyLow: toNumber(trade.buyLow),
    buyHigh: toNumber(trade.buyHigh),
    stopLoss: toNumber(trade.stopLoss),
    sellTarget: toNumber(trade.sellTarget),
    initialStop: trade.initialStop != null ? toNumber(trade.initialStop) : null,
    originalTarget:
      trade.originalTarget != null ? toNumber(trade.originalTarget) : null,
    highWaterMark:
      trade.highWaterMark != null ? toNumber(trade.highWaterMark) : null,
    maxUnrealizedPct:
      trade.maxUnrealizedPct != null ? toNumber(trade.maxUnrealizedPct) : null,
    summary: trade.summary,
  };
}

function humanActionLabel(action: string): string {
  switch (action) {
    case 'HOLD':
      return 'keep holding';
    case 'PROTECT_PROFIT':
      return 'protect profit';
    case 'MOVE_STOP':
      return 'tighten the stop';
    case 'EXIT_NOW':
      return 'exit now';
    case 'TAKE_PARTIAL_PROFIT':
      return 'take partial profit';
    default:
      return action.toLowerCase().replace(/_/g, ' ');
  }
}

function reviewActivityMessage(
  triggeredBy: string,
  summaries: CyclePositionSummary[],
): string {
  const when =
    triggeredBy === 'EVENT' ? 'Event-driven review' : 'Scheduled review';
  if (summaries.length === 0) {
    return `${when}: no open positions.`;
  }
  const parts = summaries.map((s) => {
    const pnl = `${s.pnlPct >= 0 ? '+' : ''}${s.pnlPct.toFixed(2)}%`;
    const applied = s.allow ? '' : ', not applied';
    return `${s.symbol} — ${humanActionLabel(s.action)}${applied} (₹${s.ltp.toFixed(2)}, ${pnl})`;
  });
  return `${when}: ${parts.join('; ')}`;
}

function oldestReview(trades: Trade[]): number {
  const times = trades
    .map((t) => t.lastAiReviewAt?.getTime())
    .filter((n): n is number => n != null);
  if (times.length === 0) {
    return 0;
  }
  return Math.max(...times);
}
