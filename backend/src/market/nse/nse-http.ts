import { Logger } from '@nestjs/common';

const logger = new Logger('NseHttp');

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.nseindia.com/',
};

let cookieJar = '';

/** Warm NSE session cookies (often required for archives). */
export async function warmNseSession(): Promise<void> {
  try {
    const res = await fetch('https://www.nseindia.com/', {
      headers: DEFAULT_HEADERS,
      redirect: 'follow',
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) {
      cookieJar = setCookie.map((c) => c.split(';')[0]).join('; ');
    }
  } catch (error) {
    logger.warn(
      `NSE session warm failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function nseFetch(url: string): Promise<Response> {
  if (!cookieJar) {
    await warmNseSession();
  }
  const headers: Record<string, string> = { ...DEFAULT_HEADERS };
  if (cookieJar) {
    headers.Cookie = cookieJar;
  }
  let res = await fetch(url, { headers, redirect: 'follow' });
  if (res.status === 401 || res.status === 403) {
    await warmNseSession();
    if (cookieJar) {
      headers.Cookie = cookieJar;
    }
    res = await fetch(url, { headers, redirect: 'follow' });
  }
  return res;
}

/** Format a calendar day as YYYYMMDD using the date's UTC Y/M/D fields. */
export function formatNseDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** IST calendar date as a UTC-noon Date (stable Y/M/D for NSE filenames). */
function istCalendarUtcNoon(from = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(from);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/** Walk back IST calendar days skipping weekends (holidays may 404 / empty). */
export function recentTradeDateCandidates(from = new Date(), count = 10): Date[] {
  const out: Date[] = [];
  const cursor = istCalendarUtcNoon(from);
  while (out.length < count) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      out.push(new Date(cursor));
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}
