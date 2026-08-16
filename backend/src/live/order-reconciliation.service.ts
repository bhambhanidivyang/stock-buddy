import { Injectable } from '@nestjs/common';
import { toNumber } from '../common/money';
import { BrokerOrder } from '../database/entities';
import { BrokerOrderStatus } from '../database/enums';

export type ReconciledFill = {
  orderId: string;
  status: BrokerOrderStatus;
  filled: boolean;
  fillQty: number;
  fillPrice: number | null;
  rejectReason: string | null;
};

/**
 * Maps broker order state to an internal fill. Callers must not assume
 * an order request succeeded until this reports filled=true.
 */
@Injectable()
export class OrderReconciliationService {
  toFill(order: BrokerOrder): ReconciledFill {
    const filled = order.status === BrokerOrderStatus.FILLED;
    return {
      orderId: order.id,
      status: order.status,
      filled,
      fillQty: filled ? (order.fillQty ?? 0) : 0,
      fillPrice:
        filled && order.fillPrice != null ? toNumber(order.fillPrice) : null,
      rejectReason: order.rejectReason,
    };
  }
}
