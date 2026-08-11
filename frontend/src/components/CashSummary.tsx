"use client";

import { formatInr, pnlClass } from "@/lib/format";
import type { BalanceSnapshot } from "@/lib/types";

type Props = {
  balance: BalanceSnapshot | null;
  loading?: boolean;
  onOpenReview?: () => void;
};

export function CashSummary({ balance, loading, onOpenReview }: Props) {
  if (loading && !balance) {
    return (
      <div className="mb-6 rounded-xl border border-stone-200 bg-white/70 px-4 py-3 text-sm text-stone-500">
        Loading cash…
      </div>
    );
  }

  if (!balance) return null;

  const vsSeed = balance.equity - balance.initialFund;

  return (
    <div className="mb-6 grid gap-3 rounded-xl border border-stone-200 bg-white/80 p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <Metric label="Cash" value={formatInr(balance.cash)} />
      <Metric label="Holdings (MTM)" value={formatInr(balance.holdingsValue)} />
      <Metric label="Equity" value={formatInr(balance.equity)} />
      <Metric
        label="P&L"
        value={formatInr(balance.realizedPnl)}
        valueClass={pnlClass(balance.realizedPnl)}
        hint="Realized only (closed trades)"
      />
      <Metric
        label="Open MTM"
        value={formatInr(balance.unrealizedPnl)}
        valueClass={pnlClass(balance.unrealizedPnl)}
        hint="Mark − buy on open lots (not P&L)"
      />
      <div className="flex flex-col justify-center gap-1">
        <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
          Positions
        </p>
        <p className="text-sm tabular-nums text-stone-800">
          {balance.openPositions} open
          {balance.needsReviewPositions > 0 ? (
            <>
              {" · "}
              <button
                type="button"
                onClick={onOpenReview}
                className="font-semibold text-amber-800 underline decoration-amber-300 underline-offset-2 hover:text-amber-950"
              >
                {balance.needsReviewPositions} need review
              </button>
            </>
          ) : (
            <span className="text-stone-500"> · none in review</span>
          )}
        </p>
        <p className={`text-xs tabular-nums ${pnlClass(vsSeed)}`}>
          vs seed {formatInr(vsSeed)}
        </p>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  valueClass,
  hint,
}: {
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
        {label}
      </p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums text-stone-900 ${valueClass ?? ""}`}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
}
