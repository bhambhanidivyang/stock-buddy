import {
  classifyCandidateStatus,
  mapRejectionToReasonCode,
} from './candidate-status';
import type { TradePlan } from './types';

function plan(partial: Partial<TradePlan>): TradePlan {
  return {
    setupType: 'NONE',
    entryReason: '',
    stopReason: '',
    targetReason: '',
    buyLow: 0,
    buyHigh: 0,
    stopLoss: 0,
    sellTarget: 0,
    risk: 0,
    reward: 0,
    riskReward: 0,
    atrUsed: 1,
    method: 'STRUCTURE_ATR_V1',
    planQuality: 'RED',
    validationStatus: 'REJECTED',
    rejectionCode: 'NO_SETUP',
    rejectionDetail: { setupType: 'NONE' },
    breakLevel: null,
    ...partial,
  };
}

describe('classifyCandidateStatus', () => {
  it('marks VALID green/amber plans BUYABLE', () => {
    const result = classifyCandidateStatus({
      missingCore: [],
      plan: plan({
        setupType: 'STRUCTURE',
        validationStatus: 'VALID',
        planQuality: 'AMBER',
        buyLow: 100,
        buyHigh: 102,
        stopLoss: 95,
        sellTarget: 110,
        riskReward: 1.3,
        rejectionCode: null,
        rejectionDetail: {
          setupType: 'STRUCTURE',
          planQuality: 'AMBER',
          amberReasons: ['soft RR'],
        },
      }),
    });
    expect(result.status).toBe('BUYABLE');
    expect(result.reasonCode).toBe('OK');
  });

  it('marks ENTRY_EXTENDED as WATCH', () => {
    const result = classifyCandidateStatus({
      missingCore: [],
      plan: plan({
        rejectionCode: 'ENTRY_EXTENDED',
        rejectionDetail: {
          setupType: 'STRUCTURE',
          message: 'LTP above buyHigh',
        },
      }),
    });
    expect(result.status).toBe('WATCH');
    expect(result.reasonCode).toBe('ENTRY_TOO_EXTENDED');
  });

  it('marks missing core as RED', () => {
    const result = classifyCandidateStatus({
      missingCore: ['atr14'],
      plan: null,
    });
    expect(result.status).toBe('RED');
    expect(result.reasonCode).toBe('INVALID_DATA');
  });
});

describe('mapRejectionToReasonCode', () => {
  it('maps target-too-close codes', () => {
    expect(mapRejectionToReasonCode('TARGET_TOO_CLOSE')).toBe(
      'TARGET_TOO_CLOSE',
    );
    expect(mapRejectionToReasonCode('RR_TOO_LOW')).toBe('TARGET_TOO_CLOSE');
    expect(mapRejectionToReasonCode('NO_TARGET_STRUCTURE')).toBe(
      'NO_STRUCTURAL_TARGET',
    );
    expect(mapRejectionToReasonCode('TARGET_TOO_FAR')).toBe('TARGET_TOO_FAR');
  });
});
