import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Repository } from 'typeorm';
import { MarketBhavDaily } from '../../database/entities/market-bhav-daily.entity';
import { UniverseSnapshot } from '../../database/entities/universe-snapshot.entity';
import { UniverseSymbolRow } from '../../database/entities/universe-symbol.entity';
import type { UniverseStock } from '../providers/universe.provider';
import { parseBhavCsv, splitCsvLine } from './bhav-csv';
import {
  BHAV_MAX_AGE_DAYS,
  bhavCandidateCount,
  isBhavSyncSatisfied,
  toTradeDateKey,
} from './bhav-sync';
import {
  formatNseDate,
  nseFetch,
  recentTradeDateCandidates,
  warmNseSession,
} from './nse-http';

const EQUITY_LIST_URLS = [
  'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv',
  'https://archives.nseindia.com/content/equities/EQUITY_L.csv',
];

function bhavZipUrl(yyyymmdd: string): string {
  return `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${yyyymmdd}_F_0000.csv.zip`;
}

@Injectable()
export class NseMarketService {
  private readonly logger = new Logger(NseMarketService.name);

  constructor(
    @InjectRepository(UniverseSnapshot)
    private readonly snapshots: Repository<UniverseSnapshot>,
    @InjectRepository(UniverseSymbolRow)
    private readonly symbols: Repository<UniverseSymbolRow>,
    @InjectRepository(MarketBhavDaily)
    private readonly bhav: Repository<MarketBhavDaily>,
  ) {}

  async ensureUniverseSynced(): Promise<{
    snapshotId: string;
    count: number;
    source: string;
  }> {
    const latest = await this.snapshots.find({
      order: { createdAt: 'DESC' },
      take: 1,
    });
    if (latest[0]) {
      const ageMs = Date.now() - new Date(latest[0].createdAt).getTime();
      if (ageMs < 24 * 60 * 60 * 1000) {
        return {
          snapshotId: latest[0].id,
          count: latest[0].symbolCount,
          source: latest[0].source,
        };
      }
    }
    return this.syncEquityMaster();
  }

  async getUniverseFromDb(): Promise<UniverseStock[] | null> {
    const latest = await this.snapshots.find({
      order: { createdAt: 'DESC' },
      take: 1,
    });
    if (!latest[0]) {
      return null;
    }
    const rows = await this.symbols.find({
      where: { snapshotId: latest[0].id },
    });
    if (rows.length === 0) {
      return null;
    }
    return rows.map((r) => ({
      symbol: r.symbol,
      yahooSymbol: r.yahooSymbol,
      companyName: r.companyName,
      sector: r.sector,
      series: r.series,
      isin: r.isin,
    }));
  }

