"use client";

import { fetchExecuteStatus, stopExecution } from "@/lib/api";
import { formatInr, formatPrice, pnlClass } from "@/lib/format";
import type { ExecuteStatus, ExecutionLeg } from "@/lib/types";
import { useCallback, useEffect, useState } from "react";

type Props = {
  accessToken?: string | null;
  status: ExecuteStatus | null;
  onStatus: (status: ExecuteStatus) => void;
};

export function ExecutionPanel({ accessToken, status, onStatus }: Props) {
  const [loading, setLoading] = useState(!status);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const next = await fetchExecuteStatus(accessToken);
      onStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setLoading(false);
    }
  }, [accessToken, onStatus]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, 8_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function onStop() {
    setStopping(true);
    setError(null);
    setMessage(null);
    try {
      const result = await stopExecution(accessToken);
      setMessage(
        result.status === "IDLE"
          ? "No live buy session to stop."
          : `Stopped buy session (${result.stopReason ?? "MANUAL"}). Open lots keep chasing targets.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stop failed");
    } finally {
      setStopping(false);
    }
  }

  const running = status?.status === "RUNNING";
  const legs = status?.legs ?? [];
  const sortedLegs = [...legs].sort((a, b) => stateRank(a.state) - stateRank(b.state));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Session header */}
      <section className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-sm shadow-stone-900/5">
        <div className="border-b border-stone-100 bg-gradient-to-b from-stone-50/90 to-white px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                  Execution
                </p>
                {status ? <PhaseBadge phase={status.phase} running={running} /> : null}
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-stone-900 sm:text-2xl">
                {loading && !status
                  ? "Loading…"
                  : executionHeadline(status)}
              </h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-stone-600">
                {phaseBlurb(status)}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => void refresh()}
                className="rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-800 transition hover:bg-stone-50"
              >
                Refresh
              </button>
              <button
                type="button"
                disabled={!running || stopping}
                title={
                  running
                    ? "Cancel unfilled waiting buys for the live session"
                    : "No live buy session"
                }
                onClick={() => void onStop()}
                className="rounded-lg bg-stone-800 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-stone-900 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {stopping ? "Stopping…" : "Stop buys"}
              </button>
            </div>
          </div>
        </div>

        {status ? (
          <dl className="grid gap-px bg-stone-100 sm:grid-cols-4">
            <Stat
              label="Waiting buy"
              value={String(status.waitingBuy)}
              hint="In entry band"
              accent={status.waitingBuy > 0 ? "amber" : "neutral"}
            />
            <Stat
              label="Open"
              value={String(status.openPositions)}
              hint="Chasing exit"
              accent={status.openPositions > 0 ? "sky" : "neutral"}
            />
            <Stat
              label="Sold today"
              value={String(status.soldPositions)}
              hint="Closed today"
              accent={status.soldPositions > 0 ? "teal" : "neutral"}
            />
            <Stat
              label="Needs review"
              value={String(status.needsReviewPositions)}
              hint="Human decision"
              accent={status.needsReviewPositions > 0 ? "rose" : "neutral"}
            />
          </dl>
        ) : null}
      </section>

      {error ? (
        <p
          className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200/80"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          className="rounded-xl bg-teal-50 px-4 py-3 text-sm text-teal-900 ring-1 ring-teal-200/80"
          role="status"
        >
          {message}
        </p>
      ) : null}

      {/* Stock book */}
      <section className="space-y-3">
        <div>
          <h3 className="text-base font-semibold text-stone-900">Positions</h3>
          <p className="mt-0.5 text-sm text-stone-500">
            Open lots and today’s sells, with target, stop, and P&amp;L on each
            row.
          </p>
        </div>

        {loading && !status ? (
          <p className="text-sm text-stone-500">Loading execution…</p>
        ) : sortedLegs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white/80 px-5 py-10 text-center">
            <p className="text-sm font-medium text-stone-700">No legs yet</p>
            <p className="mt-1 text-sm text-stone-500">
              Run Recommendations → Execute trade to start buying.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-sm shadow-stone-900/5">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50/95 text-[10px] uppercase tracking-[0.08em] text-stone-500">
                    <th className="px-4 py-3 font-semibold sm:px-5">Stock</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Qty</th>
                    <th className="px-4 py-3 font-semibold">Buy</th>
                    <th className="px-4 py-3 font-semibold">Target</th>
                    <th className="px-4 py-3 font-semibold">Stop</th>
                    <th className="px-4 py-3 font-semibold">Mark / sold</th>
                    <th className="px-4 py-3 font-semibold sm:px-5">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLegs.map((leg) => {
                    const pnl = legPnl(leg);
                    return (
                      <tr
                        key={leg.tradeId}
                        className="border-b border-stone-100 last:border-0 hover:bg-stone-50/60"
                      >
                        <td className="px-4 py-3.5 sm:px-5">
                          <p className="font-semibold text-stone-900">
                            {leg.symbol}
                          </p>
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusPill leg={leg} />
                        </td>
                        <td className="px-4 py-3.5 tabular-nums text-stone-700">
                          {leg.qty}
                        </td>
                        <td className="px-4 py-3.5 tabular-nums text-stone-700">
                          {leg.buyPrice != null
                            ? formatPrice(leg.buyPrice)
                            : `${formatPrice(leg.buyLow)}–${formatPrice(leg.buyHigh)}`}
                        </td>
                        <td className="px-4 py-3.5 tabular-nums font-medium text-teal-800">
                          {formatPrice(leg.sellTarget)}
                        </td>
                        <td className="px-4 py-3.5 tabular-nums font-medium text-rose-800/85">
                          {formatPrice(leg.stopLoss)}
                        </td>
                        <td
                          className={`px-4 py-3.5 tabular-nums font-medium ${markSoldClass(leg)}`}
                        >
                          {leg.state === "SOLD"
                            ? formatPrice(leg.sellPrice ?? 0)
                            : leg.mark != null
                              ? formatPrice(leg.mark)
                              : "—"}
                        </td>
                        <td
                          className={`px-4 py-3.5 tabular-nums font-semibold sm:px-5 ${
                            pnl != null ? pnlClass(pnl) : "text-stone-400"
                          }`}
                        >
                          {pnl != null ? formatInr(pnl) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function PhaseBadge({
  phase,
  running,
}: {
  phase: ExecuteStatus["phase"];
  running: boolean;
}) {
  const label = running ? "Live" : phase === "NEEDS_REVIEW" ? "Review" : "Idle";
  const tone = running
    ? "bg-violet-50 text-violet-900 ring-violet-200/80"
    : phase === "NEEDS_REVIEW"
      ? "bg-amber-50 text-amber-950 ring-amber-200/80"
      : "bg-stone-100 text-stone-600 ring-stone-200/80";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${tone}`}
    >
      {label}
    </span>
  );
}

