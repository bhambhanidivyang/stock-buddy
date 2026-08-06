export type AuthUser = {
  email: string;
  firstName: string;
  lastName: string;
};

export type AuthResponse = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
};

export type StatementRow = {
  date: string;
  buyAmount: number;
  sellAmount: number;
  profitLoss: number;
  cash: number;
  holdingsValue: number;
  stocksBought: string;
  stocksSold: string;
  holdings: string;
};

export type RecommendationItem = {
  id: string;
  symbol: string;
  qty: number;
  allocationInr: number;
  buyLow: number;
  buyHigh: number;
  sellTarget: number;
  stopLoss: number;
  role: "PRIMARY" | "HEDGE";
  summary: string;
  convictionRank: number;
};

export type RejectedCandidate = {
  symbol: string;
  reason: string;
};

export type PortfolioStrategy = {
  style: "AGGRESSIVE" | "BALANCED" | "DEFENSIVE";
  targetPositions: number;
  cashReservePercent: number;
  hedge: boolean;
  reason: string;
};

export type PipelineFunnel = {
  universe: number;
  universeProvider?: string;
  liquidEligible?: number;
  liquidRejected?: number;
  quotesOk: number;
  quotesFailed: number;
  prioritized?: number;
  eligibilityPassed: number;
  eligibilityRejected: number;
  featureReady: number;
  featureRejected: number;
  sentToAi: number;
  freshness?: string;
  bhavAsOf?: string | null;
  quotesAsOf?: string;
  aiPicksProposed?: number;
  validatorAccepted?: number;
  validatorRejected?: number;
  summary: string;
};

export type SetupRejectReason = {
  reason: string;
  count: number;
};

export type SetupRejectRow = {
  symbol: string;
  reason: string;
};

export type BuyableShortlistRow = {
  symbol: string;
  buyLow: number | null;
  buyHigh: number | null;
  sellTarget: number | null;
  stopLoss: number | null;
};

export type RecommendationRun = {
  id: string;
  status: string;
  marketTs: string;
  marketSession: string;
  availableCash: number;
  totalAllocatedInr: number;
  cashReservedInr: number;
  portfolioSummary: string;
  marketRegime: string | null;
  confidence: string | null;
  portfolioStrategy: PortfolioStrategy | null;
  model: string;
  pipelineFunnel?: PipelineFunnel;
  rejectedCandidates: RejectedCandidate[];
  /** Minimum free cash required before AI suggests new buys. */
  minDeployCashInr?: number;
  skipNewBuysReason?: "LOW_CASH" | null;
  /** Size of priority shortlist sent to deep setup checks. */
  shortlistedCount?: number;
  buyableCount?: number;
  setupRejectCount?: number;
  buyableBlockedReason?: "LOW_CASH" | "NO_BUYABLE_SETUPS" | null;
  /** Shortlist names that already have entry/stop/target (pre-AI). */
  buyableShortlist?: BuyableShortlistRow[];
  /** Why shortlisted names failed setup rules (independent of account cash). */
  setupRejectReasons?: SetupRejectReason[];
  /** Full shortlist rejects: symbol + reason. */
  setupRejects?: SetupRejectRow[];
  items: RecommendationItem[];
  /** Present on history list/get responses. */
  createdAt?: string;
  bought?: boolean;
  boughtLabel?: "yes" | "no" | string;
  executionSessionCount?: number;
};

/** History row from GET /recommendations (may omit funnel/rejects). */
export type RecommendationHistoryRun = {
  id: string;
  status: string;
  createdAt: string;
  marketTs: string;
  marketSession: string;
  availableCash: number;
  totalAllocatedInr: number;
  cashReservedInr: number;
  portfolioSummary: string | null;
  marketRegime: string | null;
  confidence: string | null;
  portfolioStrategy: PortfolioStrategy | null;
  model: string;
  bought: boolean;
  boughtLabel: string;
  executionSessionCount: number;
  items: RecommendationItem[];
};

export type ExecuteResult = {
  sessionId: string;
  recommendationId: string;
  status: string;
  startedAt: string;
  waitingBuyCount: number;
  addOnSymbols: string[];
};

export type BalanceSnapshot = {
  accountId: string;
  initialFund: number;
  cash: number;
  holdingsValue: number;
  invested: number;
  equity: number;
  unrealizedPnl: number;
  realizedPnl: number;
  openPositions: number;
  needsReviewPositions: number;
  asOf: string;
  cashDisplay?: string;
  equityDisplay?: string;
};

export type HoldingRow = {
  tradeId: string;
  symbol: string;
  qty: number;
  role: "PRIMARY" | "HEDGE" | string;
  buyPrice: number;
  buyAt: string | null;
  invested: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  buyLow: number;
  buyHigh: number;
  sellTarget: number;
  stopLoss: number;
  summary: string;
  recommendationItemId: string;
  executionSessionId: string;
  status: "OPEN" | "NEEDS_REVIEW" | string;
  needsHumanReview: boolean;
};

export type PortfolioTotals = {
  invested: number;
  marketValue: number;
  unrealizedPnl: number;
};

export type PortfolioSnapshot = {
  accountId: string;
  asOf: string;
  holdings: HoldingRow[];
  needsReview: HoldingRow[];
  totals: PortfolioTotals;
  openTotals: PortfolioTotals;
  needsReviewTotals: PortfolioTotals;
};

export type ExecuteLastSession = {
  sessionId: string;
  status: string;
  stopReason: string | null;
  startedAt: string;
  stoppedAt: string | null;
};

export type ExecutionLegState =
  | "WAITING_BUY"
  | "OPEN"
  | "NEEDS_REVIEW"
  | "SOLD";

export type ExecutionLeg = {
  tradeId: string;
  symbol: string;
  qty: number;
  role: string;
  state: ExecutionLegState;
  statusLabel: string;
  detail: string;
  buyLow: number;
  buyHigh: number;
  buyPrice: number | null;
  sellTarget: number;
  stopLoss: number;
  mark: number | null;
  sellPrice: number | null;
  exitReason: string | null;
  realizedPnl: number | null;
  buyAt: string | null;
  sellAt: string | null;
};

export type ExecuteStatus = {
  status: "IDLE" | "RUNNING";
  phase: "BUYING" | "MANAGING" | "NEEDS_REVIEW" | "IDLE";
  active: boolean;
  headline: string;
  sessionId: string | null;
  recommendationId: string | null;
  startedAt: string | null;
  waitingBuy: number;
  openPositions: number;
  needsReviewPositions: number;
  soldPositions: number;
  managingExits: boolean;
  lastSession: ExecuteLastSession | null;
  legs: ExecutionLeg[];
  asOf: string;
  day: string;
};

export type ExecuteStopResult =
  | { status: "IDLE" }
  | { status: "STOPPED"; sessionId: string; stopReason?: string };

export type ReviewTradeAction = "SELL" | "RESUME";

export type ReviewTradeResult = {
  tradeId: string;
  symbol: string;
  action: ReviewTradeAction;
  status: string;
  sellTarget?: number;
  stopLoss?: number;
  sellPrice?: number;
  proceeds?: number;
  realizedPnl?: number;
  cash?: number;
};
