import type { SectorMomentum, TrendLabel } from '../indicators';
import type {
  CandidateTradeStatus,
  StatusReasonCode,
} from '../levels/candidate-status';
import type { SuggestedLevels, TradePlan } from '../levels/types';

export type { SuggestedLevels, TradePlan };
export type { CandidateTradeStatus, StatusReasonCode };

export type CandidateQuoteBlock = {
  price: number;
  previousClose: number | null;
  changePercent: number | null;
  volume: number | null;
  gapPercent: number | null;
};

export type CandidateTechnical = {
  rsi14: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  emaAligned: boolean | null;
  priceAboveEma20: boolean | null;
  priceAboveEma50: boolean | null;
  priceAboveEma200: boolean | null;
  goldenCross: boolean | null;
  deathCross: boolean | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  adx14: number | null;
  plusDi: number | null;
  minusDi: number | null;
  atr14: number | null;
  atrPercent: number | null;
  rvol20: number | null;
  relativeStrength20: number | null;
  trend: TrendLabel;
  sectorMomentum: SectorMomentum;
};

export type CandidateTechnicalExtended = {
  bollingerPercentB: number | null;
  bollingerWidth: number | null;
  roc20: number | null;
};

export type CandidateStructure = {
  prevDayHigh: number | null;
  prevDayLow: number | null;
  distToPdhPct: number | null;
  distToPdlPct: number | null;
  return5d: number | null;
  return20d: number | null;
  dist52wHighPct: number | null;
  dist52wLowPct: number | null;
};

export type CandidateFundamentals = {
  marketCap: number | null;
  pe: number | null;
  pb: number | null;
  dividendYield: number | null;
  debtToEquity: number | null;
};

export type Candidate = {
  symbol: string;
  companyName: string;
  sector: string;
  quote: CandidateQuoteBlock;
  technical: CandidateTechnical;
  structure: CandidateStructure;
  fundamentals: CandidateFundamentals;
  /** BUYABLE / WATCH / RED after structural trade-plan classification. */
  candidateStatus: CandidateTradeStatus;
  statusReasonCode: StatusReasonCode;
  statusReason: string | null;
  /** GREEN/AMBER structure plan levels; null unless BUYABLE. */
  suggestedLevels: SuggestedLevels | null;
  /** Full plan including WATCH/RED diagnostics for research funnel. */
  tradePlan: TradePlan | null;
  technicalExtended: CandidateTechnicalExtended;
  metadata: {
    schemaVersion: number;
    featureVersion: number;
    configVersion: number;
    barCount: number;
    missingFields: string[];
    dataFreshness: string;
  };
};

/** Compact plan for AI payload (omit bulky rejectionDetail / breakLevel). */
export type AiFacingTradePlan = Pick<
  TradePlan,
  | 'setupType'
  | 'entryReason'
  | 'stopReason'
  | 'targetReason'
  | 'buyLow'
  | 'buyHigh'
  | 'stopLoss'
  | 'sellTarget'
  | 'risk'
  | 'reward'
  | 'riskReward'
  | 'planQuality'
  | 'validationStatus'
  | 'rejectionCode'
  | 'atrUsed'
  | 'method'
> & {
  riskPercent?: number | null;
  riskATR?: number | null;
  extension?: number | null;
};

export type AiFacingCandidate = Omit<
  Candidate,
  'technicalExtended' | 'tradePlan'
> & {
  tradePlan: AiFacingTradePlan | TradePlan | null;
  researchRank?: number;
  riskPercent?: number | null;
  riskATR?: number | null;
  extension?: number | null;
  technicalExtended?: CandidateTechnicalExtended;
  research?: {
    researchScore: number;
    rank?: number;
    reasons: string[];
    relativeStrengthScore?: number;
    trendScore?: number;
    nearHighScore?: number;
    persistenceScore?: number;
    sectorScore?: number;
    volumeScore?: number;
    isWildcard?: boolean;
  };
};

export type EligibilityRejection = {
  symbol: string;
  reason: string;
};

export type RankingPoolDiagnostics = {
  liquidCount: number;
  return20Count: number;
  return20Coverage: number;
  minReturn20Coverage: number;
  bhavSessionsNeeded: number;
  eligibleSectors: string[];
  inSectorCount: number;
  outsideCount: number;
  deepPoolSize: number;
  deepPoolFirst: string | null;
  deepPoolLast: string | null;
  fallbackUsed: false;
  failed: boolean;
  failReason: string | null;
};

