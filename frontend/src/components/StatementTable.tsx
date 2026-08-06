"use client";

import { useState } from "react";
import { formatInr, formatPrice, pnlClass } from "@/lib/format";
import type { StatementRow } from "@/lib/types";

type StockToken = {
  qty: number;
  symbol: string;
  isNew: boolean;
  buyPrice?: number;
  stopLoss?: number;
  sellTarget?: number;
};

/** Parses "4xAXISBANK @180 SL174 T187" / "5xRELIANCE · new" into tokens. */
function parseStockList(value: string | null | undefined): StockToken[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const isNew = /·\s*new/i.test(part);
      const cleaned = part.replace(/\s*·\s*new/i, "").trim();
      const withLevels = cleaned.match(
        /^(\d+)\s*x\s*([A-Z0-9.&-]+)\s+@([\d.]+)\s+SL([\d.]+)\s+T([\d.]+)$/i,
      );
      if (withLevels) {
        return {
          qty: Number(withLevels[1]),
          symbol: withLevels[2].trim(),
          isNew,
          buyPrice: Number(withLevels[3]),
          stopLoss: Number(withLevels[4]),
          sellTarget: Number(withLevels[5]),
        };
      }
      const match = cleaned.match(/^(\d+)\s*x\s*(.+)$/i);
      if (!match) {
        return { qty: 0, symbol: cleaned, isNew };
      }
      return {
        qty: Number(match[1]),
        symbol: match[2].trim(),
        isNew,
      };
    });
}

type Props = {
  rows: StatementRow[];
  loading?: boolean;
  error?: string | null;
};

