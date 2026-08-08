"use client";

import { useMarketOpen } from "@/hooks/useMarketOpen";
import {
  addBuyableToRecommendation,
  createRecommendation,
  executeTrades,
  fetchExecutableRecommendation,
  fetchRecommendations,
  markRecommendationExecutable,
  updateRecommendation,
} from "@/lib/api";
import { formatInr, formatPrice } from "@/lib/format";
import { humanizeWatchReason } from "@/lib/humanize";
import type {
  BuyableShortlistRow,
  PipelineFunnel,
  RecommendationHistoryRun,
  RecommendationItem,
  RecommendationRun,
  RedShortlistRow,
  SetupRejectReason,
  WatchShortlistRow,
} from "@/lib/types";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

type Props = {
  accessToken?: string | null;
  onExecuted?: () => void;
};

const SESSION_LABEL = {
  OPEN: "Market open (NSE)",
  PRE_OPEN: "Pre-open",
  CLOSED: "Market closed",
} as const;

type EditableItem = RecommendationItem;

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

function computeRr(item: RecommendationItem): string {
  const entry = item.buyHigh;
  const risk = entry - item.stopLoss;
  const reward = item.sellTarget - entry;
  if (!(risk > 0) || !(reward > 0)) return "—";
  return (reward / risk).toFixed(2);
}