  async syncEquityMaster(): Promise<{
    snapshotId: string;
    count: number;
    source: string;
  }> {
    await warmNseSession();
    let csv = '';
    let source = '';
    for (const url of EQUITY_LIST_URLS) {
      try {
        const res = await nseFetch(url);
        if (!res.ok) {
          this.logger.warn(`Equity list ${url} → HTTP ${res.status}`);
          continue;
        }
        csv = await res.text();
        if (csv.includes('SYMBOL') || csv.includes('Symbol')) {
          source = url;
          break;
        }
      } catch (error) {
        this.logger.warn(
          `Equity list fetch failed ${url}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (!csv) {
      throw new Error('Failed to download NSE EQUITY_L.csv');
    }

    const parsed = parseEquityListCsv(csv);
    const asOf = new Date().toISOString().slice(0, 10);
    const snap = await this.snapshots.save(
      this.snapshots.create({
        asOf,
        source,
        symbolCount: parsed.length,
      }),
    );
    const chunkSize = 500;
    for (let i = 0; i < parsed.length; i += chunkSize) {
      const chunk = parsed.slice(i, i + chunkSize).map((p) =>
        this.symbols.create({
          snapshotId: snap.id,
          symbol: p.symbol,
          yahooSymbol: `${p.symbol}.NS`,
          companyName: p.companyName,
          sector: p.sector,
          series: p.series,
          isin: p.isin,
        }),
      );
      await this.symbols.save(chunk);
    }
    this.logger.log(`Synced NSE equity master: ${parsed.length} symbols`);
    return { snapshotId: snap.id, count: parsed.length, source };
  }

  /**
   * Ensure bhav history depth + freshness for ranking/ADTV.
   * Requires ≥ `lookbackSessions` distinct trade dates and a latest session
   * newer than {@link BHAV_MAX_AGE_DAYS}. Fills gaps (skip existing days).
   */
  async ensureBhavSynced(lookbackSessions = 30): Promise<{
    tradeDate: string | null;
    rows: number;
    sessions: number;
  }> {
    const minSessions = Math.max(1, Math.floor(lookbackSessions));
    const latestBefore = await this.getLatestBhavDate();
    const sessionsBefore = await this.countDistinctTradeDates();
    const satisfiedBefore = isBhavSyncSatisfied({
      distinctSessions: sessionsBefore,
      latestTradeDate: latestBefore,
      minSessions,
      maxAgeDays: BHAV_MAX_AGE_DAYS,
    });

    // Always walk newest weekday candidates until we confirm minSessions
    // (existing or newly downloaded). That fills 1–2 day gaps without
    // re-downloading days already in the DB.
    const candidates = recentTradeDateCandidates(
      new Date(),
      bhavCandidateCount(minSessions),
    );
    const candidateDates = candidates.map((d) => d.toISOString().slice(0, 10));
    const existingSet = await this.getExistingTradeDates(candidateDates);

    let confirmed = 0;
    let downloaded = 0;
    let warmed = false;

    for (let i = 0; i < candidates.length; i++) {
      if (confirmed >= minSessions) {
        break;
      }
      const day = candidates[i];
      const tradeDate = candidateDates[i];
      if (existingSet.has(tradeDate)) {
        confirmed += 1;
        continue;
      }
      if (!warmed) {
        await warmNseSession();
        warmed = true;
      }
      const ymd = formatNseDate(day);
      try {
        const n = await this.downloadAndStoreBhav(ymd, tradeDate);
        if (n > 0) {
          existingSet.add(tradeDate);
          confirmed += 1;
          downloaded += 1;
        }
      } catch (error) {
        this.logger.warn(
          `Bhav ${ymd} skipped: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const tradeDate = await this.getLatestBhavDate();
    const sessions = await this.countDistinctTradeDates();
    const rows = tradeDate
      ? await this.bhav.count({ where: { tradeDate } })
      : 0;
    const satisfied = isBhavSyncSatisfied({
      distinctSessions: sessions,
      latestTradeDate: tradeDate,
      minSessions,
      maxAgeDays: BHAV_MAX_AGE_DAYS,
    });

    this.logger.log(
      `Bhav sync: sessions=${sessions}/${minSessions} latest=${tradeDate ?? 'null'} downloaded=${downloaded} rows=${rows} ready=${satisfied}${satisfiedBefore && downloaded === 0 ? ' (noop)' : ''}`,
    );

    return { tradeDate, rows, sessions };
  }

  async getLatestBhavDate(): Promise<string | null> {
    const latest = await this.bhav
      .createQueryBuilder('b')
      .select('MAX(b.trade_date)', 'max')
      .getRawOne<{ max: string | Date | null }>();
    if (latest?.max == null) {
      return null;
    }
    const key = toTradeDateKey(latest.max);
    return key || null;
  }

  private async countDistinctTradeDates(): Promise<number> {
    const raw = await this.bhav
      .createQueryBuilder('b')
      .select('COUNT(DISTINCT b.trade_date)', 'n')
      .getRawOne<{ n: string | number | null }>();
    const n = Number(raw?.n ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  private async getExistingTradeDates(
    dates: string[],
  ): Promise<Set<string>> {
    if (dates.length === 0) {
      return new Set();
    }
    const rows = await this.bhav
      .createQueryBuilder('b')
      .select('DISTINCT b.trade_date', 'd')
      .where('b.trade_date IN (:...dates)', { dates })
      .getRawMany<{ d: string | Date }>();
    return new Set(
      rows.map((r) => toTradeDateKey(r.d)).filter((d) => d.length > 0),
    );
  }

  /** Average traded value over last N available sessions per symbol. */
  async getAdtvMap(
    symbols: string[],
    lookback: number,
  ): Promise<Map<string, number>> {
    if (symbols.length === 0) {
      return new Map();
    }
    const dates = await this.getRecentTradeDates(lookback);
    if (dates.length === 0) {
      return new Map();
    }

    const rows = await this.bhav
      .createQueryBuilder('b')
      .where('b.trade_date IN (:...dates)', { dates })
      .andWhere('b.symbol IN (:...symbols)', { symbols })
      .getMany();

    const sums = new Map<string, { sum: number; n: number }>();
    for (const row of rows) {
      const val = Number(row.tradedValue);
      if (!Number.isFinite(val)) {
        continue;
      }
      const cur = sums.get(row.symbol) ?? { sum: 0, n: 0 };
      cur.sum += val;
      cur.n += 1;
      sums.set(row.symbol, cur);
    }
    const out = new Map<string, number>();
    for (const [symbol, { sum, n }] of sums) {
      if (n > 0) {
        out.set(symbol, sum / n);
      }
    }
    return out;
  }

  /**
   * Close series per symbol, oldest → newest, over the last `lookback` sessions.
   */
  async getCloseSeriesMap(
    symbols: string[],
    lookback: number,
  ): Promise<Map<string, number[]>> {
    if (symbols.length === 0) {
      return new Map();
    }
    const dates = await this.getRecentTradeDates(lookback);
    if (dates.length === 0) {
      return new Map();
    }
    const dateOrder = new Map(dates.map((d, i) => [d, i]));
    // dates are DESC from query — reverse to oldest→newest
    const ascDates = [...dates].reverse();

    const rows = await this.bhav
      .createQueryBuilder('b')
      .where('b.trade_date IN (:...dates)', { dates })
      .andWhere('b.symbol IN (:...symbols)', { symbols })
      .getMany();

    const buckets = new Map<string, Array<{ i: number; close: number }>>();
    for (const row of rows) {
      const close = Number(row.close);
      if (!Number.isFinite(close)) continue;
      const tradeKey = toTradeDateKey(row.tradeDate);
      const di = dateOrder.get(tradeKey);
      if (di == null) continue;
      // di is index in DESC list; convert to ASC index
      const ascI = dates.length - 1 - di;
      const list = buckets.get(row.symbol) ?? [];
      list.push({ i: ascI, close });
      buckets.set(row.symbol, list);
    }

    const out = new Map<string, number[]>();
    for (const [symbol, pts] of buckets) {
      pts.sort((a, b) => a.i - b.i);
      const series = new Array<number>(ascDates.length).fill(NaN);
      for (const p of pts) {
        series[p.i] = p.close;
      }
      // Compact: keep only finite consecutive from the end
      const compact = series.filter((n) => Number.isFinite(n));
      if (compact.length > 0) {
        out.set(symbol, compact);
      }
    }
    return out;
  }

  private async getRecentTradeDates(lookback: number): Promise<string[]> {
    const datesRaw = await this.bhav
      .createQueryBuilder('b')
      .select('DISTINCT b.trade_date', 'd')
      .orderBy('b.trade_date', 'DESC')
      .limit(lookback)
      .getRawMany<{ d: string | Date }>();
    return datesRaw
      .map((r) => toTradeDateKey(r.d))
      .filter((d) => d.length > 0);
  }

  async getBhavRowsForDate(
    tradeDate: string,
  ): Promise<Map<string, MarketBhavDaily>> {
    const key = toTradeDateKey(tradeDate);
    const rows = await this.bhav.find({ where: { tradeDate: key } });
    return new Map(rows.map((r) => [r.symbol, r]));
  }

  private async downloadAndStoreBhav(
    ymd: string,
    tradeDate: string,
  ): Promise<number> {
    const url = bhavZipUrl(ymd);
    const res = await nseFetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const csv = unzipToCsv(buf);
    const parsed = parseBhavCsv(csv);
    if (parsed.length === 0) {
      const headerPreview = csv
        .split(/\r?\n/)
        .find((l) => l.trim())
        ?.slice(0, 180);
      throw new Error(
        `empty bhav parse (csvBytes=${csv.length}, header=${headerPreview ?? 'none'})`,
      );
    }
    const chunkSize = 500;
    for (let i = 0; i < parsed.length; i += chunkSize) {
      const chunk = parsed.slice(i, i + chunkSize).map((p) =>
        this.bhav.create({
          tradeDate,
          symbol: p.symbol,
          open: p.open != null ? String(p.open) : null,
          high: p.high != null ? String(p.high) : null,
          low: p.low != null ? String(p.low) : null,
          close: String(p.close),
          prevClose: p.prevClose != null ? String(p.prevClose) : null,
          volume: String(Math.floor(p.volume)),
          tradedValue: String(p.tradedValue),
        }),
      );
      await this.bhav.upsert(chunk, {
        conflictPaths: ['tradeDate', 'symbol'],
      });
    }
    this.logger.log(`Stored bhav ${tradeDate}: ${parsed.length} rows`);
    return parsed.length;
  }
}

function unzipToCsv(zipBuf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'nse-bhav-'));
  try {
    const zipPath = join(dir, 'bhav.zip');
    writeFileSync(zipPath, zipBuf);
    mkdirSync(join(dir, 'out'));
    // Skip macOS AppleDouble side-files (._*) — they also end in .csv and parse empty.
    execFileSync(
      'unzip',
      ['-o', zipPath, '-d', join(dir, 'out'), '-x', '*/._*', '._*'],
      { stdio: 'pipe' },
    );
    const { readdirSync, statSync } = require('fs') as typeof import('fs');
    const files = readdirSync(join(dir, 'out'))
      .filter(
        (f) =>
          f.toLowerCase().endsWith('.csv') &&
          !f.startsWith('._') &&
          !f.startsWith('.'),
      )
      .sort(
        (a, b) =>
          statSync(join(dir, 'out', b)).size -
          statSync(join(dir, 'out', a)).size,
      );
    if (files.length === 0) {
      throw new Error('no csv in zip');
    }
    return readFileSync(join(dir, 'out', files[0]), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function parseEquityListCsv(csv: string): Array<{
  symbol: string;
  companyName: string;
  series: string;
  isin: string | null;
  sector: string;
}> {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return [];
  }
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toUpperCase());
  const idx = (name: string) => header.indexOf(name);
  const iSym = idx('SYMBOL');
  const iName = idx('NAME OF COMPANY') >= 0 ? idx('NAME OF COMPANY') : idx('NAME');
  const iSeries = idx('SERIES');
  const iIsin = idx('ISIN NUMBER') >= 0 ? idx('ISIN NUMBER') : idx('ISIN');
  if (iSym < 0) {
    return [];
  }
  const out: Array<{
    symbol: string;
    companyName: string;
    series: string;
    isin: string | null;
    sector: string;
  }> = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const symbol = (cols[iSym] ?? '').trim().toUpperCase();
    const series = (iSeries >= 0 ? cols[iSeries] : 'EQ')?.trim().toUpperCase() ?? 'EQ';
    if (!symbol || series !== 'EQ') {
      continue;
    }
    // Skip obvious non-equities by name patterns
    const companyName = (iName >= 0 ? cols[iName] : symbol)?.trim() || symbol;
    const upper = companyName.toUpperCase();
    if (
      upper.includes('ETF') ||
      upper.includes('REIT') ||
      upper.includes('INVIT') ||
      upper.includes('MUTUAL FUND')
    ) {
      continue;
    }
    out.push({
      symbol,
      companyName,
      series,
      isin: iIsin >= 0 ? cols[iIsin]?.trim() || null : null,
      sector: 'Unknown',
    });
  }
  return out;
}
