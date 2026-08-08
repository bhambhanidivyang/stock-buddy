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

const MANAGEABLE: TradeStatus[] = [
  TradeStatus.OPEN,
  TradeStatus.NEEDS_REVIEW,
];

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
   * Human manage on OPEN / NEEDS_REVIEW lots:
   * - MODIFY: update sellTarget + stopLoss
   * - SELL: paper sell full or partial qty at live Yahoo mark (NSE hours)
   * - RESUME: NEEDS_REVIEW → OPEN (optional retarget)
   */
  async reviewTrade(userId: string, tradeId: string, dto: ReviewTradeDto) {
    const account = await this.accounts.getAccountForUser(userId);
    const trade = await this.trades.findOne({
      where: { id: tradeId, accountId: account.id },
    });
    if (!trade) {
      throw new NotFoundException(`Trade ${tradeId} not found`);
    }
    if (!MANAGEABLE.includes(trade.status)) {
      throw new BadRequestException(
        `Trade ${trade.symbol} is ${trade.status}; only OPEN or NEEDS_REVIEW can be managed`,
      );
    }

    if (dto.action === ReviewTradeAction.RESUME) {
      if (trade.status !== TradeStatus.NEEDS_REVIEW) {
        throw new BadRequestException(
          `RESUME only applies to NEEDS_REVIEW lots (got ${trade.status})`,
        );
      }
      return this.resumeTrade(trade, dto);
    }

    if (dto.action === ReviewTradeAction.MODIFY) {
      return this.modifyTrade(trade, dto);
    }

    return this.sellTrade(trade, dto);
  }

  private applyRetarget(trade: Trade, dto: ReviewTradeDto, required: boolean) {
    if (dto.sellTarget != null && dto.stopLoss != null) {
      if (dto.sellTarget <= dto.stopLoss) {
        throw new BadRequestException('sellTarget must be above stopLoss');
      }
      trade.sellTarget = priceString(dto.sellTarget);
      trade.stopLoss = priceString(dto.stopLoss);
      return;
    }
    if (required) {
      throw new BadRequestException(
        'MODIFY requires both sellTarget and stopLoss',
      );
    }
    if (dto.sellTarget != null || dto.stopLoss != null) {
      throw new BadRequestException(
        'Provide both sellTarget and stopLoss to retarget, or neither',
      );
    }
  }

  private async modifyTrade(trade: Trade, dto: ReviewTradeDto) {
    this.applyRetarget(trade, dto, true);
    await this.trades.save(trade);
    return {
      tradeId: trade.id,
      symbol: trade.symbol,
      action: ReviewTradeAction.MODIFY,
      status: trade.status,
      qty: trade.qty,
      sellTarget: toNumber(trade.sellTarget),
      stopLoss: toNumber(trade.stopLoss),
    };
  }

  private async resumeTrade(trade: Trade, dto: ReviewTradeDto) {
    this.applyRetarget(trade, dto, false);

    trade.status = TradeStatus.OPEN;
    await this.trades.save(trade);

    return {
      tradeId: trade.id,
      symbol: trade.symbol,
      action: ReviewTradeAction.RESUME,
      status: trade.status,
      qty: trade.qty,
      sellTarget: toNumber(trade.sellTarget),
      stopLoss: toNumber(trade.stopLoss),
    };
  }

  private async sellTrade(trade: Trade, dto: ReviewTradeDto) {
    this.applyRetarget(trade, dto, false);

    if (!isMarketOpenForTrading()) {
      throw new BadRequestException(
        'Paper sell requires NSE regular session (09:15–15:30 IST)',
      );
    }

    const sellQty = dto.qty ?? trade.qty;
    if (!Number.isInteger(sellQty) || sellQty < 1 || sellQty > trade.qty) {
      throw new BadRequestException(
        `qty must be an integer between 1 and ${trade.qty}`,
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
      if (!locked || !MANAGEABLE.includes(locked.status)) {
        throw new BadRequestException(
          'Trade is no longer OPEN or NEEDS_REVIEW',
        );
      }
      if (sellQty > locked.qty) {
        throw new BadRequestException(
          `qty ${sellQty} exceeds current lot size ${locked.qty}`,
        );
      }

      this.applyRetarget(locked, dto, false);

      const account = await manager.findOne(Account, {
        where: { id: locked.accountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        throw new NotFoundException('Account not found');
      }

      const investedTotal = toNumber(
        locked.investedInr ?? moneyFallback(toNumber(locked.buyPrice ?? '0'), locked.qty),
      );
      const investedSold = roundMoney((investedTotal * sellQty) / locked.qty);
      const proceeds = roundMoney(mark * sellQty);
      const pnl = roundMoney(proceeds - investedSold);

      account.cash = moneyString(toNumber(account.cash) + proceeds);
      account.realizedPnl = moneyString(toNumber(account.realizedPnl) + pnl);

      const remainingQty = locked.qty - sellQty;
      let remainingTradeId: string | null = null;
      let closedTradeId: string;

      if (remainingQty === 0) {
        locked.status = TradeStatus.CLOSED;
        locked.exitReason = TradeExitReason.HUMAN_SELL;
        locked.sellPrice = priceString(mark);
        locked.sellAt = new Date();
        locked.proceedsInr = moneyString(proceeds);
        locked.realizedPnl = moneyString(pnl);
        locked.investedInr = moneyString(investedSold);
        await manager.save(account);
        await manager.save(locked);
        closedTradeId = locked.id;
      } else {
        // Closed sibling for the sold slice (statements / history).
        const closed = manager.create(Trade, {
          accountId: locked.accountId,
          recommendationItemId: locked.recommendationItemId,
          executionSessionId: locked.executionSessionId,
          symbol: locked.symbol,
          qty: sellQty,
          role: locked.role,
          buyLow: locked.buyLow,
          buyHigh: locked.buyHigh,
          sellTarget: locked.sellTarget,
          stopLoss: locked.stopLoss,
          summary: locked.summary,
          status: TradeStatus.CLOSED,
          exitReason: TradeExitReason.HUMAN_SELL,
          buyPrice: locked.buyPrice,
          buyAt: locked.buyAt,
          sellPrice: priceString(mark),
          sellAt: new Date(),
          investedInr: moneyString(investedSold),
          proceedsInr: moneyString(proceeds),
          realizedPnl: moneyString(pnl),
        });
        const savedClosed = await manager.save(closed);
        closedTradeId = savedClosed.id;

        locked.qty = remainingQty;
        locked.investedInr = moneyString(
          roundMoney(investedTotal - investedSold),
        );
        // Keep OPEN if it was OPEN; leave NEEDS_REVIEW as-is for remainder.
        await manager.save(account);
        await manager.save(locked);
        remainingTradeId = locked.id;
      }

      return {
        tradeId: closedTradeId,
        remainingTradeId,
        symbol: locked.symbol,
        action: ReviewTradeAction.SELL,
        status:
          remainingQty === 0 ? TradeStatus.CLOSED : locked.status,
        qtySold: sellQty,
        qtyRemaining: remainingQty,
        sellPrice: mark,
        proceeds,
        realizedPnl: pnl,
        cash: toNumber(account.cash),
        sellTarget: toNumber(locked.sellTarget),
        stopLoss: toNumber(locked.stopLoss),
      };
    });

    return result;
  }
}

function moneyFallback(buyPrice: number, qty: number): number {
  return roundMoney(buyPrice * qty);
}
