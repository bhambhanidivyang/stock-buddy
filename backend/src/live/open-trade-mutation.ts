import { Repository } from 'typeorm';
import { Trade } from '../database/entities';
import { ManagementPhase, TradeStatus } from '../database/enums';

/** Scalar columns the live manager may patch on an OPEN trade. */
export type OpenTradePatch = {
  stopLoss?: string;
  highWaterMark?: string | null;
  maxUnrealizedPct?: string | null;
  managementPhase?: ManagementPhase | null;
  lastAiReviewAt?: Date | null;
  lastAiAction?: string | null;
};

/**
 * Patch an OPEN trade only.
 *
 * Never `save()` a Trade entity that was loaded before an await: the OMS loop
 * may have closed it, and a full-entity save would resurrect status=OPEN.
 */
export async function updateIfStillOpen(
  trades: Repository<Trade>,
  tradeId: string,
  patch: OpenTradePatch,
): Promise<boolean> {
  const result = await trades.update(
    { id: tradeId, status: TradeStatus.OPEN },
    patch,
  );
  return (result.affected ?? 0) > 0;
}
