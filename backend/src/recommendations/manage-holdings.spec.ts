import { planStructureTrail, sessionsHeldIst } from './manage-holdings';

describe('planStructureTrail', () => {
  it('raises stop under newer swing low and never raises target', () => {
    const plan = planStructureTrail({
      currentStopLoss: 90,
      currentSellTarget: 120,
      buyPrice: 100,
      structureLow: 96,
      atr: 4,
      stopAtrBuffer: 0.35,
    });
    expect(plan).not.toBeNull();
    expect(plan!.changed).toBe(true);
    expect(plan!.stopLoss).toBeGreaterThan(90);
    expect(plan!.sellTarget).toBe(120);
  });

  it('does not widen stop', () => {
    const plan = planStructureTrail({
      currentStopLoss: 95,
      currentSellTarget: 120,
      buyPrice: 100,
      structureLow: 90,
      atr: 4,
      stopAtrBuffer: 0.35,
    });
    expect(plan).not.toBeNull();
    expect(plan!.stopLoss).toBe(95);
    expect(plan!.changed).toBe(false);
  });
});

describe('sessionsHeldIst', () => {
  it('counts weekdays between IST days', () => {
    // Mon 2026-08-03 → Thu 2026-08-06 = 3 sessions
    const buy = new Date('2026-08-03T04:00:00.000Z');
    const asOf = new Date('2026-08-06T04:00:00.000Z');
    expect(sessionsHeldIst(buy, asOf)).toBe(3);
  });
});
