import type { TradePlan } from './types';

/** Portfolio eligibility after structural trade-plan calculation. */
export type CandidateTradeStatus = 'BUYABLE' | 'WATCH' | 'RED';

/**
 * Structured diagnostic codes for Top-40 → BUYABLE/WATCH/RED summaries.
 * Do not add new chart patterns until these histograms show setup-related
 * rejections dominate for 20–30 sessions.
 */
export type StatusReasonCode =
  | 'OK'
  | 'NO_VALID_ENTRY'
  | 'ENTRY_TOO_EXTENDED'
  | 'STOP_TOO_WIDE'
  | 'TARGET_TOO_CLOSE'
  | 'NO_STRUCTURAL_TARGET'
  | 'EXCESSIVE_RISK'
  | 'INVALID_DATA'
  | 'SPIKE_SUSPECT'
  | 'BROKEN_STRUCTURE'
  | 'HISTORY_TOO_SHORT'
  | 'NOT_EVALUATED';

export type ClassifiedCandidate = {
  status: CandidateTradeStatus;
  reasonCode: StatusReasonCode;
  reason: string | null;
};

/** Absolute floor: structural target exists but reward < 1R → not buyable now. */
export const MIN_BUYABLE_STRUCTURAL_RR = 1.0;

export function mapRejectionToReasonCode(
  rejectionCode: string | null | undefined,
  message?: string | null,
): StatusReasonCode {
  const code = (rejectionCode ?? '').toUpperCase();
  const msg = (message ?? '').toLowerCase();

  if (code === 'INSUFFICIENT_FEATURES') return 'INVALID_DATA';
  if (code === 'ENTRY_EXTENDED') return 'ENTRY_TOO_EXTENDED';
  if (code === 'ENTRY_MISSED' || code === 'NO_SETUP') return 'NO_VALID_ENTRY';
  if (code === 'STOP_TOO_WIDE_PCT' || code === 'STOP_TOO_WIDE_ATR') {
    return 'STOP_TOO_WIDE';
  }
  if (code === 'STOP_INSIDE_ENTRY') return 'BROKEN_STRUCTURE';
  if (code === 'NO_STOP_STRUCTURE') return 'NO_VALID_ENTRY';
  if (code === 'NO_TARGET_STRUCTURE') return 'NO_STRUCTURAL_TARGET';
  if (code === 'TARGET_TOO_CLOSE') return 'TARGET_TOO_CLOSE';
  if (code === 'TARGET_NOT_ABOVE_ENTRY' || code === 'TARGET_UNREALISTIC_HORIZON') {
    return 'NO_STRUCTURAL_TARGET';
  }
  if (code === 'RR_TOO_LOW') {
    return msg.includes('close') || msg.includes('< 1')
      ? 'TARGET_TOO_CLOSE'
      : 'TARGET_TOO_CLOSE';
  }
  if (code === 'RR_INVALID') return 'EXCESSIVE_RISK';
  if (msg.includes('spike')) return 'SPIKE_SUSPECT';
  return 'NO_VALID_ENTRY';
}

/**
 * Classify a deep-checked shortlist name after trade-plan calculation.
 * Named setups are optional descriptions — VALID structural plans are BUYABLE.
 */
export function classifyCandidateStatus(input: {
  missingCore: string[];
  plan: TradePlan | null;
  historyRejectReason?: string | null;
}): ClassifiedCandidate {
  if (input.historyRejectReason) {
    return {
      status: 'RED',
      reasonCode: 'HISTORY_TOO_SHORT',
      reason: input.historyRejectReason,
    };
  }

  if (input.missingCore.length > 0) {
    return {
      status: 'RED',
      reasonCode: 'INVALID_DATA',
      reason: `missing core technicals: ${input.missingCore.join(',')}`,
    };
  }

  const plan = input.plan;
  if (plan == null) {
    return {
      status: 'RED',
      reasonCode: 'INVALID_DATA',
      reason: 'missing trade plan',
    };
  }

  if (plan.validationStatus === 'VALID' && plan.planQuality !== 'RED') {
    const amberNote =
      plan.rejectionDetail?.amberReasons?.length
        ? plan.rejectionDetail.amberReasons.join('; ')
        : null;
    return {
      status: 'BUYABLE',
      reasonCode: 'OK',
      reason: amberNote,
    };
  }

  const reasonCode = mapRejectionToReasonCode(
    plan.rejectionCode,
    plan.rejectionDetail?.message,
  );
  const detail = plan.rejectionDetail?.message?.trim();
  const reason =
    plan.rejectionCode != null
      ? `${plan.rejectionCode}${detail ? `: ${detail}` : ''}`
      : detail || 'not buyable at current levels';

  // Hard data / impossible geometry → RED; otherwise WATCH (strong name, not now).
  const status: CandidateTradeStatus =
    reasonCode === 'INVALID_DATA' || reasonCode === 'SPIKE_SUSPECT'
      ? 'RED'
      : 'WATCH';

  return { status, reasonCode, reason };
}
