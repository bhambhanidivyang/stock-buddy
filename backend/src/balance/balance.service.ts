import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AccountService } from '../account/account.service';
import { moneyString, roundMoney, toNumber } from '../common/money';
import { Trade } from '../database/entities';
import { TradeStatus } from '../database/enums';
import { YahooService } from '../market/yahoo.service';

@Injectable()
export class BalanceService {
  constructor(
    private readonly accounts: AccountService,
    private readonly yahoo: YahooService,
    @InjectRepository(Trade)
    private readonly trades: Repository<Trade>,
  ) {}

  async getBalance(userId: string) {
    const account = await this.accounts.getAccountForUser(userId);
    const heldTrades = await this.trades.find({
      where: {
        accountId: account.id,
        status: In([TradeStatus.OPEN, TradeStatus.NEEDS_REVIEW]),
      },
    });

    const quotes = await this.yahoo.getQuotes(
      heldTrades.map((trade) => trade.symbol),
    );

    let holdingsValue = 0;
    let invested = 0;
    let openPositions = 0;
    let needsReviewPositions = 0;

    for (const trade of heldTrades) {
      const quote = quotes.get(trade.symbol);
      const mark = quote?.price ?? toNumber(trade.buyPrice ?? '0');
      holdingsValue += mark * trade.qty;
      invested += toNumber(trade.investedInr ?? '0');
      if (trade.status === TradeStatus.OPEN) {
        openPositions += 1;
      } else {
        needsReviewPositions += 1;
      }
    }

    const cash = toNumber(account.cash);
    holdingsValue = roundMoney(holdingsValue);
    invested = roundMoney(invested);
    const equity = roundMoney(cash + holdingsValue);
    const unrealizedPnl = roundMoney(holdingsValue - invested);

    return {
      accountId: account.id,
      initialFund: toNumber(account.initialFund),
      cash,
      holdingsValue,
      invested,
      equity,
      unrealizedPnl,
      realizedPnl: toNumber(account.realizedPnl),
      openPositions,
      needsReviewPositions,
      asOf: new Date().toISOString(),
      cashDisplay: moneyString(cash),
      equityDisplay: moneyString(equity),
    };
  }
}
