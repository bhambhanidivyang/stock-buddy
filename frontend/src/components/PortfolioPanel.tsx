"use client";

import { useMarketOpen } from "@/hooks/useMarketOpen";
import { reviewTrade } from "@/lib/api";
import { formatInr, formatPrice, pnlClass } from "@/lib/format";
import type { HoldingRow, PortfolioSnapshot } from "@/lib/types";
import { useEffect, useId, useRef, useState } from "react";

type DialogMode = "modify" | "sell" | "hold";

type DialogState = {
  mode: DialogMode;
  row: HoldingRow;
};

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
  const [dialog, setDialog] = useState<DialogState | null>(null);

  async function submitModify(
    row: HoldingRow,
    levels: { sellTarget: number; stopLoss: number },
  ) {
    const unchanged =
      levels.sellTarget === row.sellTarget && levels.stopLoss === row.stopLoss;
    if (unchanged) {
      window.alert("Change the sell target or stop loss before saving.");
      return;
    }

    setActionError(null);
    setMessage(null);
    setBusyId(row.tradeId);
    try {
      const result = await reviewTrade(
        row.tradeId,
        {
          action: "MODIFY",
          sellTarget: levels.sellTarget,
          stopLoss: levels.stopLoss,
        },
        accessToken,
      );
      setMessage(
        `Updated ${result.symbol} → T ${formatPrice(result.sellTarget ?? levels.sellTarget)} / SL ${formatPrice(result.stopLoss ?? levels.stopLoss)}`,
      );
      setDialog(null);
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Modify failed");
    } finally {
      setBusyId(null);
    }
  }

  async function submitSell(
    row: HoldingRow,
    input: { sellTarget: number; stopLoss: number; qty: number },
  ) {
    setActionError(null);
    setMessage(null);
    setBusyId(row.tradeId);
    try {
      const result = await reviewTrade(
        row.tradeId,
        {
          action: "SELL",
          sellTarget: input.sellTarget,
          stopLoss: input.stopLoss,
          qty: input.qty,
        },
        accessToken,
      );
      const sold = result.qtySold ?? input.qty;
      const left = result.qtyRemaining ?? row.qty - sold;
      setMessage(
        left > 0
          ? `Sold ${sold}× ${result.symbol} @ ${formatPrice(result.sellPrice ?? 0)} · left ${left} · P&L ${formatInr(result.realizedPnl ?? 0)}`
          : `Sold ${sold}× ${result.symbol} @ ${formatPrice(result.sellPrice ?? 0)} · P&L ${formatInr(result.realizedPnl ?? 0)}`,
      );
      setDialog(null);
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Sell failed");
    } finally {
      setBusyId(null);
    }
  }

  async function submitHold(
    row: HoldingRow,
    levels: { sellTarget: number; stopLoss: number },
  ) {
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
      setDialog(null);
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
            Automation has stopped exiting these lots. Use{" "}
            <span className="font-semibold text-stone-900">Modify</span>,{" "}
            <span className="font-semibold text-stone-900">Sell</span>, or{" "}
            <span className="font-semibold text-stone-900">Hold</span> to decide.
          </p>
          <div className="mt-4">
            <HoldingsTable
              rows={needsReview}
              marketOpen={marketOpen}
              busyId={busyId}
              variant="review"
              onOpen={(mode, row) => setDialog({ mode, row })}
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
                : `Invested ${formatInr(portfolio?.totals.invested ?? 0)} · MTM ${formatInr(portfolio?.totals.marketValue ?? 0)} · Open MTM `}
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
          <HoldingsTable
            rows={holdings}
            marketOpen={marketOpen}
            busyId={busyId}
            variant="holdings"
            onOpen={(mode, row) => setDialog({ mode, row })}
          />
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

      {dialog ? (
        <HoldingActionDialog
          mode={dialog.mode}
          row={dialog.row}
          busy={busyId === dialog.row.tradeId}
          marketOpen={marketOpen}
          onClose={() => setDialog(null)}
          onModify={submitModify}
          onSell={submitSell}
          onHold={submitHold}
        />
      ) : null}
    </div>
  );
}

