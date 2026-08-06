/** NSE equity ticker helpers. Universe membership comes from NSE sync (DB). */

const NSE_SYMBOL_RE = /^[A-Z0-9][A-Z0-9.&-]{0,24}$/;

/** Normalize to bare NSE symbol (no `.NS`), or null if invalid. */
export function normalizeNseSymbol(symbol: string | undefined | null): string | null {
  if (symbol == null) return null;
  const normalized = symbol.trim().toUpperCase().replace(/\.NS$/i, '');
  if (!normalized || !NSE_SYMBOL_RE.test(normalized)) {
    return null;
  }
  return normalized;
}

/** Map NSE ticker or Yahoo index (`^…`) to Yahoo Finance symbol. */
export function toYahooSymbol(symbol: string): string {
  const trimmed = symbol.trim();
  if (trimmed.startsWith('^')) {
    return trimmed;
  }
  const normalized = normalizeNseSymbol(trimmed);
  if (normalized) {
    return `${normalized}.NS`;
  }
  const upper = trimmed.toUpperCase();
  return upper.endsWith('.NS') ? upper : `${upper}.NS`;
}
