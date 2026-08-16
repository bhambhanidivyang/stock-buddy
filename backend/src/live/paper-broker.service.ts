import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import {
  moneyString,
  priceString,
  roundMoney,
  toNumber,
} from '../common/money';
import {
  Account,
  BrokerOrder,
  Trade,
} from '../database/entities';
import {
  BrokerOrderStatus,
  ManagementPhase,
  OrderSide,
  OrderSource,
  TradeExitReason,
  TradeStatus,
} from '../database/enums';
import type { ExecutionQuote } from './types';
import { OrderReconciliationService, type ReconciledFill } from './order-reconciliation.service';

export type PaperBuyResult = {
  fill: ReconciledFill;
  symbol: string;
  qty: number;
  price: number | null;
};

export type PaperSellResult = {
  fill: ReconciledFill;
  symbol: string;
  qtySold: number;
  qtyRemaining: number;
  price: number | null;
  pnl: number | null;
  closedTradeId: string | null;
  remainingTradeId: string | null;
};

@Injectable()
export class PaperBrokerService {
  private readonly logger = new Logger(PaperBrokerService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly activityLogs: ActivityLogsService,
    private readonly reconciliation: OrderReconciliationService,
  ) {}

  async buy(input: {
    tradeId: string;
    quote: ExecutionQuote;
    source?: OrderSource;
  }): Promise<PaperBuyResult> {
    const source = input.source ?? OrderSource.OMS;
    const price = input.quote.price;

    const result = await this.dataSource.transaction(async (manager) => {
      const trade = await manager.findOne(Trade, {
        where: { id: input.tradeId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!trade || trade.status !== TradeStatus.WAITING_BUY) {
        return null;
      }

      const order = await manager.save(
        manager.create(BrokerOrder, {
          accountId: trade.accountId,
          tradeId: trade.id,
          symbol: trade.symbol,
          side: OrderSide.BUY,
          qty: trade.qty,
          status: BrokerOrderStatus.ORDER_REQUESTED,
          source,
          broker: 'paper',
          requestedPrice: null,
        }),
      );
      order.status = BrokerOrderStatus.ORDER_PLACED;
      await manager.save(order);

      const account = await manager.findOne(Account, {
        where: { id: trade.accountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        order.status = BrokerOrderStatus.REJECTED;
        order.rejectReason = 'Account not found';
        await manager.save(order);
        return { order, trade: null as Trade | null, cost: 0 };
      }

      const cost = roundMoney(price * trade.qty);
      const cash = toNumber(account.cash);
      if (cash < cost) {
        order.status = BrokerOrderStatus.REJECTED;
        order.rejectReason = `Insufficient cash: need ${cost}, have ${cash}`;
        await manager.save(order);
        this.logger.warn(order.rejectReason);
        return { order, trade: null, cost };
      }

      account.cash = moneyString(cash - cost);
      trade.status = TradeStatus.OPEN;
      trade.buyPrice = priceString(price);
      trade.buyAt = new Date();
      trade.investedInr = moneyString(cost);
      trade.managementPhase = ManagementPhase.ENTRY;
      trade.initialStop = trade.stopLoss;
      trade.originalTarget = trade.sellTarget;
      trade.highWaterMark = priceString(price);
      trade.maxUnrealizedPct = '0';

      order.status = BrokerOrderStatus.FILLED;
      order.fillPrice = priceString(price);
      order.fillQty = trade.qty;
      order.filledAt = new Date();

      await manager.save(account);
      await manager.save(trade);
      await manager.save(order);
      return { order, trade, cost };
    });

    if (!result) {
      return {
        fill: {
          orderId: '',
          status: BrokerOrderStatus.CANCELLED,
          filled: false,
          fillQty: 0,
          fillPrice: null,
          rejectReason: 'Trade is no longer WAITING_BUY',
        },
        symbol: '',
        qty: 0,
        price: null,
      };
    }

    const fill = this.reconciliation.toFill(result.order);
    if (fill.filled && result.trade) {
      this.logger.log(
        `BUY ${result.trade.symbol} qty=${result.trade.qty} @ ${price} cost=${result.cost}`,
      );
      await this.activityLogs.append({
        accountId: result.trade.accountId,
        category: 'EXECUTION',
        eventCode: 'EXEC_BOUGHT',
        message: `Bought: ${result.trade.symbol} qty=${result.trade.qty} @ ${price}`,
        refId: result.trade.executionSessionId,
        meta: {
          accountId: result.trade.accountId,
          sessionId: result.trade.executionSessionId,
          symbol: result.trade.symbol,
          qty: result.trade.qty,
          price,
          cost: result.cost,
          orderId: result.order.id,
        },
      });
    }

    return {
      fill,
      symbol: result.order.symbol,
      qty: result.order.qty,
      price: fill.fillPrice,
    };
  }

  async sell(input: {
    tradeId: string;
    quote: ExecutionQuote;
    reason: TradeExitReason;
    qty?: number;
    source?: OrderSource;
  }): Promise<PaperSellResult> {
    const source = input.source ?? OrderSource.OMS;
    const price = input.quote.price;

    const result = await this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(Trade, {
        where: { id: input.tradeId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !locked ||
        (locked.status !== TradeStatus.OPEN &&
          locked.status !== TradeStatus.NEEDS_REVIEW)
      ) {
        return null;
      }

      const sellQty = input.qty ?? locked.qty;
      const order = await manager.save(
        manager.create(BrokerOrder, {
          accountId: locked.accountId,
          tradeId: locked.id,
          symbol: locked.symbol,
          side: OrderSide.SELL,
          qty: sellQty,
          status: BrokerOrderStatus.ORDER_REQUESTED,
          source,
          broker: 'paper',
          requestedPrice: null,
        }),
      );
      order.status = BrokerOrderStatus.ORDER_PLACED;
      await manager.save(order);

      if (!Number.isInteger(sellQty) || sellQty < 1 || sellQty > locked.qty) {
        order.status = BrokerOrderStatus.REJECTED;
        order.rejectReason = `qty ${sellQty} exceeds held ${locked.qty}`;
        await manager.save(order);
        return {
          order,
          pnl: null as number | null,
          qtySold: 0,
          qtyRemaining: locked.qty,
          closedTradeId: null as string | null,
          remainingTradeId: locked.id,
          accountId: locked.accountId,
          sessionId: locked.executionSessionId,
          symbol: locked.symbol,
        };
      }

      const account = await manager.findOne(Account, {
        where: { id: locked.accountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        throw new NotFoundException('Account not found');
      }

      const investedTotal = toNumber(
        locked.investedInr ??
          moneyFallback(toNumber(locked.buyPrice ?? '0'), locked.qty),
      );
      const investedSold = roundMoney((investedTotal * sellQty) / locked.qty);
      const proceeds = roundMoney(price * sellQty);
      const pnl = roundMoney(proceeds - investedSold);

      account.cash = moneyString(toNumber(account.cash) + proceeds);
      account.realizedPnl = moneyString(toNumber(account.realizedPnl) + pnl);

      const remainingQty = locked.qty - sellQty;
      let remainingTradeId: string | null = null;
      let closedTradeId: string;

      if (remainingQty === 0) {
        locked.status = TradeStatus.CLOSED;
        locked.exitReason = input.reason;
        locked.sellPrice = priceString(price);
        locked.sellAt = new Date();
        locked.proceedsInr = moneyString(proceeds);
        locked.realizedPnl = moneyString(pnl);
        locked.investedInr = moneyString(investedSold);
        await manager.save(account);
        await manager.save(locked);
        closedTradeId = locked.id;
      } else {
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
          exitReason: input.reason,
          buyPrice: locked.buyPrice,
          buyAt: locked.buyAt,
          sellPrice: priceString(price),
          sellAt: new Date(),
          investedInr: moneyString(investedSold),
          proceedsInr: moneyString(proceeds),
          realizedPnl: moneyString(pnl),
          managementPhase: locked.managementPhase,
          initialStop: locked.initialStop,
          originalTarget: locked.originalTarget,
          highWaterMark: locked.highWaterMark,
          maxUnrealizedPct: locked.maxUnrealizedPct,
        });
        const savedClosed = await manager.save(closed);
        closedTradeId = savedClosed.id;
        locked.qty = remainingQty;
        locked.investedInr = moneyString(
          roundMoney(investedTotal - investedSold),
        );
        await manager.save(account);
        await manager.save(locked);
        remainingTradeId = locked.id;
      }

      order.status = BrokerOrderStatus.FILLED;
      order.fillPrice = priceString(price);
      order.fillQty = sellQty;
      order.filledAt = new Date();
      await manager.save(order);

      return {
        order,
        pnl,
        qtySold: sellQty,
        qtyRemaining: remainingQty,
        closedTradeId,
        remainingTradeId,
        accountId: locked.accountId,
        sessionId: locked.executionSessionId,
        symbol: locked.symbol,
      };
    });

    if (!result) {
      return {
        fill: {
          orderId: '',
          status: BrokerOrderStatus.CANCELLED,
          filled: false,
          fillQty: 0,
          fillPrice: null,
          rejectReason: 'Trade is no longer OPEN or NEEDS_REVIEW',
        },
        symbol: '',
        qtySold: 0,
        qtyRemaining: 0,
        price: null,
        pnl: null,
        closedTradeId: null,
        remainingTradeId: null,
      };
    }

    const fill = this.reconciliation.toFill(result.order);
    if (fill.filled) {
      this.logger.log(
        `SELL ${result.symbol} qty=${result.qtySold} @ ${price} reason=${input.reason} pnl=${result.pnl}`,
      );
      await this.activityLogs.append({
        accountId: result.accountId,
        category: 'EXECUTION',
        eventCode: 'EXEC_SOLD',
        message: `Sold: ${result.symbol} qty=${result.qtySold} @ ${price} (${input.reason}, P&L ₹${result.pnl})`,
        refId: result.sessionId,
        meta: {
          accountId: result.accountId,
          sessionId: result.sessionId,
          symbol: result.symbol,
          qty: result.qtySold,
          price,
          reason: input.reason,
          pnl: result.pnl,
          orderId: result.order.id,
          source,
        },
      });
    }

    return {
      fill,
      symbol: result.symbol,
      qtySold: result.qtySold,
      qtyRemaining: result.qtyRemaining,
      price: fill.fillPrice,
      pnl: result.pnl,
      closedTradeId: result.closedTradeId,
      remainingTradeId: result.remainingTradeId,
    };
  }
}

function moneyFallback(buyPrice: number, qty: number): number {
  return roundMoney(buyPrice * qty);
}
