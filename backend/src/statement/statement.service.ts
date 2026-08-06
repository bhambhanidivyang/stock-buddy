import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountService } from '../account/account.service';
import { roundMoney, toNumber } from '../common/money';
import { Trade } from '../database/entities';
import { TradeStatus } from '../database/enums';
import { YahooService } from '../market/yahoo.service';
import { StatementDto } from './dtos/statement.dto';

type BoughtLot = {
  symbol: string;
  qty: number;
  buyPrice: number | null;
  stopLoss: number | null;
  sellTarget: number | null;
};

type DayBucket = {
  date: string;
  buyAmount: number;
  sellAmount: number;
  profitLoss: number;
  cash: number;
  holdingsValue: number;
  buyLots: BoughtLot[];
  sellsBySymbol: Map<string, number>;
  holdings: string;
};

@Injectable()
export class StatementService {
  constructor(
    private readonly accountService: AccountService,
    private readonly yahoo: YahooService,
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
  ) {}

  async getStatement(userId: string): Promise<StatementDto[]> {
    const account = await this.accountService.getAccountForUser(userId);
    const trades = await this.tradeRepository.find({
      where: { accountId: account.id },
    });

    const byDay = new Map<string, DayBucket>();
    const today = istDayKey(new Date());

    for (const trade of trades) {
      if (trade.buyAt) {
        const day = istDayKey(trade.buyAt);
        const bucket = getOrCreateDay(byDay, day);
        bucket.buyAmount = roundMoney(
          bucket.buyAmount + toNumber(trade.investedInr ?? '0'),
        );
        bucket.buyLots.push({
          symbol: trade.symbol,
          qty: trade.qty,
          buyPrice:
            trade.buyPrice != null ? toNumber(trade.buyPrice) : null,
          stopLoss: trade.stopLoss != null ? toNumber(trade.stopLoss) : null,
          sellTarget:
            trade.sellTarget != null ? toNumber(trade.sellTarget) : null,
        });
      }

      if (trade.sellAt) {
        const day = istDayKey(trade.sellAt);
        const bucket = getOrCreateDay(byDay, day);
        const proceeds = sellProceeds(trade);
        bucket.sellAmount = roundMoney(bucket.sellAmount + proceeds);
        bucket.sellsBySymbol.set(
          trade.symbol,
          (bucket.sellsBySymbol.get(trade.symbol) ?? 0) + trade.qty,
        );
        if (trade.realizedPnl != null) {
          bucket.profitLoss = roundMoney(
            bucket.profitLoss + toNumber(trade.realizedPnl),
          );
        }
      }
    }

    const hasLiveBook = trades.some((t) =>
      [
        TradeStatus.WAITING_BUY,
        TradeStatus.OPEN,
        TradeStatus.NEEDS_REVIEW,
      ].includes(t.status as TradeStatus),
    );
    if (hasLiveBook || byDay.size > 0) {
      getOrCreateDay(byDay, today);
    }

    const startingCash = toNumber(account.initialFund);
    const openToday = trades.filter(
      (t) =>
        t.buyAt &&
        (!t.sellAt || istDayKey(t.sellAt) > today) &&
        istDayKey(t.buyAt) <= today,
    );
    const todayQuotes =
      openToday.length > 0
        ? await this.yahoo.getQuotes(openToday.map((t) => t.symbol))
        : new Map();

    for (const bucket of byDay.values()) {
      bucket.cash = endOfDayCash(startingCash, trades, bucket.date);
      bucket.holdingsValue = endOfDayHoldingsValue(
        trades,
        bucket.date,
        bucket.date === today ? todayQuotes : null,
      );
      bucket.holdings = formatEndOfDayHoldings(trades, bucket.date);
    }

    return [...byDay.values()]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((bucket) => ({
        date: bucket.date,
        buyAmount: bucket.buyAmount,
        sellAmount: bucket.sellAmount,
        profitLoss: bucket.profitLoss,
        cash: bucket.cash,
        holdingsValue: bucket.holdingsValue,
        stocksBought: formatBoughtLots(bucket.buyLots),
        stocksSold: formatSymbolQty(bucket.sellsBySymbol),
        holdings: bucket.holdings,
      }));
  }
}

