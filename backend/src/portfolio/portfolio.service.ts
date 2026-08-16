import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AccountService } from '../account/account.service';
import { priceString, roundMoney, toNumber } from '../common/money';
import { Trade } from '../database/entities';
import { OrderSource, TradeExitReason, TradeStatus } from '../database/enums';
import { loadLiveConfig } from '../live/live.config';
import { LiveMarketDataService } from '../live/live-market-data.service';
import { validateSell } from '../live/order-safety.validator';
import { PaperBrokerService } from '../live/paper-broker.service';
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
    private readonly liveData: LiveMarketDataService,
    private readonly broker: PaperBrokerService,
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
    if (dto.sellTarget != null && dto.stopLoss != null) {
      await this.trades.save(trade);
    }

    const sellQty = dto.qty ?? trade.qty;
    const quote = await this.liveData.getExecutionQuote(trade.symbol);
    const liveConfig = loadLiveConfig();
    const safety = validateSell(
      {
        symbol: trade.symbol,
        requestedQty: sellQty,
        heldQty: trade.qty,
        status: trade.status,
        quote,
        marketOpen: isMarketOpenForTrading(),
      },
      liveConfig,
    );
    if (!safety.ok || !quote) {
      throw new BadRequestException(
        safety.reason || `No live quote for ${trade.symbol}; sell blocked`,
      );
    }

    const sold = await this.broker.sell({
      tradeId: trade.id,
      quote,
      qty: sellQty,
      reason: TradeExitReason.HUMAN_SELL,
      source: OrderSource.HUMAN,
    });
    if (!sold.fill.filled) {
      throw new BadRequestException(
        sold.fill.rejectReason ??
          `Broker did not fill sell (${sold.fill.status})`,
      );
    }

    const remaining = sold.remainingTradeId
      ? await this.trades.findOne({ where: { id: sold.remainingTradeId } })
      : null;
    const account = await this.accounts.getAccountById(trade.accountId);
    const held = remaining ?? trade;
    return {
      tradeId: sold.closedTradeId ?? trade.id,
      remainingTradeId: sold.remainingTradeId,
      symbol: sold.symbol,
      action: ReviewTradeAction.SELL,
      status: sold.qtyRemaining === 0 ? TradeStatus.CLOSED : held.status,
      qtySold: sold.qtySold,
      qtyRemaining: sold.qtyRemaining,
      sellPrice: sold.price,
      proceeds:
        sold.price != null ? roundMoney(sold.price * sold.qtySold) : 0,
      realizedPnl: sold.pnl,
      cash: toNumber(account.cash),
      sellTarget: toNumber(held.sellTarget),
      stopLoss: toNumber(held.stopLoss),
    };
  }
}

function moneyFallback(buyPrice: number, qty: number): number {
  return roundMoney(buyPrice * qty);
}
