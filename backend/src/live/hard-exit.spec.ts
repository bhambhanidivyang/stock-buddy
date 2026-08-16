import { TradeExitReason } from '../database/enums';
import { hardExitReason } from './hard-exit';

describe('hardExitReason (OMS, independent of AI)', () => {
  const entry = 1819;
  const target = 1994;
  const stop = 1762;
  void entry;

  it('exits immediately at the hard stop without any AI action', () => {
    expect(hardExitReason(1762, target, stop)).toBe(TradeExitReason.STOP);
    expect(hardExitReason(1761.5, target, stop)).toBe(TradeExitReason.STOP);
  });

  it('exits immediately at the existing target without any AI action', () => {
    expect(hardExitReason(1994, target, stop)).toBe(TradeExitReason.TARGET);
    expect(hardExitReason(2000, target, stop)).toBe(TradeExitReason.TARGET);
  });

  it('does not wait for target/stop at an intermediate price (AI may EXIT_NOW here)', () => {
    expect(hardExitReason(1870, target, stop)).toBeNull();
  });

  it('never requires an AI decision object — pure price vs levels', () => {
    expect(hardExitReason(1870, 1994, 1762)).toBeNull();
  });
});