function executionHeadline(status: ExecuteStatus | null): string {
  if (!status) return "No session yet";

  const open = status.openPositions;
  const waiting = status.waitingBuy;
  const review = status.needsReviewPositions;
  const sold = status.soldPositions;

  if (status.phase === "BUYING") {
    if (waiting > 0 && open > 0) {
      return `Buying · ${waiting} waiting, ${open} open`;
    }
    if (waiting > 0) {
      return waiting === 1 ? "Buying · 1 waiting" : `Buying · ${waiting} waiting`;
    }
    return "Buying entries";
  }

  if (status.phase === "MANAGING") {
    if (open === 0) return "Watching exits";
    return open === 1 ? "1 open position" : `${open} open positions`;
  }

  if (status.phase === "NEEDS_REVIEW") {
    return review === 1 ? "1 position needs review" : `${review} positions need review`;
  }

  if (sold > 0) {
    return sold === 1 ? "Idle · 1 sold today" : `Idle · ${sold} sold today`;
  }

  return "Idle";
}

function phaseBlurb(status: ExecuteStatus | null): string {
  if (!status) return "";

  if (status.phase === "BUYING") {
    return "A buy session is live. New lots fill inside their entry band, then target and stop watching starts on each fill.";
  }

  if (status.phase === "MANAGING") {
    if (status.status === "RUNNING") {
      return "Entries are done for now. Open lots are watched for sell target or stop while the session is live.";
    }
    return "The buy session has ended. Open lots are still watched for sell target or stop while the NSE market is open.";
  }

  if (status.phase === "NEEDS_REVIEW") {
    return "Some lots are parked. Open Portfolio to Sell at the live mark or Hold with updated target and stop.";
  }

  if (status.soldPositions > 0) {
    return "Nothing left to manage today. Sold lots are listed below.";
  }

  return "Start from Recommendations → Execute trade when you want new buys.";
}

function stateRank(state: ExecutionLeg["state"]): number {
  switch (state) {
    case "WAITING_BUY":
      return 0;
    case "OPEN":
      return 1;
    case "NEEDS_REVIEW":
      return 2;
    case "SOLD":
      return 3;
    default:
      return 9;
  }
}

function markSoldClass(leg: ExecutionLeg): string {
  const price = leg.state === "SOLD" ? leg.sellPrice : leg.mark;
  if (price == null || leg.buyPrice == null) {
    return "text-stone-700";
  }
  return pnlClass(price - leg.buyPrice);
}

function legPnl(leg: ExecutionLeg): number | null {
  if (leg.state === "SOLD") {
    return leg.realizedPnl;
  }
  if (
    (leg.state === "OPEN" || leg.state === "NEEDS_REVIEW") &&
    leg.mark != null &&
    leg.buyPrice != null
  ) {
    return Math.round((leg.mark - leg.buyPrice) * leg.qty * 100) / 100;
  }
  return null;
}

function StatusPill({ leg }: { leg: ExecutionLeg }) {
  const tones: Record<string, string> = {
    SOLD: "bg-teal-50 text-teal-900 ring-teal-200/80",
    OPEN: "bg-sky-50 text-sky-900 ring-sky-200/80",
    WAITING_BUY: "bg-amber-50 text-amber-950 ring-amber-200/80",
    NEEDS_REVIEW: "bg-rose-50 text-rose-900 ring-rose-200/80",
  };
  const tone = tones[leg.state] ?? "bg-stone-100 text-stone-700 ring-stone-200/80";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tone}`}
    >
      {leg.statusLabel}
    </span>
  );
}

function Stat({
  label,
  value,
  hint,
  accent = "neutral",
}: {
  label: string;
  value: string;
  hint: string;
  accent?: "neutral" | "amber" | "sky" | "teal" | "rose";
}) {
  const accents = {
    neutral: "bg-white",
    amber: "bg-amber-50/50",
    sky: "bg-sky-50/50",
    teal: "bg-teal-50/50",
    rose: "bg-rose-50/50",
  };
  const valueColor =
    accent === "rose" && value !== "0"
      ? "text-amber-900"
      : accent === "amber" && value !== "0"
        ? "text-amber-900"
        : accent === "sky" && value !== "0"
          ? "text-sky-950"
          : accent === "teal" && value !== "0"
            ? "text-teal-900"
            : "text-stone-900";

  return (
    <div className={`px-4 py-4 sm:px-5 ${accents[accent]}`}>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </dt>
      <dd className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-tight ${valueColor}`}>
        {value}
      </dd>
      <p className="mt-0.5 text-xs text-stone-500">{hint}</p>
    </div>
  );
}
