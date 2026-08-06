import { MarketSession } from '../database/enums';

function istParts(now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return {
    weekday,
    mins: hour * 60 + minute,
    dateKey: `${year}-${month}-${day}`,
  };
}

/** IST calendar date YYYY-MM-DD */
export function istDateKey(now = new Date()): string {
  return istParts(now).dateKey;
}

/** IST minutes since midnight */
export function istMinutesSinceMidnight(now = new Date()): number {
  return istParts(now).mins;
}

export function isIstWeekday(now = new Date()): boolean {
  return !isWeekend(istParts(now).weekday);
}

function isWeekend(weekday: string): boolean {
  return weekday === 'Sat' || weekday === 'Sun';
}

/** NSE cash market hours in IST. */
export function getMarketSession(now = new Date()): MarketSession {
  const { weekday, mins } = istParts(now);

  if (isWeekend(weekday)) {
    return MarketSession.CLOSED;
  }

  // Pre-open 09:00–09:15, open 09:15–15:30 IST
  if (mins >= 9 * 60 && mins < 9 * 60 + 15) {
    return MarketSession.PRE_OPEN;
  }
  if (mins >= 9 * 60 + 15 && mins < 15 * 60 + 30) {
    return MarketSession.OPEN;
  }
  return MarketSession.CLOSED;
}

export function isMarketOpenForTrading(now = new Date()): boolean {
  return getMarketSession(now) === MarketSession.OPEN;
}

/**
 * Last 15 minutes of the cash session (15:15–15:30 IST), while market is still open.
 * Hard paper sells need live quotes — only run profitable EOD force-sells here.
 */
export function isForceFlatWindow(now = new Date()): boolean {
  const { weekday, mins } = istParts(now);
  if (isWeekend(weekday)) {
    return false;
  }
  return mins >= 15 * 60 + 15 && mins < 15 * 60 + 30;
}

/** Weekday after 15:30 IST — market closed; no hard sells, only offline wind-up. */
export function isAfterMarketCloseWeekday(now = new Date()): boolean {
  const { weekday, mins } = istParts(now);
  if (isWeekend(weekday)) {
    return false;
  }
  return mins >= 15 * 60 + 30;
}

/** True when either live EOD settle or post-close wind-up should run. */
export function shouldRunEndOfDaySettlement(now = new Date()): boolean {
  return isForceFlatWindow(now) || isAfterMarketCloseWeekday(now);
}

/** New entries allowed only in open session before the force-flat window. */
export function canAcceptNewEntries(now = new Date()): boolean {
  return isMarketOpenForTrading(now) && !isForceFlatWindow(now);
}
