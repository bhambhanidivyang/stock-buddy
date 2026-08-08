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
