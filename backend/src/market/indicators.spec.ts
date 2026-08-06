import {
  atr,
  bollinger,
  ema,
  macd,
  relativeStrength,
  roc,
  rsi,
  volumeMultiple,
} from './indicators';

describe('indicators', () => {
  it('computes RSI in range', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 0.5);
    const value = rsi(closes, 14);
    expect(value).not.toBeNull();
    expect(value!).toBeGreaterThan(50);
    expect(value!).toBeLessThanOrEqual(100);
  });

  it('computes EMA', () => {
    const values = Array.from({ length: 40 }, (_, i) => 100 + i);
    expect(ema(values, 20)).not.toBeNull();
  });

  it('computes volume multiple', () => {
    const volumes = [...Array.from({ length: 20 }, () => 1000), 2500];
    expect(volumeMultiple(volumes, 20)).toBe(2.5);
  });

  it('computes relative strength', () => {
    const stock = Array.from({ length: 25 }, (_, i) => 100 + i);
    const bench = Array.from({ length: 25 }, () => 100);
    expect(relativeStrength(stock, bench, 20)).not.toBeNull();
  });

  it('computes ATR / MACD / Bollinger / ROC', () => {
    const bars = Array.from({ length: 80 }, (_, i) => ({
      high: 105 + i * 0.2,
      low: 95 + i * 0.2,
      close: 100 + i * 0.2,
      volume: 1_000_000,
    }));
    const closes = bars.map((b) => b.close);
    expect(atr(bars, 14)).not.toBeNull();
    expect(macd(closes)).not.toBeNull();
    expect(bollinger(closes, 20)).not.toBeNull();
    expect(roc(closes, 20)).not.toBeNull();
  });
});
