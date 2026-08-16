import { BrokerOrderStatus } from '../database/enums';
import { OrderReconciliationService } from './order-reconciliation.service';
import type { BrokerOrder } from '../database/entities';

function order(
  status: BrokerOrderStatus,
  extra: Partial<BrokerOrder> = {},
): BrokerOrder {
  return {
    id: 'ord-1',
    status,
    fillQty: extra.fillQty ?? null,
    fillPrice: extra.fillPrice ?? null,
    rejectReason: extra.rejectReason ?? null,
    ...extra,
  } as BrokerOrder;
}

describe('broker order state is the source of truth', () => {
  const recon = new OrderReconciliationService();

  it('ORDER_REQUESTED / ORDER_PLACED / ORDER_OPEN do not count as a fill', () => {
    for (const status of [
      BrokerOrderStatus.ORDER_REQUESTED,
      BrokerOrderStatus.ORDER_PLACED,
      BrokerOrderStatus.ORDER_OPEN,
    ]) {
      const fill = recon.toFill(order(status, { fillQty: 10, fillPrice: '1870' }));
      expect(fill.filled).toBe(false);
      expect(fill.fillQty).toBe(0);
      expect(fill.fillPrice).toBeNull();
    }
  });

  it('REJECTED does not close a position', () => {
    const fill = recon.toFill(
      order(BrokerOrderStatus.REJECTED, { rejectReason: 'insufficient cash' }),
    );
    expect(fill.filled).toBe(false);
    expect(fill.rejectReason).toBe('insufficient cash');
  });

  it('PARTIALLY_FILLED is not treated as a full fill (paper does not emit this yet)', () => {
    const fill = recon.toFill(
      order(BrokerOrderStatus.PARTIALLY_FILLED, {
        fillQty: 4,
        fillPrice: '1870',
      }),
    );
    expect(fill.filled).toBe(false);
    expect(fill.fillQty).toBe(0);
  });

  it('FILLED is the only status that reports an executable fill', () => {
    const fill = recon.toFill(
      order(BrokerOrderStatus.FILLED, { fillQty: 10, fillPrice: '1870.0000' }),
    );
    expect(fill.filled).toBe(true);
    expect(fill.fillQty).toBe(10);
    expect(fill.fillPrice).toBe(1870);
  });
});
