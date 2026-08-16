import { TradeExitReason } from '../database/enums';

/**
 * Deterministic OMS exits. Evaluated on every poll, never by the AI cycle.
 * AI is not consulted and cannot veto these.
 */
export function hardExitReason(
  price: number,
  target: number,
  stop: number,
): TradeExitReason.TARGET | TradeExitReason.STOP | null {
  if (price >= target) {
    return TradeExitReason.TARGET;
  }
  if (price <= stop) {
    return TradeExitReason.STOP;
  }
  return null;
}