export function RecommendationsPanel({ accessToken, onExecuted }: Props) {
  const { open: marketOpen, session } = useMarketOpen();
  const [recommendation, setRecommendation] = useState<RecommendationRun | null>(
    null,
  );
  const [items, setItems] = useState<EditableItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [executeLoading, setExecuteLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executeMessage, setExecuteMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<RecommendationHistoryRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addingSymbol, setAddingSymbol] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [executableLoading, setExecutableLoading] = useState(false);

  const allocated = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.allocationInr) || 0), 0),
    [items],
  );
  const buyListSymbols = useMemo(
    () => new Set(items.map((i) => i.symbol.toUpperCase())),
    [items],
  );

  const isExecutable =
    (recommendation?.status ?? "").toUpperCase() === "EXECUTABLE";

  const canExecute =
    marketOpen &&
    isExecutable &&
    Boolean(recommendation?.id) &&
    items.length > 0 &&
    !recommendLoading;

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const rows = await fetchRecommendations(accessToken, 50);
      setHistory(rows);
    } catch {
      // Keep prior history visible if refresh fails.
    } finally {
      setHistoryLoading(false);
    }
  }, [accessToken]);

  const loadExecutable = useCallback(async () => {
    setExecutableLoading(true);
    try {
      const run = await fetchExecutableRecommendation(accessToken);
      if (run?.id) {
        setRecommendation(run);
        setItems(run.items.map((item) => ({ ...item })));
        setDirty(false);
      } else {
        setRecommendation(null);
        setItems([]);
        setDirty(false);
      }
    } catch {
      // Leave panel empty if executable fetch fails.
    } finally {
      setExecutableLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadHistory();
    void loadExecutable();
  }, [loadHistory, loadExecutable]);

  async function onRecommend() {
    setError(null);
    setExecuteMessage(null);
    setRecommendLoading(true);
    try {
      const run = await createRecommendation(accessToken);
      setRecommendation(run);
      setItems(run.items.map((item) => ({ ...item })));
      setDirty(false);
      await loadHistory();
    } catch (err) {
      setRecommendation(null);
      setItems([]);
      setDirty(false);
      setError(err instanceof Error ? err.message : "Recommendation failed");
    } finally {
      setRecommendLoading(false);
    }
  }

  async function onMarkExecutable(runId: string) {
    setError(null);
    setExecuteMessage(null);
    setMarkingId(runId);
    try {
      const run = await markRecommendationExecutable(runId, accessToken);
      setRecommendation(run);
      setItems(run.items.map((item) => ({ ...item })));
      setDirty(false);
      setExecuteMessage("This plan is now the Executable plan — customize and execute below.");
      await loadHistory();
      // Scroll attention to the customize panel.
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not mark plan as Executable",
      );
    } finally {
      setMarkingId(null);
    }
  }

  function patchItem(
    id: string,
    field: "qty" | "buyLow" | "buyHigh" | "sellTarget" | "stopLoss",
    raw: string,
  ) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          return item;
        }
        const next = { ...item };
        if (field === "qty") {
          next.qty = Math.max(1, Math.floor(n));
        } else {
          next[field] = n;
        }
        // Allocation is always derived from qty × buy-high (worst-case fill).
        if (next.buyHigh > 0) {
          next.allocationInr =
            Math.round(next.qty * next.buyHigh * 100) / 100;
        }
        return next;
      }),
    );
    setDirty(true);
    setExecuteMessage(null);
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setDirty(true);
    setExecuteMessage(null);
  }

  async function onAddBuyable(symbol: string) {
    if (!recommendation?.id) return;
    setError(null);
    setExecuteMessage(null);
    setAddingSymbol(symbol);
    try {
      // Persist removals/edits first so server totals stay consistent.
      if (dirty) {
        await persistEdits();
      }
      const saved = await addBuyableToRecommendation(
        recommendation.id,
        symbol,
        accessToken,
      );
      setRecommendation((prev) =>
        prev
          ? {
              ...prev,
              ...saved,
              // Keep screening lists from the original create response.
              buyableShortlist: prev.buyableShortlist,
              watchShortlist: prev.watchShortlist,
              redShortlist: prev.redShortlist,
              watchReasons: prev.watchReasons,
              redReasons: prev.redReasons,
              buyableCount: prev.buyableCount,
              watchCount: prev.watchCount,
              redCount: prev.redCount,
              shortlistedCount: prev.shortlistedCount,
              pipelineFunnel: prev.pipelineFunnel,
              rejectedCandidates: prev.rejectedCandidates,
            }
          : saved,
      );
      setItems(saved.items.map((item) => ({ ...item })));
      setDirty(false);
      setExecuteMessage(`${symbol} added to the buy list.`);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not add ${symbol}`);
    } finally {
      setAddingSymbol(null);
    }
  }

  async function persistEdits(): Promise<RecommendationRun | null> {
    if (!recommendation?.id) return null;
    if (!dirty) return recommendation;

    const saved = await updateRecommendation(
      recommendation.id,
      items.map((item) => ({
        id: item.id,
        qty: Math.max(1, Math.floor(Number(item.qty))),
        allocationInr: Number(item.allocationInr),
        buyLow: Number(item.buyLow),
        buyHigh: Number(item.buyHigh),
        sellTarget: Number(item.sellTarget),
        stopLoss: Number(item.stopLoss),
      })),
      accessToken,
    );
    setRecommendation({ ...recommendation, ...saved, items: saved.items });
    setItems(saved.items.map((item) => ({ ...item })));
    setDirty(false);
    await loadHistory();
    return { ...recommendation, ...saved, items: saved.items };
  }

  async function onExecute() {
    if (!recommendation?.id) return;
    setError(null);
    setExecuteMessage(null);
    setExecuteLoading(true);
    try {
      const plan = await persistEdits();
      if (!plan?.id) return;
      const result = await executeTrades(plan.id, accessToken);
      setExecuteMessage(
        `Session ${result.status}: ${result.waitingBuyCount} waiting buy` +
          (result.addOnSymbols.length
            ? ` · add-ons ${result.addOnSymbols.join(", ")}`
            : ""),
      );
      setRecommendation((prev) =>
        prev ? { ...prev, status: "EXECUTING" } : prev,
      );
      await loadHistory();
      onExecuted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Execute failed");
    } finally {
      setExecuteLoading(false);
    }
  }

  const executeTitle = !marketOpen
    ? "Execute is only available while the NSE market is open (09:15–15:30 IST)"
    : !recommendation || !isExecutable
      ? "Mark a today's plan as Executable, or run Get recommendations"
      : items.length === 0
        ? "Plan has no picks to execute"
        : dirty
          ? "Save your edits and start paper execution"
          : "Start paper execution for this plan";

  return (
    <div className="space-y-8">
      <div className="flex justify-center">
        <p
          className={[
            "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
            marketOpen
              ? "bg-teal-100 text-teal-900"
              : "bg-stone-200/80 text-stone-700",
          ].join(" ")}
        >
          {SESSION_LABEL[session]}
        </p>
      </div>

      <section className="mx-auto max-w-3xl rounded-xl border border-teal-300/80 bg-gradient-to-b from-teal-50/90 via-white to-stone-50/60 p-5 shadow-sm sm:p-6">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-stone-900">
            Executable recommendation
          </h2>
          <p className="mx-auto mt-1 max-w-xl text-sm text-stone-600">
            Generate a plan, or mark one of today&apos;s pending plans as
            Executable. Only the Executable plan can be customized and executed.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onRecommend}
            disabled={
              recommendLoading || executeLoading || markingId != null
            }
            className="rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-900 disabled:opacity-60"
          >
            {recommendLoading
              ? "Getting recommendations…"
              : "Get recommendations"}
          </button>
          <button
            type="button"
            onClick={onExecute}
            disabled={!canExecute || executeLoading}
            title={executeTitle}
            className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {executeLoading
              ? dirty
                ? "Saving & executing…"
                : "Starting execute…"
              : dirty
                ? "Save & execute"
                : "Execute trade"}
          </button>
        </div>

        {error ? (
          <p
            className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-center text-sm text-rose-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {executeMessage ? (
          <p
            className="mt-4 rounded-md bg-teal-50 px-3 py-2 text-center text-sm text-teal-900"
            role="status"
          >
            {executeMessage}
          </p>
        ) : null}

        {recommendation && isExecutable ? (
          <div className="mt-6 space-y-3">
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2.5">
                <StatusBadge status={recommendation.status} />
                <Badge tone="executable">Executable Plan</Badge>
                <AiConfidencePair confidence={recommendation.confidence} />
                {recommendation.marketRegime ? (
                  <LabelledBadge
                    label="Market"
                    value={humanizeRegime(recommendation.marketRegime)}
                    tone="market"
                  />
                ) : null}
                {recommendation.portfolioStrategy?.style ? (
                  <LabelledBadge
                    label="Style"
                    value={humanizeStyle(recommendation.portfolioStrategy.style)}
                    tone="style"
                  />
                ) : null}
                {dirty ? <Badge tone="amber">Unsaved edits</Badge> : null}
              </div>

            <RecommendationResultCard
              recommendation={recommendation}
              itemCount={items.length}
              allocated={allocated}
              dirty={dirty}
              buyListSymbols={buyListSymbols}
              addingSymbol={addingSymbol}
              onAddBuyable={onAddBuyable}
              addDisabled={
                executeLoading ||
                recommendLoading ||
                markingId != null ||
                items.length >= 5
              }
            />

            {items.length > 0 ? (
              <>
                <p className="text-sm text-stone-600">
                  Adjust quantity, buy range, target, or stop. Allocation is
                  calculated as qty × buy high. Remove a stock you don&apos;t
                  want. Changes apply when you click Execute trade.
                  {dirty ? (
                    <span className="ml-1 font-medium text-amber-800">
                      You have unsaved edits.
                    </span>
                  ) : null}
                </p>
                <EditablePlanTable
                  items={items}
                  executeLoading={executeLoading || addingSymbol != null}
                  onPatch={patchItem}
                  onRemove={removeItem}
                />
              </>
            ) : (
              <p className="text-sm text-stone-600">
                No stocks on the buy list yet. Add any Buyable name below, or
                generate a new plan.
              </p>
            )}

            {(recommendation.rejectedCandidates?.length ?? 0) > 0 &&
            items.length > 0 ? (
              <details className="rounded-xl border border-stone-200 bg-white/80 p-4 text-sm shadow-sm">
                <summary className="cursor-pointer font-medium text-stone-800">
                  Names considered but not kept (
                  {recommendation.rejectedCandidates.length})
                </summary>
                <ul className="mt-2 space-y-1 text-stone-600">
                  {recommendation.rejectedCandidates.map((r) => (
                    <li key={`${r.symbol}-${r.reason}`}>
                      <span className="font-medium text-stone-800">
                        {r.symbol}
                      </span>
                      {" — "}
                      {r.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : recommendation && !isExecutable ? (
          <p className="mt-5 text-center text-sm text-stone-600">
            This plan is no longer customizable (status{" "}
            {recommendation.status}). Mark another today&apos;s pending plan as
            Executable, or generate a new one.
          </p>
        ) : executableLoading ? (
          <p className="mt-5 text-center text-sm text-stone-500">
            Loading Executable plan…
          </p>
        ) : (
          <p className="mt-5 text-center text-sm text-stone-500">
            No Executable plan yet. Tap Get recommendations, or mark one of
            today&apos;s pending plans below as Executable.
          </p>
        )}
      </section>

      <section className="mx-auto max-w-4xl space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-stone-900">
            Past recommendations
          </h2>
          {historyLoading ? (
            <p className="text-xs text-stone-500">Refreshing…</p>
          ) : null}
        </div>

        {history.length === 0 && !historyLoading ? (
          <p className="rounded-xl border border-stone-200 bg-white/80 px-4 py-6 text-center text-sm text-stone-500">
            No past recommendations yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {history.map((run) => {
              const open = expandedId === run.id;
              const boughtYes = Boolean(
                run.bought ||
                  (run.boughtLabel ?? "").toLowerCase() === "yes",
              );
              const pickCount = run.items.length;
              const isExecutablePlan =
                Boolean(run.isExecutablePlan) ||
                run.status.toUpperCase() === "EXECUTABLE";

              return (
                <li
                  key={run.id}
                  className={[
                    "overflow-hidden rounded-2xl border bg-white shadow-sm transition",
                    open
                      ? "border-teal-200/80 shadow-md shadow-teal-900/5"
                      : "border-stone-200/90 hover:border-stone-300 hover:shadow-md",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId((prev) => (prev === run.id ? null : run.id))
                    }
                    className="flex w-full flex-col gap-3 px-4 py-3.5 text-left sm:px-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold tabular-nums tracking-tight text-stone-900">
                          {formatIst(run.createdAt || run.marketTs)}
                        </p>
                        <p className="mt-0.5 text-xs text-stone-500">
                          {pickCount === 0
                            ? "Cash sit-out · no picks"
                            : `${pickCount} pick${pickCount === 1 ? "" : "s"} · ${formatInr(run.totalAllocatedInr)} planned`}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-stone-400">
                        {open ? "Collapse" : "Expand"}
                        <span aria-hidden>{open ? "▴" : "▾"}</span>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
                      <StatusBadge status={run.status} />
                      {isExecutablePlan ? (
                        <Badge tone="executable">Executable Plan</Badge>
                      ) : null}
                      <AiConfidencePair confidence={run.confidence} />
                      <LabelledBadge
                        label="Bought"
                        value={boughtYes ? "Yes" : "No"}
                        tone={boughtYes ? "yes" : "no"}
                      />
                      {run.marketRegime ? (
                        <LabelledBadge
                          label="Market"
                          value={humanizeRegime(run.marketRegime)}
                          tone="market"
                        />
                      ) : null}
                      {run.portfolioStrategy?.style ? (
                        <LabelledBadge
                          label="Style"
                          value={humanizeStyle(run.portfolioStrategy.style)}
                          tone="style"
                        />
                      ) : null}
                    </div>

                    {pickCount > 0 ? (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-stone-100/90 pt-2.5">
                        <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-400">
                          Stocks
                        </span>
                        {run.items.slice(0, 8).map((item) => (
                          <span
                            key={item.id}
                            className="inline-flex items-baseline gap-1 rounded-md bg-teal-50/70 px-2 py-0.5 text-[11px] font-semibold text-teal-950"
                          >
                            <span className="tabular-nums font-medium text-teal-700/70">
                              {item.qty}×
                            </span>
                            {item.symbol}
                          </span>
                        ))}
                        {pickCount > 8 ? (
                          <span className="text-[11px] font-medium text-stone-400">
                            +{pickCount - 8} more
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </button>

                  {run.canMarkExecutable ? (
                    <div className="border-t border-stone-100 px-4 py-2.5 sm:px-5">
                      <button
                        type="button"
                        onClick={() => void onMarkExecutable(run.id)}
                        disabled={
                          markingId != null ||
                          recommendLoading ||
                          executeLoading
                        }
                        className="rounded-lg bg-teal-800 px-3 py-2 text-xs font-semibold text-white transition hover:bg-teal-900 disabled:opacity-60"
                      >
                        {markingId === run.id
                          ? "Marking…"
                          : "Mark as Executable Plan"}
                      </button>
                      <p className="mt-1.5 text-[11px] text-stone-500">
                        Makes this the only plan you can customize and execute.
                      </p>
                    </div>
                  ) : null}

                  {open ? (
                    <div className="space-y-4 border-t border-stone-100 bg-gradient-to-b from-stone-50/80 to-white px-4 py-4 sm:px-5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
                        <StatusBadge status={run.status} />
                        {isExecutablePlan ? (
                          <Badge tone="executable">Executable Plan</Badge>
                        ) : null}
                        <AiConfidencePair confidence={run.confidence} />
                        <LabelledBadge
                          label="Bought"
                          value={boughtYes ? "Yes" : "No"}
                          tone={boughtYes ? "yes" : "no"}
                        />
                        {run.marketRegime ? (
                          <LabelledBadge
                            label="Market"
                            value={humanizeRegime(run.marketRegime)}
                            tone="market"
                          />
                        ) : null}
                        {run.portfolioStrategy?.style ? (
                          <LabelledBadge
                            label="Style"
                            value={humanizeStyle(run.portfolioStrategy.style)}
                            tone="style"
                          />
                        ) : null}
                      </div>

                      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <Metric
                          label="Allocated"
                          value={formatInr(run.totalAllocatedInr)}
                          hint="Planned investment in this plan"
                        />
                        <Metric
                          label="Cash available then"
                          value={formatInr(run.availableCash)}
                          hint="Free cash when the plan was built"
                        />
                        <Metric
                          label="Picks"
                          value={String(pickCount)}
                          hint={
                            run.portfolioStrategy
                              ? `Target ${run.portfolioStrategy.targetPositions} · reserve ${run.portfolioStrategy.cashReservePercent}%`
                              : "Stocks in the portfolio"
                          }
                        />
                      </dl>

                      {run.portfolioStrategy?.reason ? (
                        <div className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-stone-200/80">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                            Strategy note
                          </p>
                          <p className="mt-1 text-sm text-stone-700">
                            {run.portfolioStrategy.reason}
                          </p>
                        </div>
                      ) : null}

                      {run.portfolioSummary &&
                      !isJargonSummary(run.portfolioSummary) ? (
                        <div className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-stone-200/80">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                            Plan summary
                          </p>
                          <p className="mt-1 text-sm text-stone-700">
                            {run.portfolioSummary}
                          </p>
                        </div>
                      ) : null}

                      {run.items.length > 0 ? (
                        <div className="overflow-hidden rounded-xl ring-1 ring-stone-200/90">
                          <table className="min-w-full text-left text-xs">
                            <thead className="bg-stone-100/90 text-[10px] uppercase tracking-wide text-stone-500">
                              <tr>
                                <th className="px-3 py-2.5 font-semibold">
                                  Rank
                                </th>
                                <th className="px-3 py-2.5 font-semibold">
                                  Symbol
                                </th>
                                <th className="px-3 py-2.5 font-semibold">
                                  Alloc
                                </th>
                                <th className="px-3 py-2.5 font-semibold">
                                  Buy band
                                </th>
                                <th className="px-3 py-2.5 font-semibold">
                                  Target
                                </th>
                                <th className="px-3 py-2.5 font-semibold">
                                  Stop
                                </th>
                                <th className="px-3 py-2.5 font-semibold">RR</th>
                                <th className="px-3 py-2.5 font-semibold">
                                  Why in portfolio
                                </th>
                              </tr>
                            </thead>
                            <tbody className="bg-white">
                              {run.items.map((item) => (
                                <tr
                                  key={item.id}
                                  className="border-t border-stone-100 align-top"
                                >
                                  <td className="px-3 py-2.5">
                                    <Badge tone="slate">
                                      #{item.convictionRank}
                                    </Badge>
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <p className="font-semibold text-stone-900">
                                      {item.symbol}
                                    </p>
                                    <p className="mt-0.5 text-[10px] uppercase tracking-wide text-stone-400">
                                      {item.role}
                                    </p>
                                  </td>
                                  <td className="px-3 py-2.5 tabular-nums text-stone-700">
                                    {formatInr(item.allocationInr)}
                                    <p className="text-[10px] text-stone-400">
                                      qty {item.qty}
                                    </p>
                                  </td>
                                  <td className="px-3 py-2.5 tabular-nums text-stone-700">
                                    {formatPrice(item.buyLow)}–
                                    {formatPrice(item.buyHigh)}
                                  </td>
                                  <td className="px-3 py-2.5 tabular-nums text-teal-800">
                                    {formatPrice(item.sellTarget)}
                                  </td>
                                  <td className="px-3 py-2.5 tabular-nums text-rose-800/80">
                                    {formatPrice(item.stopLoss)}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <Badge tone="teal">
                                      {computeRr(item)}
                                      {computeRr(item) !== "—" ? ":1" : ""}
                                    </Badge>
                                  </td>
                                  <td className="max-w-xs px-3 py-2.5 leading-relaxed text-stone-600">
                                    {item.summary || "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="rounded-xl bg-amber-50/90 px-3 py-2.5 text-sm text-amber-950 ring-1 ring-amber-200/80">
                          No stocks in this plan — intentional cash day.
                        </p>
                      )}
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

function humanizeRegime(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeStyle(raw: string): string {
  const s = raw.toUpperCase();
  if (s === "AGGRESSIVE") return "Aggressive";
  if (s === "BALANCED") return "Balanced";
  if (s === "DEFENSIVE") return "Defensive";
  return humanizeRegime(raw);
}

function confidenceTone(
  confidence: string | null | undefined,
): "high" | "medium" | "low" | "slate" {
  const c = (confidence ?? "").toUpperCase();
  if (c === "HIGH") return "high";
  if (c === "MEDIUM") return "medium";
  if (c === "LOW") return "low";
  return "slate";
}

function statusTone(
  status: string,
):
  | "pending"
  | "executable"
  | "executing"
  | "completed"
  | "superseded"
  | "slate" {
  const s = status.toUpperCase();
  if (s === "PENDING") return "pending";
  if (s === "EXECUTABLE") return "executable";
  if (s === "EXECUTING") return "executing";
  if (s === "COMPLETED") return "completed";
  if (s === "SUPERSEDED") return "superseded";
  return "slate";
}

function statusLabel(status: string): string {
  const s = status.toUpperCase();
  if (s === "EXECUTABLE") return "EXECUTABLE";
  return status;
}

function AiConfidencePair({
  confidence,
}: {
  confidence: string | null | undefined;
}) {
  const label = (confidence ?? "—").toUpperCase();
  return (
    <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-stone-50/90 py-0.5 pl-2.5 pr-0.5 ring-1 ring-inset ring-stone-200/70">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">
        AI
      </span>
      <Badge tone={confidenceTone(confidence)}>{label}</Badge>
    </span>
  );
}

function LabelledBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "yes" | "no" | "slate" | "market" | "style";
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-stone-50/90 py-0.5 pl-2.5 pr-0.5 ring-1 ring-inset ring-stone-200/70">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </span>
      <Badge tone={tone}>{value}</Badge>
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex shrink-0">
      <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>
    </span>
  );
}

function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?:
    | "slate"
    | "teal"
    | "amber"
    | "high"
    | "medium"
    | "low"
    | "yes"
    | "no"
    | "pending"
    | "executable"
    | "executing"
    | "completed"
    | "superseded"
    | "market"
    | "style";
}) {
  const tones: Record<string, string> = {
    slate: "bg-stone-100 text-stone-700 ring-stone-200/80",
    teal: "bg-teal-50 text-teal-900 ring-teal-200/80",
    amber: "bg-amber-50 text-amber-950 ring-amber-200/80",
    high: "bg-emerald-100 text-emerald-900 ring-emerald-300/70",
    medium: "bg-amber-100 text-amber-950 ring-amber-300/70",
    low: "bg-rose-100 text-rose-900 ring-rose-300/70",
    yes: "bg-emerald-100 text-emerald-900 ring-emerald-300/70",
    no: "bg-stone-100 text-stone-600 ring-stone-200/80",
    pending: "bg-sky-50 text-sky-900 ring-sky-200/80",
    executable: "bg-teal-100 text-teal-950 ring-teal-300/80",
    executing: "bg-violet-50 text-violet-900 ring-violet-200/80",
    completed: "bg-emerald-50 text-emerald-900 ring-emerald-200/80",
    superseded: "bg-stone-200/80 text-stone-600 ring-stone-300/70",
    market: "bg-indigo-50 text-indigo-900 ring-indigo-200/80",
    style: "bg-cyan-50 text-cyan-950 ring-cyan-200/80",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function EditablePlanTable({
  items,
  executeLoading,
  onPatch,
  onRemove,
}: {
  items: EditableItem[];
  executeLoading: boolean;
  onPatch: (
    id: string,
    field: "qty" | "buyLow" | "buyHigh" | "sellTarget" | "stopLoss",
    raw: string,
  ) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white/80 shadow-sm">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-stone-200 bg-stone-50/90 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-3 font-medium">Rank</th>
            <th className="px-3 py-3 font-medium">Symbol</th>
            <th className="px-3 py-3 font-medium">Role</th>
            <th className="px-3 py-3 font-medium">Qty</th>
            <th className="px-3 py-3 font-medium">Allocation</th>
            <th className="px-3 py-3 font-medium">Buy low</th>
            <th className="px-3 py-3 font-medium">Buy high</th>
            <th className="px-3 py-3 font-medium">Target</th>
            <th className="px-3 py-3 font-medium">Stop</th>
            <th className="px-3 py-3 font-medium" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className="border-b border-stone-100 last:border-0"
            >
              <td className="px-3 py-2 tabular-nums text-stone-700">
                {item.convictionRank}
              </td>
              <td className="px-3 py-2 font-medium text-stone-900">
                {item.symbol}
              </td>
              <td className="px-3 py-2 text-stone-700">{item.role}</td>
              <td className="px-3 py-2">
                <NumInput
                  value={item.qty}
                  step={1}
                  onChange={(v) => onPatch(item.id, "qty", v)}
                />
              </td>
              <td className="px-3 py-2 tabular-nums text-stone-700">
                <span className="block min-w-[6.5rem] px-2 py-1.5">
                  {formatInr(item.allocationInr)}
                </span>
                <span className="block px-2 text-[10px] text-stone-400">
                  qty × buy high
                </span>
              </td>
              <td className="px-3 py-2">
                <NumInput
                  value={item.buyLow}
                  step={0.05}
                  onChange={(v) => onPatch(item.id, "buyLow", v)}
                />
              </td>
              <td className="px-3 py-2">
                <NumInput
                  value={item.buyHigh}
                  step={0.05}
                  onChange={(v) => onPatch(item.id, "buyHigh", v)}
                />
              </td>
              <td className="px-3 py-2">
                <NumInput
                  value={item.sellTarget}
                  step={0.05}
                  onChange={(v) => onPatch(item.id, "sellTarget", v)}
                />
              </td>
              <td className="px-3 py-2">
                <NumInput
                  value={item.stopLoss}
                  step={0.05}
                  onChange={(v) => onPatch(item.id, "stopLoss", v)}
                />
              </td>
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  disabled={executeLoading}
                  className="text-xs font-semibold text-rose-800 hover:text-rose-950 disabled:opacity-40"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecommendationResultCard({
  recommendation,
  itemCount,
  allocated,
  dirty,
  buyListSymbols,
  addingSymbol,
  onAddBuyable,
  addDisabled,
}: {
  recommendation: RecommendationRun;
  itemCount: number;
  allocated: number;
  dirty: boolean;
  buyListSymbols: Set<string>;
  addingSymbol: string | null;
  onAddBuyable: (symbol: string) => void;
  addDisabled: boolean;
}) {
  const cash = recommendation.availableCash;
  const leftover = Math.max(0, cash - allocated);
  const minDeploy = recommendation.minDeployCashInr ?? 2500;
  const lowCash =
    recommendation.skipNewBuysReason === "LOW_CASH" || cash < minDeploy;
  const explanation = explainEmptyPlan(recommendation, itemCount, minDeploy);
  const hasPicks = itemCount > 0;

  return (
    <div className="rounded-xl border border-stone-200 bg-white/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-stone-900">
            {hasPicks ? "Suggested buys for today" : "No new buys today"}
          </p>
          {dirty && hasPicks ? (
            <p className="mt-1 text-xs font-medium text-amber-800">
              Edited — will save on Execute trade
            </p>
          ) : null}
        </div>
      </div>

      {hasPicks ? (
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric
            label="Cash available"
            value={formatInr(cash)}
            hint="Free cash before these buys"
          />
          <Metric
            label="Planned investment"
            value={formatInr(allocated)}
            hint={`${itemCount} stock${itemCount === 1 ? "" : "s"} in the table below`}
          />
          <Metric
            label="Cash after buys"
            value={formatInr(leftover)}
            hint="Estimated cash left if the plan fills"
          />
        </dl>
      ) : (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <Metric
            label="Cash available"
            value={formatInr(cash)}
            hint="Free cash right now"
          />
          <Metric
            label="Minimum to suggest buys"
            value={formatInr(minDeploy)}
            hint={
              lowCash
                ? `Need about ${formatInr(Math.max(0, minDeploy - cash))} more free cash`
                : "Threshold for new AI buy ideas"
            }
          />
        </dl>
      )}

      {!hasPicks ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-3 text-sm text-amber-950">
          <p className="font-semibold">{explanation.title}</p>
          <p className="mt-1 text-amber-900/90">{explanation.body}</p>
        </div>
      ) : recommendation.portfolioSummary &&
        !isJargonSummary(recommendation.portfolioSummary) ? (
        <p className="mt-4 text-sm text-stone-600">
          {recommendation.portfolioSummary}
        </p>
      ) : null}

      {recommendation.pipelineFunnel ? (
        <ScreeningSummary
          funnel={recommendation.pipelineFunnel}
          hasPicks={hasPicks}
          lowCash={lowCash}
          shortlistedCount={recommendation.shortlistedCount}
          buyableCount={recommendation.buyableCount}
          watchCount={recommendation.watchCount}
          redCount={recommendation.redCount}
          buyableBlockedReason={recommendation.buyableBlockedReason}
          redShortlist={recommendation.redShortlist ?? []}
          redReasons={recommendation.redReasons ?? []}
        />
      ) : null}

      {(recommendation.buyableCount ??
        recommendation.buyableShortlist?.length ??
        0) > 0 ? (
        <BuyableShortlistPanel
          buyableCount={
            recommendation.buyableCount ??
            recommendation.buyableShortlist?.length ??
            0
          }
          buyableShortlist={recommendation.buyableShortlist ?? []}
          buyableBlockedReason={recommendation.buyableBlockedReason}
          lowCash={lowCash}
          buyListSymbols={buyListSymbols}
          addingSymbol={addingSymbol}
          onAddBuyable={onAddBuyable}
          addDisabled={addDisabled}
        />
      ) : null}

      {(recommendation.watchCount ??
        recommendation.watchShortlist?.length ??
        0) > 0 ? (
        <WatchShortlistPanel
          watchCount={
            recommendation.watchCount ??
            recommendation.watchShortlist?.length ??
            0
          }
          watchShortlist={recommendation.watchShortlist ?? []}
          watchReasons={recommendation.watchReasons ?? []}
        />
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg bg-stone-50 px-3 py-2">
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
        {label}
      </dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-stone-900">
        {value}
      </dd>
      <p className="mt-0.5 text-xs text-stone-500">{hint}</p>
    </div>
  );
}

function ScreeningSummary({
  funnel,
  hasPicks,
  lowCash,
  shortlistedCount,
  buyableCount,
  watchCount,
  redCount,
  buyableBlockedReason,
  redShortlist,
  redReasons,
}: {
  funnel: PipelineFunnel;
  hasPicks: boolean;
  lowCash: boolean;
  shortlistedCount?: number;
  buyableCount?: number;
  watchCount?: number;
  redCount?: number;
  buyableBlockedReason?: "LOW_CASH" | "NO_BUYABLE_SETUPS" | null;
  redShortlist: RedShortlistRow[];
  redReasons: SetupRejectReason[];
}) {
  const shortlisted = shortlistedCount ?? funnel.prioritized ?? 0;
  const buyable = buyableCount ?? funnel.featureReady ?? 0;
  const watch = watchCount ?? 0;
  const red = redCount ?? redShortlist.length;
  const conclusion = screeningConclusion({
    funnel,
    hasPicks,
    lowCash,
    shortlisted,
    buyable,
    watch,
    buyableBlockedReason,
  });

  return (
    <details className="mt-4 rounded-lg border border-stone-200 bg-stone-50/80 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-stone-800">
        How we screened the market
      </summary>
      <p className="mt-2 text-stone-700">{conclusion}</p>
      <p className="mt-1 text-xs text-stone-500">
        Strong stock ≠ automatically buyable. Only Buyable names can go on the
        buy list.
      </p>

      <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-stone-700">
        <li>
          Liquid names scanned:{" "}
          {(funnel.liquidEligible ?? funnel.quotesOk).toLocaleString("en-IN")}
        </li>
        <li>
          Research Top shortlist: {shortlisted.toLocaleString("en-IN")}
        </li>
        <li>
          Trade-plan status — Buyable {buyable.toLocaleString("en-IN")} · Watch{" "}
          {watch.toLocaleString("en-IN")} · Red {red.toLocaleString("en-IN")}
        </li>
        <li>
          AI pick among Buyable only:{" "}
          {lowCash || buyableBlockedReason === "LOW_CASH"
            ? "skipped (not enough free cash)"
            : hasPicks
              ? `${funnel.validatorAccepted ?? itemsFallback(funnel)} kept for you`
              : buyable === 0
                ? "nothing buyable today"
                : "no picks kept (zero-trade day is valid)"}
        </li>
      </ol>

      {red > 0 ? (
        <details className="mt-3 rounded-md border border-stone-200 bg-white px-3 py-2">
          <summary className="cursor-pointer font-medium text-stone-800">
            Could not evaluate ({red.toLocaleString("en-IN")}) — technical
          </summary>
          {redReasons.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-stone-700">
              {redReasons.map((row) => (
                <li key={row.reason} className="flex justify-between gap-3">
                  <span>{humanizeWatchReason(row.reason, row.reason)}</span>
                  <span className="shrink-0 tabular-nums text-stone-500">
                    {row.count}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {redShortlist.length > 0 ? (
            <div className="mt-2 max-h-48 overflow-auto rounded border border-stone-200">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 bg-stone-100 text-stone-500">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Symbol</th>
                    <th className="px-2 py-1.5 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {redShortlist.map((row) => (
                    <tr
                      key={`${row.symbol}-${row.reason}`}
                      className="border-t border-stone-100"
                    >
                      <td className="px-2 py-1 font-medium text-stone-900">
                        {row.symbol}
                      </td>
                      <td className="px-2 py-1 text-stone-600">
                        {humanizeWatchReason(row.reasonCode, row.reason)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </details>
      ) : null}
    </details>
  );
}

function BuyableShortlistPanel({
  buyableCount,
  buyableShortlist,
  buyableBlockedReason,
  lowCash,
  buyListSymbols,
  addingSymbol,
  onAddBuyable,
  addDisabled,
}: {
  buyableCount: number;
  buyableShortlist: BuyableShortlistRow[];
  buyableBlockedReason?: "LOW_CASH" | "NO_BUYABLE_SETUPS" | null;
  lowCash: boolean;
  buyListSymbols: Set<string>;
  addingSymbol: string | null;
  onAddBuyable: (symbol: string) => void;
  addDisabled: boolean;
}) {
  return (
    <details className="mt-3 rounded-lg border border-teal-200 bg-teal-50/80 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-teal-950">
        Buyable ({buyableCount.toLocaleString("en-IN")})
      </summary>
      <p className="mt-2 text-xs text-teal-900/80">
        {buyableBlockedReason === "LOW_CASH" || lowCash
          ? "Defensible trade plans exist, but AI was not asked because free cash is below the minimum for new buys."
          : "Tradable now with a structural plan. AI may pick some; you can also Add to list."}
      </p>
      {buyableShortlist.length > 0 ? (
        <div className="mt-2 max-h-72 overflow-auto rounded border border-teal-200 bg-white">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-teal-50 text-teal-900/70">
              <tr>
                <th className="px-2 py-1.5 font-medium">Symbol</th>
                <th className="px-2 py-1.5 font-medium">Buy band</th>
                <th className="px-2 py-1.5 font-medium">Target</th>
                <th className="px-2 py-1.5 font-medium">Stop</th>
                <th className="px-2 py-1.5 font-medium">R:R</th>
                <th className="px-2 py-1.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {buyableShortlist.map((row) => {
                const onList = buyListSymbols.has(row.symbol.toUpperCase());
                const busy = addingSymbol === row.symbol;
                const canAdd =
                  !onList &&
                  !addDisabled &&
                  row.buyLow != null &&
                  row.buyHigh != null &&
                  row.sellTarget != null &&
                  row.stopLoss != null;
                return (
                  <tr key={row.symbol} className="border-t border-stone-100">
                    <td className="px-2 py-1 font-medium text-stone-900">
                      {row.symbol}
                    </td>
                    <td className="px-2 py-1 tabular-nums text-stone-600">
                      {row.buyLow != null && row.buyHigh != null
                        ? `${formatPrice(row.buyLow)}–${formatPrice(row.buyHigh)}`
                        : "—"}
                    </td>
                    <td className="px-2 py-1 tabular-nums text-stone-600">
                      {row.sellTarget != null
                        ? formatPrice(row.sellTarget)
                        : "—"}
                    </td>
                    <td className="px-2 py-1 tabular-nums text-stone-600">
                      {row.stopLoss != null ? formatPrice(row.stopLoss) : "—"}
                    </td>
                    <td className="px-2 py-1 tabular-nums text-stone-600">
                      {row.riskReward != null
                        ? row.riskReward.toFixed(2)
                        : "—"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {onList ? (
                        <span className="text-[11px] font-medium text-teal-800">
                          On list
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={!canAdd || busy}
                          onClick={() => onAddBuyable(row.symbol)}
                          className="rounded-md bg-teal-800 px-2 py-1 text-[11px] font-semibold text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {busy ? "Adding…" : "Add to list"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </details>
  );
}

function WatchShortlistPanel({
  watchCount,
  watchShortlist,
  watchReasons,
}: {
  watchCount: number;
  watchShortlist: WatchShortlistRow[];
  watchReasons: SetupRejectReason[];
}) {
  return (
    <details className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-amber-950">
        Watch ({watchCount.toLocaleString("en-IN")}) — info only, not buys
      </summary>
      <p className="mt-2 text-xs text-amber-900/80">
        These made the research Top list but are not attractive to buy at
        today&apos;s price (for example extended, stop too wide, or target too
        close). Shown so you can see why they were skipped — there is no buy
        action here on purpose.
      </p>
      {watchReasons.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-amber-950/90">
          {watchReasons.map((row) => (
            <li key={row.reason} className="flex justify-between gap-3">
              <span>{humanizeWatchReason(row.reason, row.reason)}</span>
              <span className="shrink-0 tabular-nums text-amber-800/70">
                {row.count}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {watchShortlist.length > 0 ? (
        <div className="mt-2 max-h-64 overflow-auto rounded border border-amber-200 bg-white">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-amber-50 text-amber-900/70">
              <tr>
                <th className="px-2 py-1.5 font-medium">Symbol</th>
                <th className="px-2 py-1.5 font-medium">Why watch</th>
              </tr>
            </thead>
            <tbody>
              {watchShortlist.map((row) => (
                <tr
                  key={`${row.symbol}-${row.reason}`}
                  className="border-t border-stone-100"
                >
                  <td className="px-2 py-1 font-medium text-stone-900">
                    {row.symbol}
                  </td>
                  <td className="px-2 py-1 text-stone-600">
                    {humanizeWatchReason(row.reasonCode, row.reason)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </details>
  );
}

function itemsFallback(funnel: PipelineFunnel): string {
  return String(funnel.validatorAccepted ?? funnel.aiPicksProposed ?? 0);
}

function screeningConclusion(input: {
  funnel: PipelineFunnel;
  hasPicks: boolean;
  lowCash: boolean;
  shortlisted: number;
  buyable: number;
  watch: number;
  buyableBlockedReason?: "LOW_CASH" | "NO_BUYABLE_SETUPS" | null;
}): string {
  const {
    funnel,
    hasPicks,
    lowCash,
    shortlisted,
    buyable,
    watch,
    buyableBlockedReason,
  } = input;
  if (hasPicks) {
    const kept = funnel.validatorAccepted ?? funnel.aiPicksProposed;
    return kept != null
      ? `Top ${shortlisted} → Buyable ${buyable} (Watch ${watch}) → kept ${kept}.`
      : `Top ${shortlisted} → Buyable ${buyable} → picks shown below.`;
  }
  if (buyable > 0 && (lowCash || buyableBlockedReason === "LOW_CASH")) {
    return `Top ${shortlisted} → ${buyable} Buyable → AI skipped (free cash too low).`;
  }
  if (buyable === 0) {
    return `Top ${shortlisted} had structural plans calculated; none were Buyable today (${watch} Watch). Zero-trade day is valid.`;
  }
  if ((funnel.aiPicksProposed ?? 0) === 0) {
    return `Buyable set was ${buyable}, but AI chose to sit out.`;
  }
  if ((funnel.validatorAccepted ?? 0) === 0) {
    return "AI suggested names, but none passed final risk / sizing checks.";
  }
  return "No new buys were kept for today.";
}

function explainEmptyPlan(
  recommendation: RecommendationRun,
  itemCount: number,
  minDeploy: number,
): { title: string; body: string } {
  if (itemCount > 0) {
    return { title: "", body: "" };
  }

  const cash = recommendation.availableCash;
  const lowCash =
    recommendation.skipNewBuysReason === "LOW_CASH" || cash < minDeploy;

  if (lowCash) {
    return {
      title: "Not enough free cash for new buys",
      body: `You have ${formatInr(cash)} free cash. New buy suggestions start only when free cash is at least ${formatInr(minDeploy)}. Your open holdings can still be managed for targets and stops.`,
    };
  }

  const funnel = recommendation.pipelineFunnel;
  if (funnel && funnel.featureReady === 0) {
    return {
      title: "No buyable trade plans today",
      body: "The Top shortlist was reviewed, but none had a defensible structural entry/stop/target to buy now. Watch names are not buy signals. Sitting in cash is intentional.",
    };
  }

  return {
    title: "Sitting in cash",
    body: "No new stocks were suggested. AI may sit out even when Buyable names exist — zero-trade days are valid.",
  };
}

function isJargonSummary(text: string): boolean {
  return /cash dust|minDeploy|pipeline|validator|RETARGET/i.test(text);
}

function NumInput({
  value,
  step,
  onChange,
}: {
  value: number;
  step: number;
  onChange: (raw: string) => void;
}) {
  return (
    <input
      type="number"
      step={step}
      value={Number.isFinite(value) ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-[6.5rem] rounded-md border border-stone-300 bg-white px-2 py-1.5 tabular-nums text-stone-900 outline-none focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
    />
  );
}