function sellProceeds(trade: Trade): number {
  if (trade.proceedsInr != null) {
    return toNumber(trade.proceedsInr);
  }
  return roundMoney(
    toNumber(trade.investedInr ?? '0') + toNumber(trade.realizedPnl ?? '0'),
  );
}

function endOfDayCash(
  startingCash: number,
  trades: Trade[],
  day: string,
): number {
  let cash = startingCash;
  for (const trade of trades) {
    if (trade.buyAt && istDayKey(trade.buyAt) <= day) {
      cash = roundMoney(cash - toNumber(trade.investedInr ?? '0'));
    }
    if (trade.sellAt && istDayKey(trade.sellAt) <= day) {
      cash = roundMoney(cash + sellProceeds(trade));
    }
  }
  return cash;
}

function endOfDayHoldingsValue(
  trades: Trade[],
  day: string,
  todayQuotes: Map<string, { price: number }> | null,
): number {
  let holdings = 0;
  for (const trade of trades) {
    if (!isOpenAtEndOfDay(trade, day)) {
      continue;
    }
    const cost = toNumber(trade.investedInr ?? '0');
    if (todayQuotes) {
      const mark = todayQuotes.get(trade.symbol)?.price;
      holdings += mark != null ? mark * trade.qty : cost;
    } else {
      holdings += cost;
    }
  }
  return roundMoney(holdings);
}

/** Lots open at EOD; same-day buys tagged with "· new". */
function formatEndOfDayHoldings(trades: Trade[], day: string): string {
  type Line = { symbol: string; qty: number; boughtToday: boolean };
  const lines = new Map<string, Line>();

  for (const trade of trades) {
    if (!isOpenAtEndOfDay(trade, day) || !trade.buyAt) {
      continue;
    }
    const boughtToday = istDayKey(trade.buyAt) === day;
    const key = `${trade.symbol}|${boughtToday ? 'new' : 'carry'}`;
    const existing = lines.get(key);
    if (existing) {
      existing.qty += trade.qty;
    } else {
      lines.set(key, {
        symbol: trade.symbol,
        qty: trade.qty,
        boughtToday,
      });
    }
  }

  return [...lines.values()]
    .sort((a, b) => {
      if (a.boughtToday !== b.boughtToday) {
        return a.boughtToday ? -1 : 1;
      }
      return a.symbol.localeCompare(b.symbol);
    })
    .map((line) =>
      line.boughtToday
        ? `${line.qty}x${line.symbol} · new`
        : `${line.qty}x${line.symbol}`,
    )
    .join(', ');
}

function isOpenAtEndOfDay(trade: Trade, day: string): boolean {
  if (!trade.buyAt || istDayKey(trade.buyAt) > day) {
    return false;
  }
  if (trade.sellAt && istDayKey(trade.sellAt) <= day) {
    return false;
  }
  return true;
}

function istDayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getOrCreateDay(
  byDay: Map<string, DayBucket>,
  day: string,
): DayBucket {
  let bucket = byDay.get(day);
  if (!bucket) {
    bucket = {
      date: day,
      buyAmount: 0,
      sellAmount: 0,
      profitLoss: 0,
      cash: 0,
      holdingsValue: 0,
      buyLots: [],
      sellsBySymbol: new Map(),
      holdings: '',
    };
    byDay.set(day, bucket);
  }
  return bucket;
}

function formatSymbolQty(bySymbol: Map<string, number>): string {
  return [...bySymbol.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([symbol, qty]) => `${qty}x${symbol}`)
    .join(', ');
}

/** e.g. "100xGAIL @180 SL174 T186.75" — levels omitted if missing. */
function formatBoughtLots(lots: BoughtLot[]): string {
  return [...lots]
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map((lot) => {
      const head = `${lot.qty}x${lot.symbol}`;
      if (
        lot.buyPrice == null ||
        lot.stopLoss == null ||
        lot.sellTarget == null
      ) {
        return head;
      }
      return `${head} @${formatLevel(lot.buyPrice)} SL${formatLevel(lot.stopLoss)} T${formatLevel(lot.sellTarget)}`;
    })
    .join(', ');
}

function formatLevel(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  // Trim trailing zeros but keep up to 2 decimals for rupee prices.
  return Number(value.toFixed(2)).toString();
}
