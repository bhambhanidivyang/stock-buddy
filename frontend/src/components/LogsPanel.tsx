"use client";

import { parseAiReview, type AiReviewPosition } from "@/lib/ai-review";
import { fetchActivityLogs } from "@/lib/api";
import { formatInr, formatPrice, formatSignedPct, pnlClass } from "@/lib/format";
import { humanizeAiAction, humanizeAiTrigger } from "@/lib/humanize";
import type { ActivityLogDay, ActivityLogEvent } from "@/lib/types";
import { useCallback, useEffect, useMemo, useState } from "react";

type Props = {
  accessToken?: string | null;
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

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export function LogsPanel({ accessToken }: Props) {
  const [days, setDays] = useState<ActivityLogDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set());
  const [aiDayKey, setAiDayKey] = useState<string | null>(null);

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
            className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl"
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
                  Newest first. Each card is one portfolio check (~every 5 min
                  while a position is open).
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
            <ol className="max-h-[calc(85vh-4.5rem)] space-y-3 overflow-y-auto px-4 py-3">
              {[...aiReviews].reverse().map((ev) => (
                <AiReviewCard key={ev.id} ev={ev} />
              ))}
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

function AiReviewCard({ ev }: { ev: ActivityLogEvent }) {
  const review = parseAiReview(ev);
  const trigger = humanizeAiTrigger(review.triggeredBy);
  const eventNotes = review.positions.flatMap((p) => p.events);
  const changed = review.positions.some(
    (p) => p.action !== "HOLD" || !p.allow,
  );

  return (
    <li
      className={`rounded-xl border px-3 py-3 text-sm ${
        changed
          ? "border-violet-200 bg-violet-50/60"
          : "border-stone-200 bg-stone-50/80"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="tabular-nums text-stone-500">{formatClock(ev.createdAt)}</p>
        <p className="text-xs text-stone-500">
          {trigger}
          {review.triggeredBy === "EVENT" && eventNotes.length === 0
            ? " — an event asked for an extra check"
            : ""}
        </p>
      </div>

      {review.portfolioSummary ? (
        <p className="mt-2 text-stone-800">{review.portfolioSummary}</p>
      ) : null}

      {eventNotes.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-amber-950">
          {eventNotes.map((note, i) => (
            <li key={`${ev.id}-event-${i}`}>{note.message}</li>
          ))}
        </ul>
      ) : null}

      {review.positions.length > 0 ? (
        <ul className="mt-3 space-y-3">
          {review.positions.map((p) => (
            <AiReviewPositionRow key={`${ev.id}-${p.symbol}`} position={p} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-stone-700">{ev.message}</p>
      )}
    </li>
  );
}

function AiReviewPositionRow({ position }: { position: AiReviewPosition }) {
  const copy = humanizeAiAction(position.action);
  const facts = positionFacts(position);
  const showValidation =
    Boolean(position.validation) &&
    position.validation !== position.reason &&
    (!position.allow || !isGenericAllowReason(position.validation));

  return (
    <li className="rounded-lg border border-white/80 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold tracking-wide text-stone-900">
          {position.symbol}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${copy.tone}`}
        >
          {copy.label}
        </span>
        {!position.allow ? (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-900">
            Not applied
          </span>
        ) : null}
        <span
          className={`ml-auto tabular-nums text-sm font-medium ${pnlClass(position.pnlPct)}`}
        >
          {formatSignedPct(position.pnlPct)}
        </span>
      </div>

      {copy.detail && position.action !== "HOLD" ? (
        <p className="mt-1 text-xs text-stone-500">{copy.detail}</p>
      ) : null}

      {position.reason ? (
        <p className="mt-1.5 text-stone-700">{position.reason}</p>
      ) : (
        <p className="mt-1.5 text-stone-500">
          No written reason on this check.
        </p>
      )}

      {facts.length > 0 ? (
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
          {facts.map((fact) => (
            <div key={fact.label} className="flex gap-1">
              <dt className="text-stone-500">{fact.label}</dt>
              <dd className="tabular-nums text-stone-800">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {showValidation ? (
        <p className="mt-2 text-xs text-stone-500">
          {position.allow
            ? `System note: ${position.validation}`
            : `Why it was not applied: ${position.validation}`}
        </p>
      ) : null}

      {formatConfidencePct(position.confidence) ? (
        <p className="mt-1 text-[11px] text-stone-400">
          Confidence {formatConfidencePct(position.confidence)}
        </p>
      ) : null}
    </li>
  );
}

function isGenericAllowReason(reason: string): boolean {
  const t = reason.trim().toUpperCase();
  return (
    t === "OK" ||
    t === "ALLOW" ||
    t.startsWith("AI HOLD") ||
    t.startsWith("DEFAULT HOLD")
  );
}

function formatConfidencePct(confidence: number): string | null {
  if (!Number.isFinite(confidence) || confidence <= 0) return null;
  const pct = confidence <= 1 ? confidence * 100 : confidence;
  if (pct > 100) return null;
  return `${Math.round(pct)}%`;
}

function positionFacts(
  p: AiReviewPosition,
): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = [];
  if (p.qty != null && p.qty > 0) facts.push({ label: "Qty", value: String(p.qty) });
  if (p.ltp) facts.push({ label: "LTP", value: `₹${formatPrice(p.ltp)}` });
  if (p.entryPrice != null) {
    facts.push({ label: "Entry", value: `₹${formatPrice(p.entryPrice)}` });
  }
  if (p.pnl != null) {
    facts.push({ label: "P/L", value: formatInr(p.pnl) });
  }
  if (p.currentStop != null) {
    facts.push({ label: "Stop", value: `₹${formatPrice(p.currentStop)}` });
  }
  if (p.currentTarget != null) {
    facts.push({ label: "Target", value: `₹${formatPrice(p.currentTarget)}` });
  }
  if (
    p.suggestedStop != null &&
    p.suggestedStop !== p.currentStop &&
    (p.action === "MOVE_STOP" || p.action === "PROTECT_PROFIT")
  ) {
    facts.push({
      label: p.allow ? "New stop" : "Wanted stop",
      value: `₹${formatPrice(p.appliedStop ?? p.suggestedStop)}`,
    });
  } else if (
    p.appliedStop != null &&
    p.allow &&
    p.appliedStop !== p.currentStop &&
    (p.action === "MOVE_STOP" || p.action === "PROTECT_PROFIT")
  ) {
    facts.push({
      label: "New stop",
      value: `₹${formatPrice(p.appliedStop)}`,
    });
  }
  if (p.fillPrice != null) {
    facts.push({
      label: p.fillQty != null ? `Sold ${p.fillQty}` : "Sold",
      value: `₹${formatPrice(p.fillPrice)}`,
    });
  }
  return facts;
}
