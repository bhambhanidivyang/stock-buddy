import { isBuyablePlanQuality, worsePlanQuality } from './plan-quality';

describe('plan-quality', () => {
  it('worsePlanQuality picks the stricter tier', () => {
    expect(worsePlanQuality('GREEN', 'AMBER')).toBe('AMBER');
    expect(worsePlanQuality('AMBER', 'RED')).toBe('RED');
    expect(worsePlanQuality('GREEN', 'GREEN')).toBe('GREEN');
  });

  it('isBuyablePlanQuality allows GREEN and AMBER only', () => {
    expect(isBuyablePlanQuality('GREEN')).toBe(true);
    expect(isBuyablePlanQuality('AMBER')).toBe(true);
    expect(isBuyablePlanQuality('RED')).toBe(false);
  });
});
