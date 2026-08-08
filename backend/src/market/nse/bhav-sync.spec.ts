import {
  BHAV_MAX_AGE_DAYS,
  bhavAgeDays,
  bhavCandidateCount,
  isBhavSyncSatisfied,
  toTradeDateKey,
} from './bhav-sync';

describe('bhav-sync helpers', () => {
  const now = Date.parse('2026-08-07T12:00:00.000Z');

  it('toTradeDateKey normalizes Date and string forms to YYYY-MM-DD', () => {
    // IST midnight Aug 7 → underlying UTC Aug 6 18:30
    const istMidnight = new Date('2026-08-06T18:30:00.000Z');
    expect(toTradeDateKey(istMidnight)).toBe('2026-08-07');
    expect(toTradeDateKey('2026-08-07')).toBe('2026-08-07');
    expect(toTradeDateKey('2026-08-07T00:00:00.000Z')).toBe('2026-08-07');
  });

  it('isBhavSyncSatisfied requires both depth and freshness', () => {
    expect(
      isBhavSyncSatisfied({
        distinctSessions: 1,
        latestTradeDate: '2026-08-05',
        minSessions: 30,
        nowMs: now,
      }),
    ).toBe(false);

    expect(
      isBhavSyncSatisfied({
        distinctSessions: 30,
        latestTradeDate: '2026-07-01',
        minSessions: 30,
        nowMs: now,
      }),
    ).toBe(false);

    expect(
      isBhavSyncSatisfied({
        distinctSessions: 30,
        latestTradeDate: '2026-08-05',
        minSessions: 30,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it('bhavAgeDays measures calendar age of latest session', () => {
    expect(bhavAgeDays('2026-08-05', now)).toBeGreaterThan(1);
    expect(bhavAgeDays('2026-08-05', now)).toBeLessThan(BHAV_MAX_AGE_DAYS);
  });

  it('bhavCandidateCount buffers holidays beyond minSessions', () => {
    expect(bhavCandidateCount(30)).toBeGreaterThanOrEqual(60);
    expect(bhavCandidateCount(1)).toBeGreaterThanOrEqual(16);
  });
});
