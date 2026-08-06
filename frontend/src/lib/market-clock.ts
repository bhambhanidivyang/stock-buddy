/** Mirrors backend `market-clock.ts` (NSE cash, Asia/Kolkata). */

export type MarketSession = "PRE_OPEN" | "OPEN" | "CLOSED";

function istParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { weekday, mins: hour * 60 + minute };
}

function isWeekend(weekday: string) {
  return weekday === "Sat" || weekday === "Sun";
}

export function getMarketSession(now = new Date()): MarketSession {
  const { weekday, mins } = istParts(now);

  if (isWeekend(weekday)) {
    return "CLOSED";
  }

  // Pre-open 09:00–09:15, open 09:15–15:30 IST
  if (mins >= 9 * 60 && mins < 9 * 60 + 15) {
    return "PRE_OPEN";
  }
  if (mins >= 9 * 60 + 15 && mins < 15 * 60 + 30) {
    return "OPEN";
  }
  return "CLOSED";
}

/** True during NSE cash open (09:15–15:30 IST, weekdays). */
export function isMarketOpen(now = new Date()): boolean {
  return getMarketSession(now) === "OPEN";
}