function HoldingsTable({
  rows,
  marketOpen,
  busyId,
  variant,
  onOpen,
}: {
  rows: HoldingRow[];
  marketOpen?: boolean;
  busyId?: string | null;
  variant: "review" | "holdings";
  onOpen: (mode: DialogMode, row: HoldingRow) => void;
}) {
  const shell =
    variant === "review"
      ? "overflow-x-auto rounded-xl border border-amber-200/70 bg-white/90 shadow-sm"
      : "overflow-x-auto rounded-xl border border-stone-200 bg-white/80 shadow-sm";
  const thead =
    variant === "review"
      ? "border-b border-amber-100 bg-amber-50/80 text-xs uppercase tracking-wide text-stone-500"
      : "border-b border-stone-200 bg-stone-50/90 text-xs uppercase tracking-wide text-stone-500";
  const rowBorder =
    variant === "review"
      ? "border-b border-amber-50 last:border-0"
      : "border-b border-stone-100 last:border-0";

  return (
    <div className={shell}>
      <table className="min-w-full text-left text-sm">
        <thead className={thead}>
          <tr>
            <th className="px-4 py-3 font-medium">Symbol</th>
            {variant === "holdings" ? (
              <th className="px-4 py-3 font-medium">Status</th>
            ) : null}
            <th className="px-4 py-3 font-medium">Qty</th>
            <th className="px-4 py-3 font-medium">Buy / Mark</th>
            <th className="px-4 py-3 font-medium">Target / Stop</th>
            <th className="px-4 py-3 font-medium">MTM</th>
            <th className="px-4 py-3 font-medium">Open MTM</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const busy = busyId === row.tradeId;
            const showHold = row.status === "NEEDS_REVIEW";

            return (
              <tr key={row.tradeId} className={rowBorder}>
                <td className="px-4 py-3 font-medium text-stone-900">
                  {row.symbol}
                  <span className="ml-2 text-xs font-normal text-stone-500">
                    {row.role}
                  </span>
                </td>
                {variant === "holdings" ? (
                  <td className="px-4 py-3">
                    <StatusPill
                      status={row.status}
                      review={row.needsHumanReview}
                    />
                  </td>
                ) : null}
                <td className="px-4 py-3 tabular-nums text-stone-700">
                  {row.qty}
                </td>
                <td className="px-4 py-3 tabular-nums text-stone-700">
                  {formatPrice(row.buyPrice)} / {formatPrice(row.currentPrice)}
                </td>
                <td className="px-4 py-3 tabular-nums text-stone-700">
                  {formatPrice(row.sellTarget)} / {formatPrice(row.stopLoss)}
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
                      disabled={busy}
                      onClick={() => onOpen("modify", row)}
                      className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-800 hover:bg-stone-50 disabled:opacity-45"
                    >
                      Modify
                    </button>
                    <button
                      type="button"
                      disabled={busy || !marketOpen}
                      title={
                        marketOpen
                          ? "Paper sell at live Yahoo mark"
                          : "Sell only while NSE is open"
                      }
                      onClick={() => onOpen("sell", row)}
                      className="rounded-md bg-rose-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Sell
                    </button>
                    {showHold ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onOpen("hold", row)}
                        className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-45"
                      >
                        Hold
                      </button>
                    ) : null}
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

function HoldingActionDialog({
  mode,
  row,
  busy,
  marketOpen,
  onClose,
  onModify,
  onSell,
  onHold,
}: {
  mode: DialogMode;
  row: HoldingRow;
  busy: boolean;
  marketOpen?: boolean;
  onClose: () => void;
  onModify: (
    row: HoldingRow,
    levels: { sellTarget: number; stopLoss: number },
  ) => void;
  onSell: (
    row: HoldingRow,
    input: { sellTarget: number; stopLoss: number; qty: number },
  ) => void;
  onHold: (
    row: HoldingRow,
    levels: { sellTarget: number; stopLoss: number },
  ) => void;
}) {
  const titleId = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [sellTarget, setSellTarget] = useState(String(row.sellTarget));
  const [stopLoss, setStopLoss] = useState(String(row.stopLoss));
  const [sellQty, setSellQty] = useState(String(row.qty));
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    sellTarget?: string;
    stopLoss?: string;
    sellQty?: string;
  }>({});

  useEffect(() => {
    setSellTarget(String(row.sellTarget));
    setStopLoss(String(row.stopLoss));
    setSellQty(String(row.qty));
    setFormError(null);
    setFieldErrors({});
  }, [row, mode]);

  useEffect(() => {
    firstFieldRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const title =
    mode === "modify"
      ? `Modify ${row.symbol}`
      : mode === "sell"
        ? `Sell ${row.symbol}`
        : `Hold ${row.symbol}`;

  const maxUnits = row.qty;

  function validatePrices(rawTarget: string, rawStop: string): {
    ok: true;
    sellTarget: number;
    stopLoss: number;
  } | {
    ok: false;
    errors: { sellTarget?: string; stopLoss?: string };
  } {
    const errors: { sellTarget?: string; stopLoss?: string } = {};
    const t = Number(String(rawTarget).trim());
    const s = Number(String(rawStop).trim());

    if (String(rawTarget).trim() === "" || !Number.isFinite(t)) {
      errors.sellTarget = "Enter a valid sell target price.";
    } else if (!(t > 0)) {
      errors.sellTarget = "Sell target must be greater than 0.";
    }

    if (String(rawStop).trim() === "" || !Number.isFinite(s)) {
      errors.stopLoss = "Enter a valid stop loss price.";
    } else if (!(s > 0)) {
      errors.stopLoss = "Stop loss must be greater than 0.";
    }

    if (!errors.sellTarget && !errors.stopLoss && t <= s) {
      errors.sellTarget = "Must be above stop loss.";
      errors.stopLoss = "Must be below sell target.";
    }

    if (errors.sellTarget || errors.stopLoss) {
      return { ok: false, errors };
    }
    return { ok: true, sellTarget: t, stopLoss: s };
  }

  function validateQty(rawQty: string):
    | { ok: true; qty: number }
    | { ok: false; error: string } {
    const trimmed = String(rawQty).trim();
    if (trimmed === "") {
      return { ok: false, error: `Enter units to sell (1–${maxUnits}).` };
    }
    const asNum = Number(trimmed);
    if (!Number.isFinite(asNum)) {
      return { ok: false, error: "Units must be a number." };
    }
    if (!Number.isInteger(asNum)) {
      return { ok: false, error: "Units must be a whole number (no decimals)." };
    }
    if (asNum < 1) {
      return { ok: false, error: "Units must be at least 1." };
    }
    if (asNum > maxUnits) {
      return {
        ok: false,
        error: `You can sell at most ${maxUnits} unit${maxUnits === 1 ? "" : "s"}.`,
      };
    }
    return { ok: true, qty: asNum };
  }

  function submit() {
    setFormError(null);
    setFieldErrors({});

    if (mode === "sell") {
      if (!marketOpen) {
        setFormError("Sell only while NSE is open (09:15–15:30 IST).");
        return;
      }
      const prices = validatePrices(sellTarget, stopLoss);
      const qty = validateQty(sellQty);
      const nextErrors: {
        sellTarget?: string;
        stopLoss?: string;
        sellQty?: string;
      } = {};
      if (!prices.ok) Object.assign(nextErrors, prices.errors);
      if (!qty.ok) nextErrors.sellQty = qty.error;
      if (Object.keys(nextErrors).length > 0) {
        setFieldErrors(nextErrors);
        return;
      }
      if (prices.ok && qty.ok) {
        onSell(row, {
          sellTarget: prices.sellTarget,
          stopLoss: prices.stopLoss,
          qty: qty.qty,
        });
      }
      return;
    }

    const prices = validatePrices(sellTarget, stopLoss);
    if (!prices.ok) {
      setFieldErrors(prices.errors);
      return;
    }
    if (mode === "modify") onModify(row, prices);
    else onHold(row, prices);
  }

  const inputClass = (hasError?: string) =>
    `w-full rounded-md border px-3 py-2 text-sm tabular-nums text-stone-900 outline-none focus:ring-1 disabled:opacity-60 ${
      hasError
        ? "border-rose-400 focus:border-rose-500 focus:ring-rose-400"
        : "border-stone-300 focus:border-teal-500 focus:ring-teal-500"
    }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id={titleId} className="text-base font-semibold text-stone-900">
              {title}
            </h3>
            <p className="mt-1 text-sm text-stone-600">
              Holding {maxUnits} unit{maxUnits === 1 ? "" : "s"} · mark{" "}
              {formatPrice(row.currentPrice)} · buy {formatPrice(row.buyPrice)}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-45"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-sm text-stone-700">
            <span className="mb-1 block font-medium">Sell target (₹)</span>
            <input
              ref={firstFieldRef}
              type="number"
              step="any"
              min={0.01}
              inputMode="decimal"
              value={sellTarget}
              disabled={busy}
              onChange={(e) => {
                setSellTarget(e.target.value);
                setFieldErrors((prev) => ({ ...prev, sellTarget: undefined }));
              }}
              className={inputClass(fieldErrors.sellTarget)}
              aria-invalid={Boolean(fieldErrors.sellTarget)}
            />
            {fieldErrors.sellTarget ? (
              <span className="mt-1 block text-xs text-rose-700">
                {fieldErrors.sellTarget}
              </span>
            ) : null}
          </label>

          <label className="block text-sm text-stone-700">
            <span className="mb-1 block font-medium">Stop loss (₹)</span>
            <input
              type="number"
              step="any"
              min={0.01}
              inputMode="decimal"
              value={stopLoss}
              disabled={busy}
              onChange={(e) => {
                setStopLoss(e.target.value);
                setFieldErrors((prev) => ({ ...prev, stopLoss: undefined }));
              }}
              className={inputClass(fieldErrors.stopLoss)}
              aria-invalid={Boolean(fieldErrors.stopLoss)}
            />
            {fieldErrors.stopLoss ? (
              <span className="mt-1 block text-xs text-rose-700">
                {fieldErrors.stopLoss}
              </span>
            ) : null}
          </label>

          {mode === "sell" ? (
            <>
              <label className="block text-sm text-stone-700">
                <span className="mb-1 block font-medium">
                  Units to sell (max {maxUnits})
                </span>
                <input
                  type="number"
                  min={1}
                  max={maxUnits}
                  step={1}
                  inputMode="numeric"
                  value={sellQty}
                  disabled={busy}
                  onChange={(e) => {
                    setSellQty(e.target.value);
                    setFieldErrors((prev) => ({
                      ...prev,
                      sellQty: undefined,
                    }));
                  }}
                  className={inputClass(fieldErrors.sellQty)}
                  aria-invalid={Boolean(fieldErrors.sellQty)}
                />
                {fieldErrors.sellQty ? (
                  <span className="mt-1 block text-xs text-rose-700">
                    {fieldErrors.sellQty}
                  </span>
                ) : (
                  <span className="mt-1 block text-xs text-stone-500">
                    You can sell 1–{maxUnits} unit
                    {maxUnits === 1 ? "" : "s"} from this lot.
                  </span>
                )}
              </label>
              <p className="text-xs text-stone-500">
                Fills at the live Yahoo mark during NSE hours. If you sell
                fewer than {maxUnits}, remaining units keep the levels you
                set above.
              </p>
            </>
          ) : (
            <p className="rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-600">
              Lot size: <span className="font-medium text-stone-800">{maxUnits}</span>{" "}
              unit{maxUnits === 1 ? "" : "s"}
              {mode === "hold"
                ? " — Hold returns this lot to OPEN with the levels above."
                : " — Modify updates target/stop for the full lot."}
            </p>
          )}

          {formError ? (
            <p className="text-sm text-rose-700" role="alert">
              {formError}
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-45"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || (mode === "sell" && !marketOpen)}
            onClick={submit}
            className={
              mode === "sell"
                ? "rounded-md bg-rose-800 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-45"
                : "rounded-md bg-teal-800 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-45"
            }
          >
            {busy
              ? "…"
              : mode === "modify"
                ? "Save levels"
                : mode === "sell"
                  ? "Confirm sell"
                  : "Confirm hold"}
          </button>
        </div>
      </div>
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
