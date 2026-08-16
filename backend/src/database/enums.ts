export enum RecommendationRunStatus {
  PENDING = 'PENDING',
  /** Sole customizable / executable plan for today (at most one per account). */
  EXECUTABLE = 'EXECUTABLE',
  EXECUTING = 'EXECUTING',
  SUPERSEDED = 'SUPERSEDED',
  COMPLETED = 'COMPLETED',
}

export enum MarketSession {
  PRE_OPEN = 'PRE_OPEN',
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export enum RecommendationItemRole {
  PRIMARY = 'PRIMARY',
  HEDGE = 'HEDGE',
}

export enum ExecutionSessionStatus {
  RUNNING = 'RUNNING',
  STOPPED = 'STOPPED',
  COMPLETED = 'COMPLETED',
}

export enum ExecutionStopReason {
  REPLACED = 'REPLACED',
  MANUAL = 'MANUAL',
  ALL_CLOSED = 'ALL_CLOSED',
  END_OF_DAY = 'END_OF_DAY',
  ERROR = 'ERROR',
}

export enum TradeStatus {
  WAITING_BUY = 'WAITING_BUY',
  OPEN = 'OPEN',
  /** Held past EOD at a loss/flat — no auto-sell; waiting for human decision. */
  NEEDS_REVIEW = 'NEEDS_REVIEW',
  CLOSED = 'CLOSED',
}

export enum TradeExitReason {
  TARGET = 'TARGET',
  STOP = 'STOP',
  /** Paper force-sell at EOD because position was profitable vs buy price. */
  EOD_PROFIT = 'EOD_PROFIT',
  /** Human closed a NEEDS_REVIEW lot from the UI / review API. */
  HUMAN_SELL = 'HUMAN_SELL',
  /** AI position manager recommended EXIT_NOW; backend validated and sold. */
  AI_EXIT = 'AI_EXIT',
  CANCELLED_SUPERSEDED = 'CANCELLED_SUPERSEDED',
  CANCELLED_EOD = 'CANCELLED_EOD',
}

/** Intraday management phase while status remains OPEN. */
export enum ManagementPhase {
  ENTRY = 'ENTRY',
  ACTIVE = 'ACTIVE',
  PROFITABLE = 'PROFITABLE',
  PROFIT_PROTECTION = 'PROFIT_PROTECTION',
  TRAILING = 'TRAILING',
}

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum BrokerOrderStatus {
  ORDER_REQUESTED = 'ORDER_REQUESTED',
  ORDER_PLACED = 'ORDER_PLACED',
  ORDER_OPEN = 'ORDER_OPEN',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum OrderSource {
  OMS = 'OMS',
  HUMAN = 'HUMAN',
  AI = 'AI',
}