export function StatementTable({ rows, loading, error }: Props) {
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  if (loading) {
    return (
      <p className="text-sm text-stone-500" role="status">
        Loading statements…
      </p>
    );
  }

  if (error) {
    return (
      <p
        className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200/80"
        role="alert"
      >
        {error}
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-300 bg-white/80 px-5 py-10 text-center">
        <p className="text-sm font-medium text-stone-700">No statements yet</p>
        <p className="mt-1 text-sm text-stone-500">
          Days appear here after paper buys or sells fill.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-sm shadow-stone-900/5">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50/95 text-[10px] uppercase tracking-[0.08em] text-stone-500">
              <th className="w-10 px-3 py-3.5 sm:px-4" aria-label="Expand" />
              <th className="whitespace-nowrap px-3 py-3.5 font-semibold sm:px-4">
                Date
              </th>
              <th className="whitespace-nowrap px-3 py-3.5 font-semibold">Buy</th>
              <th className="whitespace-nowrap px-3 py-3.5 font-semibold">Sell</th>
              <th className="whitespace-nowrap px-3 py-3.5 font-semibold">P/L</th>
              <th className="whitespace-nowrap px-3 py-3.5 font-semibold">Cash</th>
              <th className="whitespace-nowrap px-3 py-3.5 font-semibold sm:px-4">
                Holdings ₹
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const bought = parseStockList(row.stocksBought);
              const sold = parseStockList(row.stocksSold);
              const holdings = parseStockList(row.holdings);
              const open = expandedDate === row.date;
              const hasDetail =
                bought.length > 0 || sold.length > 0 || holdings.length > 0;

              return (
                <StatementRowBlock
                  key={row.date}
                  row={row}
                  open={open}
                  hasDetail={hasDetail}
                  bought={bought}
                  sold={sold}
                  holdings={holdings}
                  onToggle={() =>
                    setExpandedDate((prev) =>
                      prev === row.date ? null : row.date,
                    )
                  }
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatementRowBlock({
  row,
  open,
  hasDetail,
  bought,
  sold,
  holdings,
  onToggle,
}: {
  row: StatementRow;
  open: boolean;
  hasDetail: boolean;
  bought: StockToken[];
  sold: StockToken[];
  holdings: StockToken[];
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className={[
          "border-b border-stone-100 last:border-0",
          open ? "bg-stone-50/80" : "hover:bg-stone-50/70",
          hasDetail ? "cursor-pointer" : "",
        ].join(" ")}
        onClick={hasDetail ? onToggle : undefined}
        onKeyDown={
          hasDetail
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggle();
                }
              }
            : undefined
        }
        tabIndex={hasDetail ? 0 : undefined}
        aria-expanded={hasDetail ? open : undefined}
      >
        <td className="px-3 py-3.5 sm:px-4">
          {hasDetail ? (
            <span
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-stone-400 ring-1 ring-inset ring-stone-200"
              aria-hidden
            >
              {open ? "▴" : "▾"}
            </span>
          ) : (
            <span className="inline-block w-6" aria-hidden />
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-3.5 font-semibold text-stone-900 sm:px-4">
          {row.date}
        </td>
        <td className="whitespace-nowrap px-3 py-3.5 tabular-nums text-stone-700">
          {formatInr(row.buyAmount)}
        </td>
        <td className="whitespace-nowrap px-3 py-3.5 tabular-nums text-stone-700">
          {formatInr(row.sellAmount)}
        </td>
        <td
          className={`whitespace-nowrap px-3 py-3.5 tabular-nums font-semibold ${pnlClass(row.profitLoss)}`}
        >
          {formatInr(row.profitLoss)}
        </td>
        <td className="whitespace-nowrap px-3 py-3.5 tabular-nums text-stone-700">
          {formatInr(row.cash)}
        </td>
        <td className="whitespace-nowrap px-3 py-3.5 tabular-nums text-stone-700 sm:px-4">
          {formatInr(row.holdingsValue)}
        </td>
      </tr>
      {open && hasDetail ? (
        <tr className="border-b border-stone-100 bg-stone-50/50 last:border-0">
          <td colSpan={7} className="px-4 py-3 sm:px-5">
            <div className="divide-y divide-stone-200/80 overflow-hidden rounded-xl border border-stone-200/90 bg-white">
              <DetailRow title="Bought" tokens={bought} tone="buy" empty="No buys" />
              <DetailRow title="Sold" tokens={sold} tone="sell" empty="No sells" />
              <DetailRow
                title="Holdings EOD"
                tokens={holdings}
                tone="hold"
                empty="Flat"
              />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function DetailRow({
  title,
  tokens,
  tone,
  empty,
}: {
  title: string;
  tokens: StockToken[];
  tone: "buy" | "sell" | "hold";
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-start sm:gap-4 sm:px-4">
      <p className="w-28 shrink-0 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">
        {title}
      </p>
      <div className="min-w-0 flex-1">
        {tokens.length === 0 ? (
          <p className="text-xs text-stone-400">{empty}</p>
        ) : (
          <StockChipList tokens={tokens} tone={tone} />
        )}
      </div>
    </div>
  );
}

function StockChipList({
  tokens,
  tone,
}: {
  tokens: StockToken[];
  tone: "buy" | "sell" | "hold";
}) {
  const shell =
    tone === "buy"
      ? "bg-sky-50/90 ring-sky-200/80"
      : tone === "sell"
        ? "bg-rose-50/80 ring-rose-200/80"
        : "bg-teal-50/70 ring-teal-200/70";

  const qtyTone =
    tone === "buy"
      ? "text-sky-800"
      : tone === "sell"
        ? "text-rose-800"
        : "text-teal-800";

  return (
    <ul className="flex list-none flex-wrap gap-2 p-0">
      {tokens.map((token) => (
        <li
          key={`${token.symbol}-${token.qty}-${token.isNew}-${token.buyPrice ?? ""}`}
        >
          <div
            className={[
              "inline-flex max-w-full flex-col gap-1 rounded-lg px-2 py-1.5 ring-1 ring-inset",
              shell,
              token.isNew ? "ring-teal-500/40" : "",
            ].join(" ")}
          >
            <div className="inline-flex items-center gap-1.5">
              <span
                className={`shrink-0 text-[11px] font-semibold tabular-nums ${qtyTone}`}
              >
                {token.qty}×
              </span>
              <span className="truncate text-[13px] font-semibold tracking-wide text-stone-900">
                {token.symbol}
              </span>
              {token.isNew ? (
                <span className="shrink-0 rounded-full bg-teal-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                  new
                </span>
              ) : null}
            </div>
            {tone === "buy" &&
            token.buyPrice != null &&
            token.stopLoss != null &&
            token.sellTarget != null ? (
              <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] tabular-nums text-stone-600">
                <span>
                  <span className="text-stone-400">Buy </span>
                  {formatPrice(token.buyPrice)}
                </span>
                <span>
                  <span className="text-rose-700/70">SL </span>
                  {formatPrice(token.stopLoss)}
                </span>
                <span>
                  <span className="text-teal-700/80">Tgt </span>
                  {formatPrice(token.sellTarget)}
                </span>
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
