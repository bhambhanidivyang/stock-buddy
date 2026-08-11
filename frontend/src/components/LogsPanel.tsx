"use client";

import { fetchActivityLogs } from "@/lib/api";
import type { ActivityLogDay } from "@/lib/types";
import { useCallback, useEffect, useState } from "react";

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
  return category === "EXECUTION"
    ? "bg-amber-100 text-amber-900"
    : "bg-teal-100 text-teal-900";
}

export function LogsPanel({ accessToken }: Props) {
  const [days, setDays] = useState<ActivityLogDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set());

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
            Important recommend / execute milestones only (IST days).
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
                  {day.events.length} event
                  {day.events.length === 1 ? "" : "s"} · {open ? "Hide" : "Show"}
                </span>
              </button>
              {open ? (
                <ol className="space-y-2 border-t border-stone-100 px-4 py-3">
                  {day.events.map((ev) => (
                    <li key={ev.id} className="flex gap-3 text-sm">
                      <span className="w-20 shrink-0 tabular-nums text-stone-500">
                        {formatTime(ev.createdAt)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span
                          className={`mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${categoryTone(ev.category)}`}
                        >
                          {ev.category === "EXECUTION" ? "Exec" : "Rec"}
                        </span>
                        <span className="whitespace-pre-wrap break-words text-stone-800">
                          {ev.message}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
