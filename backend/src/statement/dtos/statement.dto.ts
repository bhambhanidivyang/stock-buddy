export class StatementDto {
  date: string;
  /** Notional bought that IST day (investedInr). */
  buyAmount: number;
  /** Sell proceeds that IST day. */
  sellAmount: number;
  profitLoss: number;
  cash: number;
  holdingsValue: number;
  /** e.g. "4xITC, 5xRELIANCE" */
  stocksBought: string;
  /** e.g. "4xITC, 2xTCS" */
  stocksSold: string;
  /** EOD open lots, e.g. "5xRELIANCE · new, 3xHDFCBANK" */
  holdings: string;
}
