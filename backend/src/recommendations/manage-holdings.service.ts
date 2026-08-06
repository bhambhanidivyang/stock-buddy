import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RecommendationConfig } from '../config/recommendation.config';
import { priceString, toNumber } from '../common/money';
import { Trade } from '../database/entities';
import { TradeStatus } from '../database/enums';
import type { CandidateBoard } from '../market/features/candidate.types';
import { atr } from '../market/indicators';
import {
  buildStructureLevels,
  mostRecentSupportBelow,
} from '../market/levels/structure';
import { YahooService } from '../market/yahoo.service';
import { planStructureTrail, sessionsHeldIst } from './manage-holdings';

export type HoldingsManagementResult = {
  tradeId: string;
  symbol: string;
  buyPrice: number;
  previousSellTarget: number;
  previousStopLoss: number;
  sellTarget: number;
  stopLoss: number;
  changed: boolean;
  reason: string;
  timeStop?: boolean;
};

@Injectable()
export class ManageHoldingsService {
  private readonly logger = new Logger(ManageHoldingsService.name);

  constructor(
    private readonly yahoo: YahooService,
    @InjectRepository(Trade)
    private readonly trades: Repository<Trade>,
  ) {}

  /**
   * Position Manager: trail stops on structure; time-stop after maxHoldSessions.
   * Does not recompute entry geometry.
   */
  async retargetOpenHoldings(input: {
    openTrades: Trade[];
    board: CandidateBoard;
    config: RecommendationConfig;
  }): Promise<HoldingsManagementResult[]> {
    const open = input.openTrades.filter(
      (t) => t.status === TradeStatus.OPEN && t.buyPrice != null && t.buyAt,
    );
    if (open.length === 0) {
      return [];
    }

    const maxHold = input.config.levels.maxHoldSessions;
    const results: HoldingsManagementResult[] = [];

    for (const trade of open) {
      const buyPrice = toNumber(trade.buyPrice!);
      const previousSellTarget = toNumber(trade.sellTarget);
      const previousStopLoss = toNumber(trade.stopLoss);

      const held = sessionsHeldIst(trade.buyAt!);
      if (held >= maxHold) {
        trade.status = TradeStatus.NEEDS_REVIEW;
        await this.trades.save(trade);
        this.logger.warn(
          `Time-stop ${trade.symbol}: held ${held} sessions >= ${maxHold} → NEEDS_REVIEW`,
        );
        results.push({
          tradeId: trade.id,
          symbol: trade.symbol,
          buyPrice,
          previousSellTarget,
          previousStopLoss,
          sellTarget: previousSellTarget,
          stopLoss: previousStopLoss,
          changed: false,
          reason: `time_stop_${held}_sessions`,
          timeStop: true,
        });
        continue;
      }

      const atr14 = await this.resolveAtr(trade.symbol, input.board);
      if (atr14 == null) {
        results.push({
          tradeId: trade.id,
          symbol: trade.symbol,
          buyPrice,
          previousSellTarget,
          previousStopLoss,
          sellTarget: previousSellTarget,
          stopLoss: previousStopLoss,
          changed: false,
          reason: 'missing ATR — left unchanged',
        });
        continue;
      }

      const structureLow = await this.resolveStructureLow(
        trade.symbol,
        buyPrice,
        atr14,
        input.config,
        input.board,
      );

      const plan = planStructureTrail({
        currentStopLoss: previousStopLoss,
        currentSellTarget: previousSellTarget,
        buyPrice,
        structureLow,
        atr: atr14,
        stopAtrBuffer: input.config.levels.stopAtrBuffer,
      });

      if (plan == null) {
        results.push({
          tradeId: trade.id,
          symbol: trade.symbol,
          buyPrice,
          previousSellTarget,
          previousStopLoss,
          sellTarget: previousSellTarget,
          stopLoss: previousStopLoss,
          changed: false,
          reason: 'could not trail',
        });
        continue;
      }

      if (plan.changed) {
        trade.stopLoss = priceString(plan.stopLoss);
        // sellTarget unchanged by contract
        await this.trades.save(trade);
        this.logger.log(
          `Trail ${trade.symbol}: stop ${previousStopLoss}→${plan.stopLoss} (${plan.reason})`,
        );
      }

      results.push({
        tradeId: trade.id,
        symbol: trade.symbol,
        buyPrice,
        previousSellTarget,
        previousStopLoss,
        sellTarget: plan.sellTarget,
        stopLoss: plan.stopLoss,
        changed: plan.changed,
        reason: plan.reason,
      });
    }

    const changedCount = results.filter((r) => r.changed).length;
    const timeStops = results.filter((r) => r.timeStop).length;
    this.logger.log(
      `Position manage: ${open.length} OPEN, ${changedCount} trail(s), ${timeStops} time-stop(s)`,
    );
    return results;
  }

  private async resolveAtr(
    symbol: string,
    board: CandidateBoard,
  ): Promise<number | null> {
    const c = board.candidates.find((x) => x.symbol === symbol);
    if (c?.technical.atr14 != null && c.technical.atr14 > 0) {
      return c.technical.atr14;
    }
    const bars = await this.yahoo.getDailyBars(symbol, 60);
    if (bars.length < 15) return null;
    const a = atr(bars, 14);
    return a != null && a > 0 ? a : null;
  }

  private async resolveStructureLow(
    symbol: string,
    buyPrice: number,
    atr14: number,
    config: RecommendationConfig,
    board: CandidateBoard,
  ): Promise<number | null> {
    void board;
    const bars = await this.yahoo.getDailyBars(symbol, 120);
    if (bars.length < 20) {
      return null;
    }
    const { supports } = buildStructureLevels(bars, atr14, {
      swingWindow: config.levels.swingWindow,
      clusterAtr: config.levels.clusterAtr,
      breakBufferAtr: config.levels.breakBufferAtr,
      minTouches: config.levels.minTouches,
    });
    const swing = mostRecentSupportBelow(supports, buyPrice);
    return swing?.levelPrice ?? null;
  }
}
