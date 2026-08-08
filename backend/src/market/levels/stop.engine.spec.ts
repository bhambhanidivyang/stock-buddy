import { loadLevelsConfig } from './levels.config';
import { buildStop, selectStopStructure, stopPctCaps } from './stop.engine';
import type { StructureLevel } from './types';

describe('buildStop adaptive tiers', () => {
  const config = loadLevelsConfig();

  const support = (
    price: number,
    lastBarIndex = 10,
  ): StructureLevel => ({
    levelPrice: price,
    touches: 2,
    lastBarIndex,
    kind: 'LOW',
    valid: true,
  });

  it('prefers nearer support over a more recent but distant swing', () => {
    // buyHigh 100 → hard 15% → prefer structure ~92 over distant 70
    const buyHigh = 100;
    const buyLow = 98;
    const atr = 4;
    const selected = selectStopStructure({
      buyLow,
      buyHigh,
      atr,
      prevDayLow: null,
      supports: [
        support(92, 20), // nearer, older
        support(70, 50), // distant, more recent — old bug preferred this
      ],
      config,
    });
    expect(selected).not.toBeNull();
    expect(selected!.structurePrice).toBe(92);
    expect(selected!.riskPct).toBeLessThanOrEqual(config.maxStopPctHard + 0.01);

    const result = buildStop({
      buyLow,
      buyHigh,
      atr,
      prevDayLow: null,
      supports: [support(92, 20), support(70, 50)],
      config,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.structurePrice).toBe(92);
    }
  });

  it('expands green cap for high ATR% names via adaptive mult', () => {
    // buyHigh 100, atr 5 → atrPct 5%; adaptive 2.5*5%=12.5%
    const caps = stopPctCaps(100, 5, config);
    expect(caps.greenPctCap).toBeCloseTo(0.125, 3);
    expect(caps.amberPctCap).toBeGreaterThanOrEqual(caps.greenPctCap);
    expect(caps.amberPctCap).toBeLessThanOrEqual(config.maxStopPctHard);
  });

  it('marks AMBER when riskAtr is between green and amber ATR caps', () => {
    // atrPct high enough that % is green, but riskAtr slightly above 2.5
    // buyHigh=100, atr=4 → atrPct=4%, greenPct=max(0.08,0.10)=0.10
    // riskPct=0.10 → risk=10, riskAtr=10/4=2.5 exactly green boundary
    // use risk slightly above: riskAtr=2.8 → risk=11.2, riskPct=0.112
    // greenPct=0.10 so pct also amber; amberPct=0.12; amberAtr=3.5
    const buyHigh = 100;
    const buyLow = 99;
    const atr = 4;
    const risk = 11.2;
    const stopLoss = buyHigh - risk;
    const structurePrice = stopLoss + config.stopAtrBuffer * atr;
    const result = buildStop({
      buyLow,
      buyHigh,
      atr,
      prevDayLow: null,
      supports: [support(structurePrice)],
      config,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quality).toBe('AMBER');
      expect(result.riskAtr).toBeGreaterThan(config.maxStopAtrReject);
      expect(result.riskAtr).toBeLessThanOrEqual(config.maxStopAtrAmber);
    }
  });

  it('rejects when riskPct exceeds hard/amber cap', () => {
    const buyHigh = 100;
    const buyLow = 99;
    const atr = 8; // keep riskAtr from dominating
    // ~20% risk → stop ~80, riskAtr = 20/8 = 2.5
    const structurePrice = 80 + config.stopAtrBuffer * atr;
    const result = buildStop({
      buyLow,
      buyHigh,
      atr,
      prevDayLow: null,
      supports: [support(structurePrice)],
      config,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('STOP_TOO_WIDE_PCT');
    }
  });
});
