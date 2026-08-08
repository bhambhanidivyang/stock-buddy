import type { PlanQuality } from './plan-quality';

export type { PlanQuality } from './plan-quality';

export type SetupType =
  | 'PULLBACK_EMA20'
  | 'PULLBACK_PDH'
  | 'BREAKOUT_FRESH'
  | 'BREAKOUT_RETEST'
  /** Objective structure anchor when no named textbook setup fires. */
  | 'STRUCTURE'
  | 'NONE';

export type ValidationStatus = 'VALID' | 'REJECTED';

export type RejectionCode =
  | 'INSUFFICIENT_FEATURES'
  | 'NO_SETUP'
  | 'ENTRY_EXTENDED'
  | 'ENTRY_MISSED'
  | 'NO_STOP_STRUCTURE'
  | 'STOP_INSIDE_ENTRY'
  | 'STOP_TOO_WIDE_PCT'
  | 'STOP_TOO_WIDE_ATR'
  | 'NO_TARGET_STRUCTURE'
  | 'TARGET_NOT_ABOVE_ENTRY'
  | 'TARGET_UNREALISTIC_HORIZON'
  | 'TARGET_TOO_CLOSE'
  | 'RR_TOO_LOW'
  | 'RR_INVALID';

export type PivotKind = 'HIGH' | 'LOW';

export type RawPivot = {
  price: number;
  barIndex: number;
  kind: PivotKind;
};

export type StructureLevel = {
  levelPrice: number;
  touches: number;
  lastBarIndex: number;
  kind: PivotKind;
  valid: boolean;
};

export type TargetCandidateEval = {
  price: number;
  reason: string;
  rr: number | null;
  accepted: boolean;
  skipReason?: string;
};

export type RejectionDetail = {
  setupType: SetupType;
  rr?: number;
  requiredRr?: number;
  risk?: number;
  reward?: number;
  buyHigh?: number;
  stopLoss?: number;
  sellTargetTried?: number;
  targetsEvaluated?: TargetCandidateEval[];
  stopStructurePrice?: number;
  atrUsed?: number;
  message?: string;
  /** Entry overshoot in ATR units (positive = above buyHigh). */
  entryOvershootAtr?: number;
  /** Stop risk as fraction of buyHigh. */
  riskPct?: number;
  /** Stop risk in ATR units. */
  riskAtr?: number;
  planQuality?: PlanQuality;
  amberReasons?: string[];
};

export type TradePlan = {
  setupType: SetupType;
  entryReason: string;
  stopReason: string;
  targetReason: string;
  buyLow: number;
  buyHigh: number;
  stopLoss: number;
  sellTarget: number;
  risk: number;
  reward: number;
  riskReward: number;
  atrUsed: number;
  method: 'STRUCTURE_ATR_V1';
  /**
   * GREEN/AMBER → VALID (levels usable).
   * RED → REJECTED (hard reject, no levels to AI).
   */
  planQuality: PlanQuality;
  validationStatus: ValidationStatus;
  rejectionCode: RejectionCode | null;
  rejectionDetail: RejectionDetail;
  /** Breakout reference level when applicable */
  breakLevel: number | null;
};

/** Levels passed to AI / OMS. VALID includes GREEN and AMBER plans. */
export type SuggestedLevels = {
  buyLow: number;
  buyHigh: number;
  stopLoss: number;
  sellTarget: number;
  riskReward: number;
  method: 'STRUCTURE_ATR_V1';
  atrUsed: number;
  setupType: SetupType;
  entryReason: string;
  stopReason: string;
  targetReason: string;
  risk: number;
  reward: number;
  planQuality: 'GREEN' | 'AMBER';
  validationStatus: 'VALID';
  rejectionCode: null;
  rejectionDetail: RejectionDetail;
};
