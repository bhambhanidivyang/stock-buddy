/** Map deterministic status / reject codes to short end-user copy. */
export function humanizeReasonCode(code: string | null | undefined): string | null {
  if (code == null || !String(code).trim()) return null;
  const key = String(code).trim().toUpperCase();
  const map: Record<string, string> = {
    STOP_TOO_WIDE: "Stop would risk too much of the position",
    NO_VALID_ENTRY: "No clear buy zone from chart structure right now",
    ENTRY_TOO_EXTENDED: "Price already ran past a sensible buy zone",
    TARGET_TOO_CLOSE: "Upside to next resistance is too small vs risk",
    NO_STRUCTURAL_TARGET: "No clear sell target from chart structure",
    EXCESSIVE_RISK: "Risk is too high for this account",
    INVALID_DATA: "Market data missing or unreliable",
    SPIKE_SUSPECT: "Price action looks abnormal / spike-like",
    BROKEN_STRUCTURE: "Chart structure looks broken for a long trade",
    HISTORY_TOO_SHORT: "Not enough daily history yet",
    NOT_EVALUATED: "Not fully checked in this run",
    OK: "Ready to consider",
  };
  return map[key] ?? null;
}

/** Prefer code map, else return text if it already looks human, else soft-clean. */
export function humanizeWatchReason(
  reasonCode: string | null | undefined,
  reason: string | null | undefined,
): string {
  const fromCode = humanizeReasonCode(reasonCode);
  if (fromCode) return fromCode;
  const fromReasonAsCode = humanizeReasonCode(reason);
  if (fromReasonAsCode) return fromReasonAsCode;
  const text = (reason ?? "").trim();
  if (!text) return "Not attractive to buy at the current price";
  return text;
}

const AI_ACTION_COPY: Record<
  string,
  { label: string; detail: string; tone: string }
> = {
  HOLD: {
    label: "Hold",
    detail: "Leave the trade as-is",
    tone: "bg-stone-100 text-stone-800",
  },
  PROTECT_PROFIT: {
    label: "Protect profit",
    detail: "Raise the stop toward breakeven",
    tone: "bg-amber-100 text-amber-950",
  },
  MOVE_STOP: {
    label: "Tighten stop",
    detail: "Move the stop up with the price",
    tone: "bg-sky-100 text-sky-950",
  },
  EXIT_NOW: {
    label: "Exit now",
    detail: "Sell the position at the live mark",
    tone: "bg-rose-100 text-rose-950",
  },
  TAKE_PARTIAL_PROFIT: {
    label: "Take partial profit",
    detail: "Sell some quantity (blocked until a size policy exists)",
    tone: "bg-teal-100 text-teal-950",
  },
};

export function humanizeAiAction(action: string | null | undefined): {
  label: string;
  detail: string;
  tone: string;
} {
  const key = String(action ?? "").trim().toUpperCase();
  return (
    AI_ACTION_COPY[key] ?? {
      label: key.replace(/_/g, " ").toLowerCase() || "Review",
      detail: "",
      tone: "bg-stone-100 text-stone-800",
    }
  );
}

export function humanizeAiTrigger(triggeredBy: string | null | undefined): string {
  const key = String(triggeredBy ?? "").trim().toUpperCase();
  if (key === "EVENT") return "Market event";
  return "Scheduled check";
}
