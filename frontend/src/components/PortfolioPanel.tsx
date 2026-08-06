"use client";

import { useMarketOpen } from "@/hooks/useMarketOpen";
import { reviewTrade } from "@/lib/api";
import { formatInr, formatPrice, pnlClass } from "@/lib/format";
import type { HoldingRow, PortfolioSnapshot } from "@/lib/types";
import { useEffect, useState } from "react";

type LevelDraft = { sellTarget: string; stopLoss: string };

type Props = {
  portfolio: PortfolioSnapshot | null;
  loading?: boolean;
  error?: string | null;
  accessToken?: string | null;
  onChanged: () => void;
};

export function PortfolioPanel({
  portfolio,
  loading,
  error,
  accessToken,
  onChanged,
}: Props) {
  const { open: marketOpen } = useMarketOpen();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function onSell(
    row: HoldingRow,
    levels: { sellTarget: number; stopLoss: number },
  ) {
    const unchanged =
      levels.sellTarget === row.sellTarget && levels.stopLoss === row.stopLoss;
    if (unchanged) {
      const ok = window.confirm(
        `You haven’t changed the sell target or stop loss for ${row.symbol}.\n\nSell at the live mark anyway?`,
      );
      if (!ok) return;
    }

    setActionError(null);
    setMessage(null);
    setBusyId(row.tradeId);
    try {
      const result = await reviewTrade(
        row.tradeId,
        {
          action: "SELL",
          sellTarget: levels.sellTarget,
          stopLoss: levels.stopLoss,
        },
        accessToken,
      );
      setMessage(
        `Sold ${result.symbol} @ ${formatPrice(result.sellPrice ?? 0)} · P&L ${formatInr(result.realizedPnl ?? 0)}`,
      );
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Sell failed");
    } finally {
      setBusyId(null);
    }
  }

  async function onHold(
    row: HoldingRow,
    levels: { sellTarget: number; stopLoss: number },
  ) {
    const unchanged =
      levels.sellTarget === row.sellTarget && levels.stopLoss === row.stopLoss;
    if (unchanged) {
      const ok = window.confirm(
        `You haven’t changed the sell target or stop loss for ${row.symbol}.\n\nHold with the current levels (T ${formatPrice(row.sellTarget)} / SL ${formatPrice(row.stopLoss)})?`,
      );
      if (!ok) return;
    }

    setActionError(null);
    setMessage(null);
    setBusyId(row.tradeId);
    try {
      const result = await reviewTrade(
        row.tradeId,
        {
          action: "RESUME",
          sellTarget: levels.sellTarget,
          stopLoss: levels.stopLoss,
        },
        accessToken,
      );
      setMessage(
        `Holding ${result.symbol} → OPEN (T ${formatPrice(result.sellTarget ?? levels.sellTarget)} / SL ${formatPrice(result.stopLoss ?? levels.stopLoss)})`,
      );
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Hold failed");
    } finally {
      setBusyId(null);
    }
  }

  if (loading && !portfolio) {
    return <p className="text-sm text-stone-500">Loading portfolio…</p>;
  }

  if (error) {
    return (
      <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
        {error}
      </p>
    );
  }

  const holdings = portfolio?.holdings ?? [];
  const needsReview = portfolio?.needsReview ?? [];

  return (
    <div className="space-y-6">
      {needsReview.length > 0 ? (
        <section className="rounded-2xl border border-amber-200/80 bg-amber-50/40 p-5 shadow-sm ring-1 ring-amber-100/80">
          <h2 className="text-base font-semibold text-stone-900">
            {needsReview.length === 1
              ? "1 stock needs review"
              : `${needsReview.length} stocks need review`}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-stone-700">
            These lots are past the time-stop (or otherwise parked), so automation
            has stopped exiting them. Adjust target/stop if needed, then{" "}
            <span className="font-semibold text-stone-900">Sell</span> at the live
            mark during NSE hours, or{" "}
            <span className="font-semibold text-stone-900">Hold</span> to return the
            lot to OPEN with those levels.
          </p>
          <div className="mt-4">
            <ReviewHoldingsTable
              rows={needsReview}
              marketOpen={marketOpen}
              busyId={busyId}
              onSell={onSell}
              onHold={onHold}
            />
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-stone-900">Holdings</h2>
            <p className="mt-1 text-sm text-stone-600">
              {holdings.length === 0
                ? "No open or review lots."
                : `Invested ${formatInr(portfolio?.totals.invested ?? 0)} · MTM ${formatInr(portfolio?.totals.marketValue ?? 0)} · P&L `}
              {holdings.length > 0 ? (
                <span className={pnlClass(portfolio?.totals.unrealizedPnl ?? 0)}>
                  {formatInr(portfolio?.totals.unrealizedPnl ?? 0)}
                </span>
              ) : null}
            </p>
          </div>
          {portfolio?.asOf ? (
            <p className="text-xs text-stone-500">
              As of {new Date(portfolio.asOf).toLocaleString("en-IN")}
            </p>
          ) : null}
        </div>

        {holdings.length > 0 ? (
          <HoldingsTable rows={holdings} />
        ) : (
          <p className="text-sm text-stone-500">Book is flat.</p>
        )}
      </section>

      {actionError ? (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
          {actionError}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-md bg-teal-50 px-3 py-2 text-sm text-teal-900" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function ReviewHoldingsTable({
  rows,
  marketOpen,
  busyId,
  onSell,
  onHold,
}: {
  rows: HoldingRow[];
  marketOpen?: boolean;
  busyId?: string | null;
  onSell: (
    row: HoldingRow,
    levels: { sellTarget: number; stopLoss: number },
  ) => void;
  onHold: (
    row: HoldingRow,
    levels: { sellTarget: number; stopLoss: number },
  ) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, LevelDraft>>(() =>
    draftsFromRows(rows),
  );

  useEffect(() => {
    setDrafts(draftsFromRows(rows));
  }, [rows]);

  function parseLevels(row: HoldingRow): {
    ok: true;
    sellTarget: number;
    stopLoss: number;
  } | { ok: false; error: string } {
    const draft = drafts[row.tradeId] ?? {
      sellTarget: String(row.sellTarget),
      stopLoss: String(row.stopLoss),
    };
    const sellTarget = Number(draft.sellTarget);
    const stopLoss = Number(draft.stopLoss);
    if (!Number.isFinite(sellTarget) || !Number.isFinite(stopLoss)) {
      return { ok: false, error: "Enter valid target and stop prices." };
    }
    if (sellTarget <= stopLoss) {
      return { ok: false, error: "Sell target must be above stop loss." };
    }
    return { ok: true, sellTarget, stopLoss };
  }

  function runAction(
    row: HoldingRow,
    action: "sell" | "hold",
  ) {
    const parsed = parseLevels(row);
    if (!parsed.ok) {
      window.alert(parsed.error);
      return;
    }
    if (action === "sell") {
      onSell(row, parsed);
    } else {
      onHold(row, parsed);
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-amber-200/70 bg-white/90 shadow-sm">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-amber-100 bg-amber-50/80 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-4 py-3 font-medium">Symbol</th>
            <th className="px-4 py-3 font-medium">Qty</th>
            <th className="px-4 py-3 font-medium">Buy / Mark</th>
            <th className="px-4 py-3 font-medium">Sell target</th>
            <th className="px-4 py-3 font-medium">Stop loss</th>
            <th className="px-4 py-3 font-medium">MTM</th>
            <th className="px-4 py-3 font-medium">Unrealized</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const draft = drafts[row.tradeId] ?? {
              sellTarget: String(row.sellTarget),
              stopLoss: String(row.stopLoss),
            };
            const busy = busyId === row.tradeId;

            return (
              <tr
                key={row.tradeId}
                className="border-b border-amber-50 last:border-0"
              >
                <td className="px-4 py-3 font-medium text-stone-900">
                  {row.symbol}
                  <span className="ml-2 text-xs font-normal text-stone-500">
                    {row.role}
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums text-stone-700">
                  {row.qty}
                </td>
                <td className="px-4 py-3 tabular-nums text-stone-700">
                  {formatPrice(row.buyPrice)} / {formatPrice(row.currentPrice)}
                </td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={draft.sellTarget}
                    disabled={busy}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [row.tradeId]: {
                          ...draft,
                          sellTarget: e.target.value,
                        },
                      }))
                    }
                    className="w-28 rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm tabular-nums text-stone-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-60"
                    aria-label={`${row.symbol} sell target`}
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={draft.stopLoss}
                    disabled={busy}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [row.tradeId]: {
                          ...draft,
                          stopLoss: e.target.value,
                        },
                      }))
                    }
                    className="w-28 rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm tabular-nums text-stone-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-60"
                    aria-label={`${row.symbol} stop loss`}
                  />
                </td>
                <td className="px-4 py-3 tabular-nums text-stone-700">
                  {formatInr(row.marketValue)}
                </td>
                <td
                  className={`px-4 py-3 tabular-nums ${pnlClass(row.unrealizedPnl)}`}
                >
                  {formatInr(row.unrealizedPnl)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy || !marketOpen}
                      title={
                        marketOpen
                          ? "Paper sell at live Yahoo mark"
                          : "Sell only while NSE is open"
                      }
                      onClick={() => runAction(row, "sell")}
                      className="rounded-md bg-rose-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {busy ? "…" : "Sell"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => runAction(row, "hold")}
                      className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-800 hover:bg-stone-50 disabled:opacity-45"
                    >
                      Hold
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function draftsFromRows(rows: HoldingRow[]): Record<string, LevelDraft> {
  const next: Record<string, LevelDraft> = {};
  for (const row of rows) {
    next[row.tradeId] = {
      sellTarget: String(row.sellTarget),
      stopLoss: String(row.stopLoss),
    };
  }
  return next;
}

function HoldingsTable({ rows }: { rows: HoldingRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white/80 shadow-sm">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-stone-200 bg-stone-50/90 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-4 py-3 font-medium">Symbol</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Qty</th>
            <th className="px-4 py-3 font-medium">Buy / Mark</th>
            <th className="px-4 py-3 font-medium">Target / Stop</th>
            <th className="px-4 py-3 font-medium">MTM</th>
            <th className="px-4 py-3 font-medium">Unrealized</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.tradeId} className="border-b border-stone-100 last:border-0">
              <td className="px-4 py-3 font-medium text-stone-900">
                {row.symbol}
                <span className="ml-2 text-xs font-normal text-stone-500">
                  {row.role}
                </span>
              </td>
              <td className="px-4 py-3">
                <StatusPill status={row.status} review={row.needsHumanReview} />
              </td>
              <td className="px-4 py-3 tabular-nums text-stone-700">{row.qty}</td>
              <td className="px-4 py-3 tabular-nums text-stone-700">
                {formatPrice(row.buyPrice)} / {formatPrice(row.currentPrice)}
              </td>
              <td className="px-4 py-3 tabular-nums text-stone-700">
                {formatPrice(row.sellTarget)} / {formatPrice(row.stopLoss)}
              </td>
              <td className="px-4 py-3 tabular-nums text-stone-700">
                {formatInr(row.marketValue)}
              </td>
              <td className={`px-4 py-3 tabular-nums ${pnlClass(row.unrealizedPnl)}`}>
                {formatInr(row.unrealizedPnl)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status, review }: { status: string; review: boolean }) {
  const classes = review
    ? "bg-amber-100 text-amber-900"
    : status === "OPEN"
      ? "bg-teal-100 text-teal-900"
      : "bg-stone-100 text-stone-700";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${classes}`}
    >
      {status}
    </span>
  );
}
