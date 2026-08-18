import type { ActivityLogEvent } from "@/lib/types";

export type AiReviewEvent = {
  type: string;
  message: string;
};

export type AiReviewPosition = {
  symbol: string;
  action: string;
  allow: boolean;
  reason: string;
  validation: string;
  confidence: number;
  ltp: number;
  pnlPct: number;
  pnl: number | null;
  qty: number | null;
  entryPrice: number | null;
  currentStop: number | null;
  currentTarget: number | null;
  suggestedStop: number | null;
  suggestedExitPrice: number | null;
  appliedStop: number | null;
  fillPrice: number | null;
  fillQty: number | null;
  events: AiReviewEvent[];
};

export type ParsedAiReview = {
  triggeredBy: string;
  portfolioSummary: string;
  positions: AiReviewPosition[];
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBool(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function parseEvents(raw: unknown): AiReviewEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (typeof row !== "object" || row == null) return [];
    const rec = row as Record<string, unknown>;
    const message = asString(rec.message);
    if (!message) return [];
    return [{ type: asString(rec.type) || "EVENT", message }];
  });
}

function parsePosition(row: unknown): AiReviewPosition | null {
  if (typeof row !== "object" || row == null) return null;
  const rec = row as Record<string, unknown>;
  const symbol = asString(rec.symbol).toUpperCase();
  if (!symbol) return null;
  return {
    symbol,
    action: asString(rec.action).toUpperCase() || "HOLD",
    allow: asBool(rec.allow, true),
    reason: asString(rec.reason),
    validation: asString(rec.validation),
    confidence: asNumber(rec.confidence) ?? 0,
    ltp: asNumber(rec.ltp) ?? 0,
    pnlPct: asNumber(rec.pnlPct) ?? 0,
    pnl: asNumber(rec.pnl),
    qty: asNumber(rec.qty),
    entryPrice: asNumber(rec.entryPrice),
    currentStop: asNumber(rec.currentStop),
    currentTarget: asNumber(rec.currentTarget),
    suggestedStop: asNumber(rec.suggestedStop),
    suggestedExitPrice: asNumber(rec.suggestedExitPrice),
    appliedStop: asNumber(rec.appliedStop),
    fillPrice: asNumber(rec.fillPrice),
    fillQty: asNumber(rec.fillQty),
    events: parseEvents(rec.events),
  };
}

export function parseAiReview(ev: ActivityLogEvent): ParsedAiReview {
  const meta = ev.meta ?? {};
  const positions = Array.isArray(meta.positions)
    ? meta.positions.flatMap((row) => {
        const parsed = parsePosition(row);
        return parsed ? [parsed] : [];
      })
    : [];
  return {
    triggeredBy: asString(meta.triggeredBy) || "INTERVAL",
    portfolioSummary: asString(meta.portfolioSummary),
    positions,
  };
}
