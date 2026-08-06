export type SetupType =
  | 'PULLBACK_EMA20'
  | 'PULLBACK_PDH'
  | 'BREAKOUT_FRESH'
  | 'BREAKOUT_RETEST'
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
  validationStatus: ValidationStatus;
  rejectionCode: RejectionCode | null;
  rejectionDetail: RejectionDetail;
  /** Breakout reference level when applicable */
  breakLevel: number | null;
};

/** Legacy-compatible slice used by OMS / validator (VALID plans only). */
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
  validationStatus: 'VALID';
  rejectionCode: null;
  rejectionDetail: RejectionDetail;
};
