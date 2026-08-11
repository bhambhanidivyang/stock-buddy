"use client";

import { formatInr, pnlClass } from "@/lib/format";
import type {
  BalanceSnapshot,
  ExecuteStatus,
  PortfolioSnapshot,
  StatementRow,
} from "@/lib/types";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Props = {
  balance: BalanceSnapshot | null;
  portfolio: PortfolioSnapshot | null;
  executeStatus: ExecuteStatus | null;
  statements?: StatementRow[];
  statementsLoading?: boolean;
  loading?: boolean;
  error?: string | null;
  onGoPortfolio: () => void;
  onGoExecution: () => void;
  onGoRecommendations: () => void;
};

const CHART_DAYS = 60;

export function OverviewPanel({
  balance,
  executeStatus,
  statements = [],
  statementsLoading,
  loading,
  error,
  onGoPortfolio,
}: Props) {
  if (loading && !balance) {
    return <p className="text-sm text-stone-500">Loading overview…</p>;
  }

  if (error) {
    return (
      <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
        {error}
      </p>
    );
  }

  if (!balance) {
    return <p className="text-sm text-stone-500">No balance yet.</p>;
  }

  const reviewCount = balance.needsReviewPositions;
  const execution = overviewExecutionCopy(executeStatus);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          title="Lifetime Equity"
          body={formatInr(balance.equity)}
          sub={`Cash ${formatInr(balance.cash)} + holdings ${formatInr(balance.holdingsValue)}`}
        />
        <Card
          title="P&L"
          body={formatInr(balance.realizedPnl)}
          bodyClass={pnlClass(balance.realizedPnl)}
          sub="Realized only — closed trades"
        />
        <Card
          title="Open MTM"
          body={formatInr(balance.unrealizedPnl)}
          bodyClass={pnlClass(balance.unrealizedPnl)}
          sub="Mark − buy on open lots (not locked P&L)"
        />
        <Card title="Execution" body={execution.body} sub={execution.sub} />
      </div>

      {reviewCount > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">
            {reviewCount} lot{reviewCount === 1 ? "" : "s"} need human review
          </p>
          <p className="mt-1 text-amber-900/80">
            Time-stopped or parked positions stay in the book until you Sell or
            Hold. Automation will not exit them.
          </p>
          <button
            type="button"
            onClick={onGoPortfolio}
            className="mt-3 rounded-lg bg-amber-800 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-900"
          >
            Review in Portfolio
          </button>
        </div>
      ) : null}

      <EquityCurveChart
        rows={statements}
        liveEquity={balance.equity}
        liveCash={balance.cash}
        liveHoldings={balance.holdingsValue}
        liveAsOf={balance.asOf}
        loading={Boolean(statementsLoading)}
      />
    </div>
  );
}