export type ResearchScoredRow = {
  rank: number;
  symbol: string;
  sector: string;
  overallScore: number;
  relativeStrengthScore?: number | null;
  trendScore?: number | null;
  nearHighScore?: number | null;
  persistenceScore?: number | null;
  sectorScore?: number | null;
  volumeScore?: number | null;
  isWildcard?: boolean;
  reasons: string[];
};

export type MarketContext = {
  indices: Record<string, unknown>;
  niftyTrend: TrendLabel | null;
  bankNiftyTrend: TrendLabel | null;
  indiaVix: { price: number; changePercent: number | null } | null;
  /** Deterministic research-ranking regime (when shortlistMode=ranking). */
  researchRegime?: {
    label: string;
    score: number;
    reasons: string[];
  };
  /** Top sectors by relative strength (ranking mode). */
  sectorRanks?: Array<{
    sector: string;
    score: number;
    rank: number;
    sectorRs20: number;
  }>;
  breadth: {
    up: number;
    down: number;
    sideways: number;
    total: number;
  };
  /** Liquid-universe advance/decline when ranking (else BUYABLE trend counts). */
  liquidBreadth?: {
    advance1d: number;
    advance5d: number;
    total: number;
  };
  /** Ranking Stage-2 pool diagnostics (coverage, fail-closed reason, deep pool). */
  rankingDiagnostics?: RankingPoolDiagnostics;
  sectorMomentum: Record<string, SectorMomentum>;
  technicalCoverage: {
    total: number;
    withCoreTechnicals: number;
    withLevels: number;
    mostlyNull: boolean;
    note: string;
  };
  screens: {
    highestVolumeToday: string[];
    gapUp: string[];
    gapDown: string[];
  };
};

/** Counts at each stage of the recommendation data pipeline. */
export type PipelineFunnel = {
  universe: number;
  universeProvider: string;
  liquidEligible: number;
  liquidRejected: number;
  quotesOk: number;
  quotesFailed: number;
  prioritized: number;
  /** Passed deep history / core technical gates */
  eligibilityPassed: number;
  eligibilityRejected: number;
  /** Had core technicals + suggestedLevels */
  featureReady: number;
  featureRejected: number;
  /** Candidates included in the AI request payload */
  sentToAi: number;
  freshness: 'INTRADAY_LIVE' | 'EOD_BHAV';
  bhavAsOf: string | null;
  quotesAsOf: string;
  shortlistMode?: string;
  researchPool?: number;
  eligibleSectors?: string[];
  rankingFailed?: boolean;
  rankingFailReason?: string | null;
  return20Coverage?: number;
  /** Set after AI + validator in RecommendationsService */
  aiPicksProposed?: number;
  validatorAccepted?: number;
  validatorRejected?: number;
  /** Short human-readable summary for logs/UI */
  summary: string;
};

export type PriorityReasonRow = {
  symbol: string;
  score: number;
  reasons: string[];
  research?: {
    relativeStrengthScore?: number;
    trendScore?: number;
    nearHighScore?: number;
    persistenceScore?: number;
    sectorScore?: number;
    volumeScore?: number;
    isWildcard?: boolean;
  };
};

/** Per-symbol outcome for the deep-checked shortlist (not the full liquid universe). */
export type ShortlistOutcome = {
  symbol: string;
  status: CandidateTradeStatus;
  reasonCode: StatusReasonCode;
  reason: string | null;
  buyLow?: number;
  buyHigh?: number;
  sellTarget?: number;
  stopLoss?: number;
  riskReward?: number;
  setupType?: string;
  planQuality?: string;
};

export type CandidateBoard = {
  versions: {
    schemaVersion: number;
    featureVersion: number;
    configVersion: number;
  };
  config: Record<string, unknown>;
  strategyProfile: string;
  marketContext: MarketContext;
  candidates: Candidate[];
  eligibilityRejected: EligibilityRejection[];
  pipelineFunnel: PipelineFunnel;
  priorityShortlist: PriorityReasonRow[];
  shortlistOutcomes: ShortlistOutcome[];
  /** Top scored names from ranking (up to 100) for audit — not only Top K shortlist. */
  researchScoredTop?: ResearchScoredRow[];
  rankingDiagnostics?: RankingPoolDiagnostics;
};
