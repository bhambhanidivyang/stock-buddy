"use client";

import {
  fetchExecuteHistory,
  fetchExecuteStatus,
  stopExecution,
} from "@/lib/api";
import { formatInr, formatPrice, pnlClass } from "@/lib/format";
import type {
  ExecuteStatus,
  ExecutionHistoryLeg,
  ExecutionHistorySession,
  ExecutionLeg,
} from "@/lib/types";
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
  const [history, setHistory] = useState<ExecutionHistorySession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(
    null,
  );

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

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const rows = await fetchExecuteHistory(accessToken, 40);
      setHistory(rows);
    } catch {
      // Keep prior history if refresh fails.
    } finally {
      setHistoryLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void refresh();
    void loadHistory();
    const id = window.setInterval(() => {
      void refresh();
    }, 8_000);
    return () => window.clearInterval(id);
  }, [refresh, loadHistory]);

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
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stop failed");
    } finally {
      setStopping(false);
    }
  }

  const running = status?.status === "RUNNING";
  const legs = status?.legs ?? [];
  const sortedLegs = [...legs].sort(
    (a, b) => stateRank(a.state) - stateRank(b.state),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <section className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-sm shadow-stone-900/5">
        <div className="border-b border-stone-100 bg-gradient-to-b from-stone-50/90 to-white px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                  Execution · today
                </p>
                {status ? (
                  <PhaseBadge phase={status.phase} running={running} />
                ) : null}
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
                onClick={() => {
                  void refresh();
                  void loadHistory();
                }}
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
          <dl className="grid gap-px bg-stone-100 sm:grid-cols-3 lg:grid-cols-6">
            <Stat
              label="Waiting buy"
              value={String(status.waitingBuy)}
              hint="Not filled yet"
              accent={status.waitingBuy > 0 ? "amber" : "neutral"}
            />
            <Stat
              label="Qty held"
              value={String(status.qtyHeld ?? status.openPositions)}
              hint="Still in portfolio"
              accent={(status.qtyHeld ?? 0) > 0 ? "sky" : "neutral"}
            />
            <Stat
              label="Qty sold today"
              value={String(status.qtySoldToday ?? status.soldPositions)}
              hint="Closed shares"
              accent={(status.qtySoldToday ?? 0) > 0 ? "teal" : "neutral"}
            />
            <Stat
              label="Needs review"
              value={String(status.needsReviewPositions)}
              hint="Human decision"
              accent={status.needsReviewPositions > 0 ? "rose" : "neutral"}
            />
            <Stat
              label="Unrealized"
              value={formatInr(status.unrealizedPnlOpen ?? 0)}
              hint="Mark − buy on held"
              accent="neutral"
              valueClass={pnlClass(status.unrealizedPnlOpen ?? 0)}
            />
            <Stat
              label="Realized today"
              value={formatInr(status.realizedPnlToday ?? 0)}
              hint="From sold lots"
              accent="neutral"
              valueClass={pnlClass(status.realizedPnlToday ?? 0)}
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

      <section className="space-y-3">
        <div>
          <h3 className="text-base font-semibold text-stone-900">
            Today&apos;s lots
          </h3>
          <p className="mt-0.5 text-sm text-stone-500">
            Each row is one lot. <span className="font-medium text-stone-700">Mark</span>{" "}
            = live quote on shares you still hold.{" "}
            <span className="font-medium text-stone-700">Sold @</span> = actual
            fill when that lot closed. Partial sells appear as a Sold row plus a
            remaining Holding row.
          </p>
        </div>

        {loading && !status ? (
          <p className="text-sm text-stone-500">Loading execution…</p>
        ) : sortedLegs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white/80 px-5 py-10 text-center">
            <p className="text-sm font-medium text-stone-700">No lots yet</p>
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
                    <th className="px-3 py-3 font-semibold sm:px-4">Stock</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                    <th className="px-3 py-3 font-semibold">Bought</th>
                    <th className="px-3 py-3 font-semibold">Held</th>
                    <th className="px-3 py-3 font-semibold">Sold</th>
                    <th className="px-3 py-3 font-semibold">Buy @</th>
                    <th className="px-3 py-3 font-semibold">Mark</th>
                    <th className="px-3 py-3 font-semibold">Sold @</th>
                    <th className="px-3 py-3 font-semibold">Tgt / SL</th>
                    <th className="px-3 py-3 font-semibold">Unrealized</th>
                    <th className="px-3 py-3 font-semibold sm:px-4">
                      Realized
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLegs.map((leg) => (
                    <LiveLotRow key={leg.tradeId} leg={leg} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-stone-900">
              Execution history
            </h3>
            <p className="mt-0.5 text-sm text-stone-500">
              Past sessions with buy/sell fills stored in the database.
            </p>
          </div>
          {historyLoading ? (
            <p className="text-xs text-stone-500">Refreshing…</p>
          ) : null}
        </div>

        {history.length === 0 && !historyLoading ? (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white/80 px-5 py-8 text-center text-sm text-stone-500">
            No past execution sessions yet.
          </div>
        ) : (
          <ul className="space-y-3">
            {history.map((session) => {
              const open = expandedSessionId === session.sessionId;
              return (
                <li
                  key={session.sessionId}
                  className={[
                    "overflow-hidden rounded-2xl border bg-white shadow-sm transition",
                    open
                      ? "border-teal-200/80 shadow-md shadow-teal-900/5"
                      : "border-stone-200/90 hover:border-stone-300",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedSessionId((prev) =>
                        prev === session.sessionId ? null : session.sessionId,
                      )
                    }
                    className="flex w-full flex-col gap-2 px-4 py-3.5 text-left sm:px-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[13px] font-semibold tabular-nums text-stone-900">
                          {formatIst(session.startedAt)}
                        </p>
                        <p className="mt-0.5 text-xs text-stone-500">
                          Bought {session.qtyBought} · Sold {session.qtySold}
                          {session.qtyHeld > 0
                            ? ` · Still held ${session.qtyHeld}`
                            : ""}
                          {" · "}
                          <span className={pnlClass(session.realizedPnl)}>
                            Realized {formatInr(session.realizedPnl)}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <SessionStatusBadge status={session.status} />
                        <span className="text-xs font-medium text-stone-400">
                          {open ? "Collapse" : "Expand"}
                        </span>
                      </div>
                    </div>
                    {session.legs.filter((l) => l.qtyBought > 0 || l.qtySold > 0)
                      .length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 border-t border-stone-100 pt-2">
                        {session.legs
                          .filter((l) => l.qtyBought > 0 || l.qtySold > 0)
                          .slice(0, 8)
                          .map((leg) => (
                            <span
                              key={leg.tradeId}
                              className="rounded-md bg-stone-50 px-2 py-0.5 text-[11px] font-semibold text-stone-800 ring-1 ring-stone-200/80"
                            >
                              {leg.symbol}
                              {leg.qtySold > 0
                                ? ` sold ${leg.qtySold}`
                                : ` hold ${leg.qtyHeld}`}
                            </span>
                          ))}
                      </div>
                    ) : null}
                  </button>

                  {open ? (
                    <div className="border-t border-stone-100 bg-stone-50/60 px-3 py-3 sm:px-4">
                      <HistoryLotsTable legs={session.legs} />
                      {session.stopReason ? (
                        <p className="mt-2 text-xs text-stone-500">
                          Stop reason: {session.stopReason}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function LiveLotRow({ leg }: { leg: ExecutionLeg }) {
  const qtyBought = leg.qtyBought ?? (leg.buyPrice != null ? leg.qty : 0);
  const qtyHeld =
    leg.qtyHeld ??
    (leg.state === "OPEN" || leg.state === "NEEDS_REVIEW" ? leg.qty : 0);
  const qtySold = leg.qtySold ?? (leg.state === "SOLD" ? leg.qty : 0);
  const unrealized =
    leg.unrealizedPnl ??
    (qtyHeld > 0 && leg.mark != null && leg.buyPrice != null
      ? Math.round((leg.mark - leg.buyPrice) * qtyHeld * 100) / 100
      : null);
  const realized = leg.state === "SOLD" ? leg.realizedPnl : null;

  return (
    <tr className="border-b border-stone-100 last:border-0 hover:bg-stone-50/60">
      <td className="px-3 py-3.5 sm:px-4">
        <p className="font-semibold text-stone-900">{leg.symbol}</p>
        {leg.exitReason ? (
          <p className="mt-0.5 text-[11px] text-stone-500">
            {humanExit(leg.exitReason)}
          </p>
        ) : null}
      </td>
      <td className="px-3 py-3.5">
        <StatusPill leg={leg} />
      </td>
      <td className="px-3 py-3.5 tabular-nums text-stone-700">{qtyBought}</td>
      <td className="px-3 py-3.5 tabular-nums text-stone-700">{qtyHeld}</td>
      <td className="px-3 py-3.5 tabular-nums text-stone-700">{qtySold}</td>
      <td className="px-3 py-3.5 tabular-nums text-stone-700">
        {leg.buyPrice != null
          ? formatPrice(leg.buyPrice)
          : leg.state === "WAITING_BUY"
            ? `${formatPrice(leg.buyLow)}–${formatPrice(leg.buyHigh)}`
            : "—"}
      </td>
      <td className="px-3 py-3.5 tabular-nums">
        {qtyHeld > 0 && leg.mark != null ? (
          <span className="font-medium text-sky-900">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-sky-700/80">
              Mark
            </span>
            {formatPrice(leg.mark)}
          </span>
        ) : (
          <span className="text-stone-300">—</span>
        )}
      </td>
      <td className="px-3 py-3.5 tabular-nums">
        {qtySold > 0 && leg.sellPrice != null ? (
          <span className="font-medium text-teal-900">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-teal-700/80">
              Sold
            </span>
            {formatPrice(leg.sellPrice)}
          </span>
        ) : (
          <span className="text-stone-300">—</span>
        )}
      </td>
      <td className="px-3 py-3.5 text-xs tabular-nums text-stone-600">
        <span className="text-teal-800">{formatPrice(leg.sellTarget)}</span>
        <span className="text-stone-300"> / </span>
        <span className="text-rose-800/85">{formatPrice(leg.stopLoss)}</span>
      </td>
      <td
        className={`px-3 py-3.5 tabular-nums font-semibold ${
          unrealized != null ? pnlClass(unrealized) : "text-stone-300"
        }`}
      >
        {unrealized != null ? formatInr(unrealized) : "—"}
      </td>
      <td
        className={`px-3 py-3.5 tabular-nums font-semibold sm:px-4 ${
          realized != null ? pnlClass(realized) : "text-stone-300"
        }`}
      >
        {realized != null ? formatInr(realized) : "—"}
      </td>
    </tr>
  );
}

function HistoryLotsTable({ legs }: { legs: ExecutionHistoryLeg[] }) {
  const rows = legs.filter(
    (l) =>
      l.state !== "CANCELLED" &&
      (l.qtyBought > 0 || l.qtySold > 0 || l.state === "WAITING_BUY"),
  );
  if (rows.length === 0) {
    return (
      <p className="text-sm text-stone-500">
        No filled lots in this session (buys may have been cancelled).
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
      <table className="min-w-full text-left text-xs">
        <thead>
          <tr className="border-b border-stone-200 bg-stone-50 text-[10px] uppercase tracking-wide text-stone-500">
            <th className="px-3 py-2 font-semibold">Stock</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 font-semibold">Bought</th>
            <th className="px-3 py-2 font-semibold">Held</th>
            <th className="px-3 py-2 font-semibold">Sold</th>
            <th className="px-3 py-2 font-semibold">Buy @</th>
            <th className="px-3 py-2 font-semibold">Sold @</th>
            <th className="px-3 py-2 font-semibold">Reason</th>
            <th className="px-3 py-2 font-semibold">Realized</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((leg) => (
            <tr key={leg.tradeId} className="border-b border-stone-100 last:border-0">
              <td className="px-3 py-2 font-semibold text-stone-900">
                {leg.symbol}
              </td>
              <td className="px-3 py-2 text-stone-600">{leg.state}</td>
              <td className="px-3 py-2 tabular-nums">{leg.qtyBought}</td>
              <td className="px-3 py-2 tabular-nums">{leg.qtyHeld}</td>
              <td className="px-3 py-2 tabular-nums">{leg.qtySold}</td>
              <td className="px-3 py-2 tabular-nums">
                {leg.buyPrice != null ? formatPrice(leg.buyPrice) : "—"}
              </td>
              <td className="px-3 py-2 tabular-nums font-medium text-teal-900">
                {leg.sellPrice != null ? formatPrice(leg.sellPrice) : "—"}
              </td>
              <td className="px-3 py-2 text-stone-600">
                {leg.exitReason ? humanExit(leg.exitReason) : "—"}
              </td>
              <td
                className={`px-3 py-2 tabular-nums font-semibold ${
                  leg.realizedPnl != null
                    ? pnlClass(leg.realizedPnl)
                    : "text-stone-300"
                }`}
              >
                {leg.realizedPnl != null ? formatInr(leg.realizedPnl) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

function SessionStatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const tone =
    s === "RUNNING"
      ? "bg-violet-50 text-violet-900 ring-violet-200/80"
      : s === "COMPLETED"
        ? "bg-teal-50 text-teal-900 ring-teal-200/80"
        : "bg-stone-100 text-stone-700 ring-stone-200/80";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${tone}`}
    >
      {status}
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
      return waiting === 1
        ? "Buying · 1 waiting"
        : `Buying · ${waiting} waiting`;
    }
    return "Buying entries";
  }

  if (status.phase === "MANAGING") {
    if (open === 0) return "Watching exits";
    return open === 1 ? "1 open position" : `${open} open positions`;
  }

  if (status.phase === "NEEDS_REVIEW") {
    return review === 1
      ? "1 position needs review"
      : `${review} positions need review`;
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
    return "Nothing left to manage today. Sold lots are listed below with their fill prices.";
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

function StatusPill({ leg }: { leg: ExecutionLeg }) {
  const tones: Record<string, string> = {
    SOLD: "bg-teal-50 text-teal-900 ring-teal-200/80",
    OPEN: "bg-sky-50 text-sky-900 ring-sky-200/80",
    WAITING_BUY: "bg-amber-50 text-amber-950 ring-amber-200/80",
    NEEDS_REVIEW: "bg-rose-50 text-rose-900 ring-rose-200/80",
  };
  const tone =
    tones[leg.state] ?? "bg-stone-100 text-stone-700 ring-stone-200/80";
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
  valueClass,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: "neutral" | "amber" | "sky" | "teal" | "rose";
  valueClass?: string;
}) {
  const accents = {
    neutral: "bg-white",
    amber: "bg-amber-50/50",
    sky: "bg-sky-50/50",
    teal: "bg-teal-50/50",
    rose: "bg-rose-50/50",
  };
  const valueColor =
    valueClass ??
    (accent === "rose" && value !== "0"
      ? "text-amber-900"
      : accent === "amber" && value !== "0"
        ? "text-amber-900"
        : accent === "sky" && value !== "0"
          ? "text-sky-950"
          : accent === "teal" && value !== "0"
            ? "text-teal-900"
            : "text-stone-900");

  return (
    <div className={`px-4 py-4 sm:px-5 ${accents[accent]}`}>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </dt>
      <dd
        className={`mt-1.5 text-xl font-semibold tabular-nums tracking-tight sm:text-2xl ${valueColor}`}
      >
        {value}
      </dd>
      <p className="mt-0.5 text-xs text-stone-500">{hint}</p>
    </div>
  );
}

function humanExit(reason: string): string {
  const r = reason.toUpperCase();
  if (r === "TARGET") return "Target hit";
  if (r === "STOP") return "Stop hit";
  if (r === "EOD_PROFIT") return "EOD profit";
  if (r === "HUMAN_SELL") return "Manual sell";
  if (r === "CANCELLED_EOD") return "Cancelled EOD";
  if (r === "CANCELLED_SUPERSEDED") return "Cancelled";
  return reason;
}

function formatIst(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