function EquityCurveChart({
  rows,
  liveEquity,
  liveCash,
  liveHoldings,
  liveAsOf,
  loading,
}: {
  rows: StatementRow[];
  liveEquity: number;
  liveCash: number;
  liveHoldings: number;
  liveAsOf?: string | null;
  loading: boolean;
}) {
  const data = useMemo(() => {
    const chronological = [...rows].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const slice = chronological.slice(-CHART_DAYS);
    const points = slice.map((row) => {
      const equity = roundMoney(row.cash + row.holdingsValue);
      return {
        date: row.date,
        label: formatDayLabel(row.date),
        equity,
        cash: row.cash,
        holdings: row.holdingsValue,
      };
    });

    const today = istDateKey(liveAsOf ? new Date(liveAsOf) : new Date());
    const last = points[points.length - 1];
    const livePoint = {
      date: today,
      label: formatDayLabel(today),
      equity: roundMoney(liveEquity),
      cash: liveCash,
      holdings: liveHoldings,
    };
    if (!last || last.date !== today) {
      points.push(livePoint);
    } else {
      points[points.length - 1] = livePoint;
    }

    return points;
  }, [rows, liveEquity, liveCash, liveHoldings, liveAsOf]);

  const startEquity = data[0]?.equity ?? 0;
  const endEquity = data[data.length - 1]?.equity ?? 0;
  const change = roundMoney(endEquity - startEquity);
  const changePct =
    startEquity > 0 ? ((endEquity - startEquity) / startEquity) * 100 : 0;

  return (
    <section className="rounded-2xl border border-stone-200/90 bg-white/90 p-4 shadow-sm shadow-stone-900/5 sm:p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-stone-900">Equity curve</h2>
          <p className="mt-1 text-sm text-stone-500">
            End-of-day equity (cash + holdings)
            {data.length > 0 ? ` · last ${data.length} days` : ""}.
          </p>
        </div>
        {data.length > 1 ? (
          <p className={`text-sm font-semibold tabular-nums ${pnlClass(change)}`}>
            {change >= 0 ? "+" : ""}
            {formatInr(change)}
            <span className="ml-1.5 text-xs font-medium text-stone-500">
              ({changePct >= 0 ? "+" : ""}
              {changePct.toFixed(1)}%)
            </span>
          </p>
        ) : null}
      </div>

      {loading && rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-stone-500">
          Loading chart…
        </p>
      ) : data.length === 0 ? (
        <p className="py-16 text-center text-sm text-stone-500">
          No equity history yet — statement days will build the curve.
        </p>
      ) : (
        <div className="h-72 w-full sm:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
            >
              <defs>
                <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0f766e" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#0f766e" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke="#e7e5e4"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fill: "#78716c", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "#d6d3d1" }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: "#78716c", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={formatAxisInr}
                width={72}
                domain={["auto", "auto"]}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #e7e5e4",
                  boxShadow: "0 8px 24px rgba(28, 25, 23, 0.08)",
                  fontSize: 12,
                }}
                formatter={(value) => [
                  formatInr(typeof value === "number" ? value : Number(value)),
                  "Equity",
                ]}
                labelFormatter={(_, payload) => {
                  const point = payload?.[0]?.payload as
                    | { date?: string; cash?: number; holdings?: number }
                    | undefined;
                  if (!point?.date) return "";
                  return `${point.date} · cash ${formatInr(point.cash ?? 0)} + holdings ${formatInr(point.holdings ?? 0)}`;
                }}
              />
              <Area
                type="monotone"
                dataKey="equity"
                name="equity"
                stroke="#0f766e"
                strokeWidth={2.25}
                fill="url(#equityFill)"
                dot={data.length <= 2}
                activeDot={{ r: 5, fill: "#0f766e", strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function istDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function formatDayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

function formatAxisInr(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "₹0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function overviewExecutionCopy(status: ExecuteStatus | null): {
  body: string;
  sub: string;
} {
  if (!status) {
    return { body: "—", sub: "No execution data yet" };
  }

  const open = status.openPositions;
  const waiting = status.waitingBuy;
  const review = status.needsReviewPositions;

  if (status.phase === "BUYING") {
    return {
      body:
        waiting > 0
          ? `Buying · ${waiting} waiting`
          : "Buying entries",
      sub:
        open > 0
          ? `${open} open · watching target & stop`
          : "Filling entry bands",
    };
  }

  if (status.phase === "MANAGING") {
    return {
      body: open === 1 ? "1 open position" : `${open} open positions`,
      sub:
        status.status === "RUNNING"
          ? "Watching target & stop"
          : "Watching target & stop while market is open",
    };
  }

  if (status.phase === "NEEDS_REVIEW") {
    return {
      body: review === 1 ? "1 needs review" : `${review} need review`,
      sub: "Decide Sell or Hold in Portfolio",
    };
  }

  return {
    body: "Idle",
    sub:
      status.soldPositions > 0
        ? `${status.soldPositions} sold today`
        : "No active paper session",
  };
}

function Card({
  title,
  body,
  sub,
  bodyClass,
}: {
  title: string;
  body: string;
  sub?: string;
  bodyClass?: string;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white/80 p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
        {title}
      </p>
      <p className={`mt-2 text-xl font-semibold tabular-nums text-stone-900 ${bodyClass ?? ""}`}>
        {body}
      </p>
      {sub ? <p className="mt-1 text-xs text-stone-500">{sub}</p> : null}
    </div>
  );
}
