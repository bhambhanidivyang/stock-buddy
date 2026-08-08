import type {
  AuthResponse,
  AuthUser,
  BalanceSnapshot,
  ExecuteResult,
  ExecuteStatus,
  ExecuteStopResult,
  PortfolioSnapshot,
  RecommendationHistoryRun,
  RecommendationRun,
  ReviewTradeAction,
  ReviewTradeResult,
  StatementRow,
} from "./types";
import {
  clearStoredAuth,
  getMemorySession,
  hydrateSessionFromStorage,
  writeStoredAuth,
} from "./session";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const session = getMemorySession() ?? hydrateSessionFromStorage();
    if (!session?.refreshToken) {
      clearStoredAuth();
      return null;
    }

    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });

    if (!res.ok) {
      clearStoredAuth();
      return null;
    }

    const next = (await res.json()) as AuthResponse;
    writeStoredAuth({
      user: next.user,
      accessToken: next.accessToken,
      refreshToken: next.refreshToken,
    });
    return next.accessToken;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  retry = true,
): Promise<T> {
  const isAuthPublic =
    path === "/auth/login" ||
    path === "/auth/register" ||
    path === "/auth/refresh";
  const session = getMemorySession() ?? hydrateSessionFromStorage();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };

  if (!isAuthPublic) {
    const bearer =
      headers.Authorization ??
      (session?.accessToken ? `Bearer ${session.accessToken}` : undefined);
    if (bearer) {
      headers.Authorization = bearer;
    }
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const networkish =
      /load failed|failed to fetch|networkerror|network request failed/i.test(
        raw,
      );
    throw new Error(
      networkish
        ? `Cannot reach API at ${API_URL}. Check NEXT_PUBLIC_API_URL and that FRONTEND_ORIGIN on the API allows this site.`
        : raw || "Network error",
    );
  }

  if (res.status === 401 && retry && !path.startsWith("/auth/")) {
    const nextAccess = await refreshAccessToken();
    if (nextAccess) {
      return request<T>(
        path,
        {
          ...init,
          headers: {
            ...(init?.headers as Record<string, string> | undefined),
            Authorization: `Bearer ${nextAccess}`,
          },
        },
        false,
      );
    }
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (Array.isArray(body.message)) {
        message = body.message.join(", ");
      } else if (body.message) {
        message = body.message;
      }
    } catch {
      // keep default message
    }
    if (
      res.status === 401 &&
      (path === "/auth/login" || path === "/auth/register")
    ) {
      message =
        message === `Request failed (${res.status})`
          ? "Invalid email or password"
          : message;
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export function login(email: string, password: string) {
  return request<AuthResponse>(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ email, password }),
    },
    false,
  );
}

export function register(input: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}) {
  return request<AuthResponse>(
    "/auth/register",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    false,
  );
}

export function refreshSession(refreshToken: string) {
  return request<AuthResponse>(
    "/auth/refresh",
    {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    },
    false,
  );
}

export async function logout(accessToken?: string | null, refreshToken?: string | null) {
  const session = getMemorySession() ?? hydrateSessionFromStorage();
  const token = accessToken ?? session?.accessToken;
  const refresh = refreshToken ?? session?.refreshToken;
  try {
    if (token) {
      await request(
        "/auth/logout",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({ refreshToken: refresh }),
        },
        false,
      );
    }
  } finally {
    clearStoredAuth();
  }
}

export async function fetchStatements(_accessToken?: string | null) {
  const rows = await request<
    Array<
      StatementRow & {
        allocatedAmount?: number;
      }
    >
  >("/statement");

  return rows.map((row) => ({
    date: row.date,
    buyAmount: Number(row.buyAmount ?? row.allocatedAmount ?? 0) || 0,
    sellAmount: Number(row.sellAmount ?? 0) || 0,
    profitLoss: Number(row.profitLoss ?? 0) || 0,
    cash: Number(row.cash ?? 0) || 0,
    holdingsValue: Number(row.holdingsValue ?? 0) || 0,
    stocksBought: row.stocksBought ?? "",
    stocksSold: row.stocksSold ?? "",
    holdings: row.holdings ?? "",
  }));
}

export function fetchRecommendations(
  _accessToken?: string | null,
  limit = 50,
) {
  return request<RecommendationHistoryRun[]>(
    `/recommendations?limit=${limit}`,
  );
}

export function fetchRecommendation(
  recommendationId: string,
  _accessToken?: string | null,
) {
  return request<RecommendationRun>(
    `/recommendations/${recommendationId}`,
  );
}

/** Sole Executable (customizable) plan for today, if any. */
export async function fetchExecutableRecommendation(
  _accessToken?: string | null,
) {
  const res = await request<{ plan: RecommendationRun | null }>(
    "/recommendations/executable",
  );
  return res.plan;
}

/** Mark a today's PENDING plan as the sole Executable plan. */
export function markRecommendationExecutable(
  recommendationId: string,
  _accessToken?: string | null,
) {
  return request<RecommendationRun>(
    `/recommendations/${recommendationId}/mark-executable`,
    { method: "POST" },
  );
}

export function createRecommendation(_accessToken?: string | null) {
  return request<RecommendationRun>("/recommendations", {
    method: "POST",
  });
}

export function updateRecommendation(
  recommendationId: string,
  items: Array<{
    id: string;
    qty: number;
    allocationInr: number;
    buyLow: number;
    buyHigh: number;
    sellTarget: number;
    stopLoss: number;
  }>,
  _accessToken?: string | null,
) {
  return request<RecommendationRun>(`/recommendations/${recommendationId}`, {
    method: "PATCH",
    body: JSON.stringify({ items }),
  });
}

/** Add a Buyable shortlist symbol into the Executable recommendation. */
export function addBuyableToRecommendation(
  recommendationId: string,
  symbol: string,
  _accessToken?: string | null,
) {
  return request<RecommendationRun>(
    `/recommendations/${recommendationId}/items`,
    {
      method: "POST",
      body: JSON.stringify({ symbol }),
    },
  );
}

export function executeTrades(
  recommendationId: string,
  _accessToken?: string | null,
) {
  return request<ExecuteResult>("/execute", {
    method: "POST",
    body: JSON.stringify({ recommendationId }),
  });
}

export function fetchBalance(_accessToken?: string | null) {
  return request<BalanceSnapshot>("/balance");
}

export function fetchPortfolio(_accessToken?: string | null) {
  return request<PortfolioSnapshot>("/portfolio");
}

export function fetchExecuteStatus(_accessToken?: string | null) {
  return request<ExecuteStatus>("/execute/status");
}

export function stopExecution(_accessToken?: string | null) {
  return request<ExecuteStopResult>("/execute/stop", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function reviewTrade(
  tradeId: string,
  input: {
    action: ReviewTradeAction;
    sellTarget?: number;
    stopLoss?: number;
    qty?: number;
  },
  _accessToken?: string | null,
) {
  return request<ReviewTradeResult>(`/portfolio/${tradeId}/review`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchMe(_accessToken?: string | null) {
  return request<AuthUser>("/auth/me");
}

export type TriggerJobResult = {
  ok: boolean;
  job: string;
  status?: "success" | "skipped";
  detail?: string;
  message?: string;
};

export function triggerJob(
  job: "nse_sync" | "recommend" | "execute" | "catchup",
  _accessToken?: string | null,
) {
  return request<TriggerJobResult>(`/jobs/trigger/${job}`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}
