"use client";

import { fetchActivityLogs } from "@/lib/api";
import type { ActivityLogDay, ActivityLogEvent } from "@/lib/types";
import { useCallback, useEffect, useMemo, useState } from "react";

type Props = {
  accessToken?: string | null;
};

type AiPositionLine = {
  symbol: string;
  action: string;
  allow: boolean;
  reason: string;
  validation: string;
  confidence: number;
  ltp: number;
  pnlPct: number;
};

function formatDayLabel(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function categoryTone(category: string): string {
  if (category === "EXECUTION") return "bg-amber-100 text-amber-900";
  if (category === "POSITION_MANAGEMENT") return "bg-violet-100 text-violet-900";
  return "bg-teal-100 text-teal-900";
}

function categoryLabel(category: string): string {
  if (category === "EXECUTION") return "Exec";
  if (category === "POSITION_MANAGEMENT") return "AI";
  return "Rec";
}

function positionsFromMeta(meta: Record<string, unknown> | null): AiPositionLine[] {
  const raw = meta?.positions;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (row): row is AiPositionLine =>
      typeof row === "object" &&
      row != null &&
      typeof (row as AiPositionLine).symbol === "string",
  );
}

export function LogsPanel({ accessToken }: Props) {
  const [days, setDays] = useState<ActivityLogDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set());
  const [aiDayKey, setAiDayKey] = useState<string | null>(null);
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchActivityLogs(accessToken, 21);
      setDays(data);
      setOpenDays((prev) => {
        if (prev.size > 0) return prev;
        const first = data[0]?.dayKey;
        return first ? new Set([first]) : new Set();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleDay(dayKey: string) {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  }

  const aiDay = useMemo(
    () => days.find((d) => d.dayKey === aiDayKey) ?? null,
    [days, aiDayKey],
  );
  const aiReviews = useMemo(
    () =>
      (aiDay?.events ?? []).filter(
        (ev) =>
          ev.category === "POSITION_MANAGEMENT" && ev.eventCode === "PM_REVIEW",
      ),
    [aiDay],
  );

  if (loading) {
    return (
      <p className="text-sm text-stone-600" role="status">
        Loading milestone logs…
      </p>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          Retry
        </button>
      </div>
    );
  }

  if (days.length === 0) {
    return (
      <p className="text-sm text-stone-600">
        No milestone logs yet. Generate a recommendation or start execution to
        see runs here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-stone-900">
            Activity logs
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            Recommend / execute milestones. AI reviews are grouped per day.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="shrink-0 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          Refresh
        </button>
      </div>

      <ul className="space-y-2">
        {days.map((day) => {
          const open = openDays.has(day.dayKey);
          const milestones = day.events.filter(
            (ev) => ev.category !== "POSITION_MANAGEMENT",
          );
          const reviews = day.events.filter(
            (ev) =>
              ev.category === "POSITION_MANAGEMENT" &&
              ev.eventCode === "PM_REVIEW",
          );
          return (
            <li
              key={day.dayKey}
              className="overflow-hidden rounded-xl border border-stone-200 bg-white/80"
            >
              <button
                type="button"
                onClick={() => toggleDay(day.dayKey)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-stone-50"
                aria-expanded={open}
              >
                <span className="font-medium text-stone-900">
                  {formatDayLabel(day.dayKey)}
                </span>
                <span className="text-xs text-stone-500">
                  {milestones.length} milestone
                  {milestones.length === 1 ? "" : "s"}
                  {reviews.length > 0
                    ? ` · ${reviews.length} AI review${reviews.length === 1 ? "" : "s"}`
                    : ""}{" "}
                  · {open ? "Hide" : "Show"}
                </span>
              </button>
              {open ? (
                <ol className="space-y-2 border-t border-stone-100 px-4 py-3">
                  {reviews.length > 0 ? (
                    <li className="flex gap-3 text-sm">
                      <span className="w-20 shrink-0 tabular-nums text-stone-500">
                        —
                      </span>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedReviewId(null);
                            setAiDayKey(day.dayKey);
                          }}
                          className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-left text-sm text-violet-950 hover:bg-violet-100"
                        >
                          <span className="mr-2 inline-block rounded bg-violet-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                            AI
                          </span>
                          {reviews.length} portfolio review
                          {reviews.length === 1 ? "" : "s"} this day — open
                          details
                        </button>
                      </div>
                    </li>
                  ) : null}
                  {milestones.map((ev) => (
                    <LogRow key={ev.id} ev={ev} />
                  ))}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ul>

      {aiDayKey && aiDay ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-reviews-title"
          onClick={() => setAiDayKey(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-4 py-3">
              <div>
                <h3
                  id="ai-reviews-title"
                  className="text-sm font-semibold text-stone-900"
                >
                  AI reviews · {formatDayLabel(aiDay.dayKey)}
                </h3>
                <p className="text-xs text-stone-500">
                  One row per portfolio cycle (~every 5 min while positions are
                  open).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAiDayKey(null)}
                className="rounded-lg border border-stone-300 px-2 py-1 text-sm text-stone-700 hover:bg-stone-50"
              >
                Close
              </button>
            </div>
            <ol className="max-h-[calc(80vh-4rem)] space-y-2 overflow-y-auto px-4 py-3">
              {aiReviews.map((ev) => {
                const positions = positionsFromMeta(ev.meta);
                const open = expandedReviewId === ev.id;
                return (
                  <li
                    key={ev.id}
                    className="rounded-lg border border-stone-100 bg-stone-50/80 px-3 py-2 text-sm"
                  >
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 text-left"
                      onClick={() =>
                        setExpandedReviewId(open ? null : ev.id)
                      }
                    >
                      <span className="w-20 shrink-0 tabular-nums text-stone-500">
                        {formatTime(ev.createdAt)}
                      </span>
                      <span className="min-w-0 flex-1 text-stone-800">
                        {ev.message}
                      </span>
                    </button>
                    {open && positions.length > 0 ? (
                      <ul className="mt-2 space-y-2 border-t border-stone-200 pt-2">
                        {positions.map((p) => (
                          <li
                            key={`${ev.id}-${p.symbol}`}
                            className="text-xs text-stone-700"
                          >
                            <span className="font-semibold">{p.symbol}</span>{" "}
                            {p.action}
                            {p.allow ? "" : " · BLOCKED"} · LTP ₹{p.ltp} ·{" "}
                            {p.pnlPct.toFixed(2)}%
                            <p className="mt-0.5 text-stone-600">{p.reason}</p>
                            {p.validation && p.validation !== p.reason ? (
                              <p className="text-stone-500">
                                Validator: {p.validation}
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LogRow({ ev }: { ev: ActivityLogEvent }) {
  return (
    <li className="flex gap-3 text-sm">
      <span className="w-20 shrink-0 tabular-nums text-stone-500">
        {formatTime(ev.createdAt)}
      </span>
      <div className="min-w-0 flex-1">
        <span
          className={`mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${categoryTone(ev.category)}`}
        >
          {categoryLabel(ev.category)}
        </span>
        <span className="whitespace-pre-wrap break-words text-stone-800">
          {ev.message}
        </span>
      </div>
    </li>
  );
}
