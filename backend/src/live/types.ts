import { ManagementPhase } from '../database/enums';

export const AI_POSITION_PROMPT_VERSION = 'position-manager-v1';

export const AI_POSITION_ACTIONS = [
  'HOLD',
  'EXIT_NOW',
  'PROTECT_PROFIT',
  'MOVE_STOP',
  'TAKE_PARTIAL_PROFIT',
] as const;

export type AiPositionAction = (typeof AI_POSITION_ACTIONS)[number];

export const MARKET_EVENT_TYPES = [
  'PRICE_NEAR_STOP',
  'PRICE_NEAR_TARGET',
  'LARGE_PRICE_MOVE',
  'VOLUME_SPIKE',
  'VWAP_BREAK',
  'MOMENTUM_REVERSAL',
  'NEW_INTRADAY_HIGH',
  'NEW_INTRADAY_LOW',
  'MARKET_MOVE',
  'SECTOR_MOVE',
  'P_AND_L_THRESHOLD',
  'STALE_TRADE',
] as const;

export type MarketEventType = (typeof MARKET_EVENT_TYPES)[number];

export type MarketEvent = {
  type: MarketEventType;
  symbol: string;
  message: string;
  value: number | null;
  threshold: number | null;
};

export type IntradayBar = {
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** Execution-grade quote. Research PriceQuote may omit freshness fields. */
export type ExecutionQuote = {
  symbol: string;
  price: number;
  previousClose: number | null;
  changePercent: number | null;
  volume: number | null;
  open: number | null;
  gapPercent: number | null;
  bid: number | null;
  ask: number | null;
  /** Exchange/vendor timestamp when present. */
  quotedAt: Date | null;
  /** Local time the quote was received from the provider. */
  receivedAt: Date;
  /** now - receivedAt */
  fetchAgeMs: number;
  /** now - quotedAt, null if exchange time missing */
  exchangeDelayMs: number | null;
  source: string;
};

export type LiveConfig = {
  mgmtEnabled: boolean;
  aiIntervalMs: number;
  eventAiEnabled: boolean;
  /** Max age of our fetch (receivedAt). */
  quoteMaxAgeMs: number;
  /** Max age of vendor/exchange timestamp. Yahoo NSE is often delayed. */
  quoteMaxExchangeDelayMs: number;
  /** Fraction of (entry-stop) or (target-entry). Null = event disabled. */
  nearStopPct: number | null;
  nearTargetPct: number | null;
  largePriceMovePct: number | null;
  volumeSpikeMultiple: number | null;
  vwapBreakPct: number | null;
  pnlThresholdPct: number | null;
  staleTradeMs: number | null;
  marketMovePct: number | null;
  structureEventsEnabled: boolean;
  momentumEventsEnabled: boolean;
  /** Capability flag only — no default partial %. */
  partialProfitEnabled: boolean;
};

export type PositionSnapshot = {
  tradeId: string;
  symbol: string;
  qty: number;
  status: string;
  managementPhase: ManagementPhase | null;
  entryPrice: number;
  currentLtp: number;
  currentPnl: number;
  currentPnlPct: number;
  positionValue: number;
  timeSinceEntryMs: number;
  originalEntryLow: number;
  originalEntryHigh: number;
  originalStop: number;
  originalTarget: number;
  currentStop: number;
  currentTarget: number;
  highWaterMark: number | null;
  maxUnrealizedPct: number | null;
  mfePct: number | null;
  distanceToStopPct: number | null;
  distanceToTargetPct: number | null;
  distanceFromEntryPct: number | null;
  quote: {
    fetchAgeMs: number;
    exchangeDelayMs: number | null;
    volume: number | null;
    bid: number | null;
    ask: number | null;
    source: string;
    quotedAt: string | null;
  };
  technical: {
    vwap: number | null;
    rsi: number | null;
    ema20: number | null;
    rvol: number | null;
    intradayHigh: number | null;
    intradayLow: number | null;
    lastClose1m: number | null;
    bars1mCount: number;
    bars5mCount: number;
  };
  originalThesis: string;
  marketContext: {
    niftyPrice: number | null;
    niftyChangePct: number | null;
    bankNiftyChangePct: number | null;
    indiaVix: number | null;
  };
};

export type AiPositionDecision = {
  symbol: string;
  action: AiPositionAction;
  confidence: number;
  reason: string;
  suggestedStop: number | null;
  suggestedExitPrice: number | null;
};

export type AiPositionPortfolioResponse = {
  portfolioSummary: string;
  positions: AiPositionDecision[];
};

export type ValidationVerdict = {
  allow: boolean;
  reason: string;
  effectiveStop: number | null;
  /** EXIT_NOW may proceed to broker; MOVE_STOP updates stop only. */
  executeExit: boolean;
  applyStop: boolean;
};

export type SafetyCheck = {
  ok: boolean;
  reason: string;
  code: string;
};

export type BuySafetyInput = {
  symbol: string;
  qty: number;
  buyLow: number;
  buyHigh: number;
  quote: ExecutionQuote | null;
  availableCash: number;
  marketOpen: boolean;
  alreadyOpenQty: number;
};

export type SellSafetyInput = {
  symbol: string;
  requestedQty: number;
  heldQty: number;
  status: string;
  quote: ExecutionQuote | null;
  marketOpen: boolean;
};
