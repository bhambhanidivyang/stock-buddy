import { isHeldQuoteTooOld } from './execution-quote-age';

describe('isHeldQuoteTooOld', () => {
  const maxAgeMs = 30_000;

  it('treats a cycle-start quote as stale after typical OpenAI latency', () => {
    const cycleStart = new Date('2026-08-14T04:00:00.000Z');
    const afterAi = new Date('2026-08-14T04:00:45.000Z');
    expect(
      isHeldQuoteTooOld(
        { receivedAt: cycleStart, fetchAgeMs: 50 },
        afterAi,
        maxAgeMs,
      ),
    ).toBe(true);
  });

  it('does not treat a just-received quote as stale', () => {
    const now = new Date('2026-08-14T04:00:05.000Z');
    expect(
      isHeldQuoteTooOld(
        { receivedAt: new Date('2026-08-14T04:00:00.000Z'), fetchAgeMs: 5_000 },
        now,
        maxAgeMs,
      ),
    ).toBe(false);
  });
});
