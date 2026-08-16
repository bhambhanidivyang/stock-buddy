/**
 * Cycle-start quotes are for AI reasoning.
 * Order fills must not use a quote whose wall-clock age exceeds the freshness window,
 * even if fetchAgeMs was frozen at 0 when the AI cycle began.
 */
export function isHeldQuoteTooOld(
  quote: { receivedAt: Date; fetchAgeMs: number },
  now: Date,
  maxAgeMs: number,
): boolean {
  const wallAgeMs = now.getTime() - quote.receivedAt.getTime();
  return quote.fetchAgeMs > maxAgeMs || wallAgeMs > maxAgeMs;
}
