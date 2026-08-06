"use client";

import { CashSummary } from "@/components/CashSummary";
import { ExecutionPanel } from "@/components/ExecutionPanel";
import { OverviewPanel } from "@/components/OverviewPanel";
import { PortfolioPanel } from "@/components/PortfolioPanel";
import { RecommendationsPanel } from "@/components/RecommendationsPanel";
import { RequireAuth } from "@/components/RequireAuth";
import { SettingsPanel } from "@/components/SettingsPanel";
import { StatementTable } from "@/components/StatementTable";
import { TabPanel, Tabs } from "@/components/Tabs";
import {
  fetchBalance,
  fetchExecuteStatus,
  fetchPortfolio,
  fetchStatements,
  logout as apiLogout,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type {
  BalanceSnapshot,
  ExecuteStatus,
  PortfolioSnapshot,
  StatementRow,
} from "@/lib/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type TabId =
  | "overview"
  | "portfolio"
  | "recommendations"
  | "execution"
  | "statements"
  | "settings";

function DashboardContent() {
  const { user, accessToken, refreshToken } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("overview");

  const [balance, setBalance] = useState<BalanceSnapshot | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [executeStatus, setExecuteStatus] = useState<ExecuteStatus | null>(null);
  const [rows, setRows] = useState<StatementRow[]>([]);

  const [bookLoading, setBookLoading] = useState(true);
  const [bookError, setBookError] = useState<string | null>(null);
  const [statementsLoading, setStatementsLoading] = useState(false);
  const [statementsError, setStatementsError] = useState<string | null>(null);

  const refreshBook = useCallback(async () => {
    setBookError(null);
    try {
      const [b, p, e] = await Promise.all([
        fetchBalance(accessToken),
        fetchPortfolio(accessToken),
        fetchExecuteStatus(accessToken),
      ]);
      setBalance(b);
      setPortfolio(p);
      setExecuteStatus(e);
    } catch (err) {
      setBookError(
        err instanceof Error ? err.message : "Failed to load account book",
      );
    } finally {
      setBookLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void refreshBook();
    const id = window.setInterval(() => {
      void refreshBook();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [refreshBook]);

  useEffect(() => {
    if (tab !== "statements" && tab !== "overview") return;

    let cancelled = false;

    async function load() {
      setStatementsLoading(true);
      setStatementsError(null);
      try {
        const data = await fetchStatements(accessToken);
        if (!cancelled) setRows(data);
      } catch (err) {
        if (!cancelled) {
          setStatementsError(
            err instanceof Error ? err.message : "Failed to load statements",
          );
        }
      } finally {
        if (!cancelled) setStatementsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [accessToken, tab]);

  async function logout() {
    await apiLogout(accessToken, refreshToken);
    router.replace("/login");
  }

  return (
    <main className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-display text-3xl tracking-tight text-teal-900 sm:text-4xl">
            Stock Buddy
          </p>
          <p className="mt-2 text-sm text-stone-600">
            Signed in as {user?.firstName} {user?.lastName} ({user?.email})
          </p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="self-start rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
        >
          Sign out
        </button>
      </header>

      <CashSummary
        balance={balance}
        loading={bookLoading}
        onOpenReview={() => setTab("portfolio")}
      />

      <Tabs
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "portfolio", label: "Portfolio" },
          { id: "recommendations", label: "Recommendations" },
          { id: "execution", label: "Execution" },
          { id: "statements", label: "Statements" },
          { id: "settings", label: "Settings" },
        ]}
        active={tab}
        onChange={setTab}
      >
        <TabPanel id="overview" active={tab}>
          <OverviewPanel
            balance={balance}
            portfolio={portfolio}
            executeStatus={executeStatus}
            statements={rows}
            statementsLoading={statementsLoading}
            loading={bookLoading}
            error={bookError}
            onGoPortfolio={() => setTab("portfolio")}
            onGoExecution={() => setTab("execution")}
            onGoRecommendations={() => setTab("recommendations")}
          />
        </TabPanel>
        <TabPanel id="portfolio" active={tab}>
          <PortfolioPanel
            portfolio={portfolio}
            loading={bookLoading}
            error={bookError}
            accessToken={accessToken}
            onChanged={() => void refreshBook()}
          />
        </TabPanel>
        <TabPanel id="recommendations" active={tab}>
          <RecommendationsPanel
            accessToken={accessToken}
            onExecuted={() => void refreshBook()}
          />
        </TabPanel>
        <TabPanel id="execution" active={tab}>
          <ExecutionPanel
            accessToken={accessToken}
            status={executeStatus}
            onStatus={setExecuteStatus}
          />
        </TabPanel>
        <TabPanel id="statements" active={tab}>
          <StatementTable
            rows={rows}
            loading={statementsLoading}
            error={statementsError}
          />
        </TabPanel>
        <TabPanel id="settings" active={tab}>
          <SettingsPanel accessToken={accessToken} fallbackUser={user} />
        </TabPanel>
      </Tabs>
    </main>
  );
}

export default function StatementsPage() {
  return (
    <RequireAuth>
      <DashboardContent />
    </RequireAuth>
  );
}
