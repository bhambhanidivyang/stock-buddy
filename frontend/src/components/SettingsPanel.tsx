"use client";

import { fetchMe, triggerJob } from "@/lib/api";
import type { AuthUser } from "@/lib/types";
import { useEffect, useState } from "react";

type Props = {
  accessToken?: string | null;
  fallbackUser?: AuthUser | null;
};

export function SettingsPanel({ accessToken, fallbackUser }: Props) {
  const [profile, setProfile] = useState<AuthUser | null>(fallbackUser ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  async function runJob(job: "nse_sync" | "catchup") {
    setBusy(job);
    setError(null);
    setMessage(null);
    try {
      await triggerJob(job, accessToken);
      setMessage(
        job === "nse_sync"
          ? "Market sync started (NSE equity master + bhav)."
          : "Catch-up jobs triggered.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Job failed");
    } finally {
      setBusy(null);
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

      <section className="rounded-xl border border-stone-200 bg-white/80 p-4 shadow-sm">
        <h2 className="text-base font-semibold text-stone-900">Ops</h2>
        <p className="mt-1 text-sm text-stone-600">
          Manual triggers for the VM / local box. Prefer the IST scheduler in production
          (<code className="text-xs">SCHEDULER_ENABLED</code>).
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy != null}
            onClick={() => void runJob("nse_sync")}
            className="rounded-lg bg-teal-800 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-60"
          >
            {busy === "nse_sync" ? "Syncing…" : "Sync market data"}
          </button>
          <button
            type="button"
            disabled={busy != null}
            onClick={() => void runJob("catchup")}
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-50 disabled:opacity-60"
          >
            {busy === "catchup" ? "Running…" : "Run catch-up"}
          </button>
        </div>
      </section>

      {error ? (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
          {error}
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
