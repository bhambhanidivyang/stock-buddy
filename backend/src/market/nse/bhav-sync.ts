/** Max age (calendar days) for the newest bhav session to count as fresh. */
export const BHAV_MAX_AGE_DAYS = 3;

/**
 * Normalize pg/TypeORM `date` values to YYYY-MM-DD.
 * Drivers often return Date objects; using them as Map keys breaks lookups
 * (reference inequality) and breaks string matching against candidate days.
 */
export function toTradeDateKey(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    // NSE sessions are IST calendar days; en-CA → YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 10);
    }
    const parsed = new Date(trimmed);
    if (Number.isFinite(parsed.getTime())) {
      return toTradeDateKey(parsed);
    }
    return trimmed;
  }
  if (value == null) {
    return '';
  }
  return toTradeDateKey(String(value));
}

export function bhavAgeDays(
  tradeDate: string,
  nowMs: number = Date.now(),
): number {
  const key = toTradeDateKey(tradeDate);
  // Interpret as UTC noon to avoid DST edge flips when measuring age.
  const t = new Date(`${key}T12:00:00.000Z`).getTime();
  if (!Number.isFinite(t)) {
    return Number.POSITIVE_INFINITY;
  }
  return (nowMs - t) / (24 * 60 * 60 * 1000);
}

/** True when newest session is fresh and DB has enough distinct sessions. */
export function isBhavSyncSatisfied(input: {
  distinctSessions: number;
  latestTradeDate: string | null;
  minSessions: number;
  maxAgeDays?: number;
  nowMs?: number;
}): boolean {
  const minSessions = Math.max(1, Math.floor(input.minSessions));
  const maxAgeDays = input.maxAgeDays ?? BHAV_MAX_AGE_DAYS;
  if (input.distinctSessions < minSessions) {
    return false;
  }
  const latestKey = toTradeDateKey(input.latestTradeDate);
  if (!latestKey) {
    return false;
  }
  return bhavAgeDays(latestKey, input.nowMs) < maxAgeDays;
}

/**
 * Weekday-candidate window size. Larger than minSessions so holidays that 404
 * still leave enough downloadable sessions to reach depth.
 */
export function bhavCandidateCount(minSessions: number): number {
  const n = Math.max(1, Math.floor(minSessions));
  return Math.max(n * 2, n + 15);
}
