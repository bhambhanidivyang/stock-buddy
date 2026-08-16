import { TradeStatus } from '../database/enums';
import { updateIfStillOpen } from './open-trade-mutation';
import type { Trade } from '../database/entities';
import type { Repository, UpdateResult } from 'typeorm';

describe('updateIfStillOpen', () => {
  it('updates only when id matches and status is still OPEN', async () => {
    const calls: unknown[] = [];
    const trades = {
      update: async (criteria: unknown, patch: unknown): Promise<UpdateResult> => {
        calls.push({ criteria, patch });
        return { affected: 1, raw: [], generatedMaps: [] };
      },
    } as unknown as Repository<Trade>;

    const ok = await updateIfStillOpen(trades, 'trade-1', {
      stopLoss: '1800.0000',
    });

    expect(ok).toBe(true);
    expect(calls).toEqual([
      {
        criteria: { id: 'trade-1', status: TradeStatus.OPEN },
        patch: { stopLoss: '1800.0000' },
      },
    ]);
  });

  it('returns false when the row is no longer OPEN (does not resurrect)', async () => {
    const trades = {
      update: async (): Promise<UpdateResult> => ({
        affected: 0,
        raw: [],
        generatedMaps: [],
      }),
    } as unknown as Repository<Trade>;

    await expect(
      updateIfStillOpen(trades, 'closed-trade', { stopLoss: '1' }),
    ).resolves.toBe(false);
  });
});
