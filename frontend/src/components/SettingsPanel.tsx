"use client";

import { fetchMe, triggerJob } from "@/lib/api";
import type { AuthUser } from "@/lib/types";
import { useEffect, useState } from "react";

type Props = {
  accessToken?: string | null;
  fallbackUser?: AuthUser | null;
};

type JobFeedback = {
  kind: "success" | "skipped" | "error";
  text: string;
};

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
      aria-hidden
    />
  );
}

export function SettingsPanel({ accessToken, fallbackUser }: Props) {
  const [profile, setProfile] = useState<AuthUser | null>(fallbackUser ?? null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<JobFeedback | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const me = await fetchMe(accessToken);
        if (!cancelled) setProfile(me);
      } catch {
        // keep fallback from auth context
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  async function syncMarketData() {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await triggerJob("nse_sync", accessToken);
      const status = result.status ?? "success";
      setFeedback({
        kind: status === "skipped" ? "skipped" : "success",
        text:
          result.detail?.trim() ||
          "Market data sync finished.",
      });
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-stone-200 bg-white/80 p-4 shadow-sm">
        <h2 className="text-base font-semibold text-stone-900">Account</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-stone-500">Name</dt>
            <dd className="font-medium text-stone-900">
              {profile
                ? `${profile.firstName} ${profile.lastName}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Email</dt>
            <dd className="font-medium text-stone-900">{profile?.email ?? "—"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-stone-600">
          Each user has a private paper account seeded by <code className="text-xs">DAILY_FUND</code>.
          Trading knobs (allocation caps, level engine, scheduler) live in server env — not per-user
          yet.
        </p>
      </section>

      <section className="space-y-3">
        <article className="flex flex-col rounded-xl border border-stone-200 bg-white/80 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-stone-900">
            Sync market data
          </h3>
          <p className="mt-2 text-sm text-stone-600">
            Downloads the latest stock list and about a month of official NSE
            end-of-day prices. This keeps liquidity filters and 20-day return
            ranking accurate. Safe to run anytime; it only fills missing days.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void syncMarketData()}
            className="mt-4 inline-flex items-center justify-center gap-2 self-start rounded-lg bg-teal-800 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-60"
          >
            {busy ? (
              <>
                <Spinner className="text-white" />
                Syncing market data…
              </>
            ) : (
              "Sync market data"
            )}
          </button>
          {busy ? (
            <p className="mt-3 text-sm text-stone-500" role="status">
              This can take up to a minute while missing trading days download.
            </p>
          ) : null}
          <JobStatus feedback={feedback} />
        </article>
      </section>
    </div>
  );
}

function JobStatus({ feedback }: { feedback: JobFeedback | null }) {
  if (!feedback) return null;
  const styles =
    feedback.kind === "error"
      ? "bg-rose-50 text-rose-800"
      : feedback.kind === "skipped"
        ? "bg-amber-50 text-amber-900"
        : "bg-teal-50 text-teal-900";
  return (
    <p
      className={`mt-3 rounded-md px-3 py-2 text-sm ${styles}`}
      role={feedback.kind === "error" ? "alert" : "status"}
    >
      {feedback.text}
    </p>
  );
}
