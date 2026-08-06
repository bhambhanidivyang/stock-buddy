import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AccountService } from '../account/account.service';
import {
  moneyString,
  priceString,
  roundMoney,
  toNumber,
} from '../common/money';
import { Account, Trade } from '../database/entities';
import { TradeExitReason, TradeStatus } from '../database/enums';
import { isMarketOpenForTrading } from '../market/market-clock';
import { YahooService } from '../market/yahoo.service';
import {
  ReviewTradeAction,
  ReviewTradeDto,
} from './dtos/review-trade.dto';

@Injectable()
export class PortfolioService {
  constructor(
    private readonly accounts: AccountService,
    private readonly yahoo: YahooService,
    private readonly dataSource: DataSource,
    @InjectRepository(Trade)
    private readonly trades: Repository<Trade>,
  ) {}

  async getPortfolio(userId: string) {
    const account = await this.accounts.getAccountForUser(userId);
    const heldTrades = await this.trades.find({
      where: {
        accountId: account.id,
        status: In([TradeStatus.OPEN, TradeStatus.NEEDS_REVIEW]),
      },
      order: { buyAt: 'DESC' },
    });

    const quotes = await this.yahoo.getQuotes(
      heldTrades.map((trade) => trade.symbol),
    );

    const holdings = heldTrades.map((trade) => {
      const buyPrice = toNumber(trade.buyPrice ?? '0');
      const invested = toNumber(
        trade.investedInr ?? moneyFallback(buyPrice, trade.qty),
      );
      const currentPrice = quotes.get(trade.symbol)?.price ?? buyPrice;
      const marketValue = roundMoney(currentPrice * trade.qty);
      const unrealizedPnl = roundMoney(marketValue - invested);

      return {
        tradeId: trade.id,
        symbol: trade.symbol,
        qty: trade.qty,
        role: trade.role,
        buyPrice,
        buyAt: trade.buyAt,
        invested,
        currentPrice,
        marketValue,
        unrealizedPnl,
        buyLow: toNumber(trade.buyLow),
        buyHigh: toNumber(trade.buyHigh),
        sellTarget: toNumber(trade.sellTarget),
        stopLoss: toNumber(trade.stopLoss),
        summary: trade.summary,
        recommendationItemId: trade.recommendationItemId,
        executionSessionId: trade.executionSessionId,
        status: trade.status,
        needsHumanReview: trade.status === TradeStatus.NEEDS_REVIEW,
      };
    });

    const active = holdings.filter((h) => h.status === TradeStatus.OPEN);
    const needsReview = holdings.filter(
      (h) => h.status === TradeStatus.NEEDS_REVIEW,
    );

    const sumHoldings = (rows: typeof holdings) =>
      rows.reduce(
        (acc, row) => {
          acc.invested = roundMoney(acc.invested + row.invested);
          acc.marketValue = roundMoney(acc.marketValue + row.marketValue);
          acc.unrealizedPnl = roundMoney(acc.unrealizedPnl + row.unrealizedPnl);
          return acc;
        },
        { invested: 0, marketValue: 0, unrealizedPnl: 0 },
      );

    return {
      accountId: account.id,
      asOf: new Date().toISOString(),
      holdings,
      needsReview,
      totals: sumHoldings(holdings),
      openTotals: sumHoldings(active),
      needsReviewTotals: sumHoldings(needsReview),
    };
  }

  /**
   * Human decision on a parked NEEDS_REVIEW lot:
   * - SELL: paper sell at live Yahoo mark (NSE regular session only)
   * - RESUME: return to OPEN so the execution loop manages target/stop again
   */
  async reviewTrade(userId: string, tradeId: string, dto: ReviewTradeDto) {
    const account = await this.accounts.getAccountForUser(userId);
    const trade = await this.trades.findOne({
      where: { id: tradeId, accountId: account.id },
    });
    if (!trade) {
      throw new NotFoundException(`Trade ${tradeId} not found`);
    }
    if (trade.status !== TradeStatus.NEEDS_REVIEW) {
      throw new BadRequestException(
        `Trade ${trade.symbol} is ${trade.status}, only NEEDS_REVIEW can be reviewed`,
      );
    }

    if (dto.action === ReviewTradeAction.RESUME) {
      return this.resumeTrade(trade, dto);
    }
    return this.sellReviewedTrade(trade, dto);
  }

  private applyRetarget(trade: Trade, dto: ReviewTradeDto) {
    if (dto.sellTarget != null && dto.stopLoss != null) {
      if (dto.sellTarget <= dto.stopLoss) {
        throw new BadRequestException('sellTarget must be above stopLoss');
      }
      trade.sellTarget = priceString(dto.sellTarget);
      trade.stopLoss = priceString(dto.stopLoss);
    } else if (dto.sellTarget != null || dto.stopLoss != null) {
      throw new BadRequestException(
        'Provide both sellTarget and stopLoss to retarget, or neither',
      );
    }
  }

  private async resumeTrade(trade: Trade, dto: ReviewTradeDto) {
    this.applyRetarget(trade, dto);

    trade.status = TradeStatus.OPEN;
    await this.trades.save(trade);

    return {
      tradeId: trade.id,
      symbol: trade.symbol,
      action: ReviewTradeAction.RESUME,
      status: trade.status,
      sellTarget: toNumber(trade.sellTarget),
      stopLoss: toNumber(trade.stopLoss),
    };
  }

  private async sellReviewedTrade(trade: Trade, dto: ReviewTradeDto) {
    // Validate retarget early (before quote / market checks).
    this.applyRetarget(trade, dto);

    if (!isMarketOpenForTrading()) {
      throw new BadRequestException(
        'Paper sell requires NSE regular session (09:15–15:30 IST)',
      );
    }

    const quotes = await this.yahoo.getQuotes([trade.symbol]);
    const mark = quotes.get(trade.symbol)?.price;
    if (mark == null || !(mark > 0)) {
      throw new BadRequestException(
        `No live quote for ${trade.symbol}; cannot paper sell`,
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(Trade, {
        where: { id: trade.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.status !== TradeStatus.NEEDS_REVIEW) {
        throw new BadRequestException('Trade is no longer NEEDS_REVIEW');
      }

      this.applyRetarget(locked, dto);

      const account = await manager.findOne(Account, {
        where: { id: locked.accountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        throw new NotFoundException('Account not found');
      }

      const proceeds = roundMoney(mark * locked.qty);
      const invested = toNumber(locked.investedInr ?? '0');
      const pnl = roundMoney(proceeds - invested);

      account.cash = moneyString(toNumber(account.cash) + proceeds);
      account.realizedPnl = moneyString(toNumber(account.realizedPnl) + pnl);

      locked.status = TradeStatus.CLOSED;
      locked.exitReason = TradeExitReason.HUMAN_SELL;
      locked.sellPrice = priceString(mark);
      locked.sellAt = new Date();
      locked.proceedsInr = moneyString(proceeds);
      locked.realizedPnl = moneyString(pnl);

      await manager.save(account);
      await manager.save(locked);

      return {
        tradeId: locked.id,
        symbol: locked.symbol,
        action: ReviewTradeAction.SELL,
        status: locked.status,
        sellPrice: mark,
        proceeds,
        realizedPnl: pnl,
        cash: toNumber(account.cash),
      };
    });

    return result;
  }
}

function moneyFallback(buyPrice: number, qty: number): number {
  return roundMoney(buyPrice * qty);
}
