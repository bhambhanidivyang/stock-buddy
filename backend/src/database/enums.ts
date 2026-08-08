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
  CANCELLED_SUPERSEDED = 'CANCELLED_SUPERSEDED',
  CANCELLED_EOD = 'CANCELLED_EOD',
}
