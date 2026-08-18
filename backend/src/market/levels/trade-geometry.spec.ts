import { loadLevelsConfig } from './levels.config';
import { buildTarget } from './target.engine';
import {
  assertStrategyGeometry,
  isHorizonSizedMove,
} from './trade-geometry';

describe('assertStrategyGeometry', () => {
  const config = loadLevelsConfig();

  it('accepts a typical 1–5 day book (≈2% risk, ≈3.6% target, RR≥2)', () => {
    const result = assertStrategyGeometry({
      buyHigh: 100,
      stopLoss: 98.2,
      sellTarget: 103.6,
      atr: 3,
      config,
    });
    expect(result.ok).toBe(true);
    expect(config.maxRiskPct).toBe(0.04);
    expect(config.maxTargetPct).toBe(0.08);
    expect(config.maxTargetAtr).toBe(1.5);
  });

  it('rejects COMSYN-class geometry without moving stop or clamping target', () => {
    const result = assertStrategyGeometry({
      buyHigh: 294.11,
      stopLoss: 261.42,
      sellTarget: 375.51,
      atr: 20.55,
      config,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('STOP_TOO_WIDE_PCT');
      expect(result.message).toMatch(/TARGET_TOO_FAR/);
      expect(result.riskPct).toBeCloseTo(0.111, 2);
      expect(result.rewardPct).toBeCloseTo(0.277, 2);
    }
  });

  it('rejects good RR when absolute risk is too large (stop not tightened)', () => {
    const result = assertStrategyGeometry({
      buyHigh: 294.11,
      stopLoss: 261.42,
      sellTarget: 358,
      atr: 20.55,
      config,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('STOP_TOO_WIDE_PCT');
    }
  });

  it('rejects reasonable risk when the only target is too far (target not clamped)', () => {
    const result = assertStrategyGeometry({
      buyHigh: 100,
      stopLoss: 98,
      sellTarget: 128,
      atr: 2,
      config,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TARGET_TOO_FAR');
    }
  });

  it('does not treat a distant impulse height as a horizon-sized measured move', () => {
    expect(isHorizonSizedMove(85.51, 294.11, 20.55, config)).toBe(false);
    expect(isHorizonSizedMove(3.6, 100, 3, config)).toBe(true);
  });
});

describe('buildTarget horizon skips', () => {
  const config = loadLevelsConfig();

  it('skips a 27% measured move as TARGET_TOO_FAR instead of accepting RR≥2', () => {
    const result = buildTarget({
      setupType: 'PULLBACK_PDH',
      buyHigh: 294.11,
      stopLoss: 261.42,
      atr: 20.55,
      resistances: [],
      breakLevel: 290,
      rangeHeight: 85.51,
      config,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TARGET_TOO_FAR');
      expect(result.targetsEvaluated.some((e) => e.price === 375.51)).toBe(
        true,
      );
    }
  });
});
