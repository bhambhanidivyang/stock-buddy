/** Parse NSE CM bhav CSV (UCC or legacy headers). */

export type BhavRow = {
  symbol: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  prevClose: number | null;
  volume: number;
  tradedValue: number;
};

const EQUITY_SERIES = new Set(['EQ', 'BE', 'SM', 'ST', 'BZ', 'IV']);

export function parseBhavCsv(csv: string): BhavRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return [];
  }
  const header = splitCsvLine(lines[0]).map((h) =>
    h.replace(/^\uFEFF/, '').trim().toUpperCase(),
  );
  const find = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) {
        return i;
      }
    }
    return -1;
  };

  // UCC camelCase uppercases to …PRIC (not …PRC): OpnPric→OPNPRIC, ClsPric→CLSPRIC
  // Legacy: SYMBOL, SERIES, OPEN, HIGH, LOW, CLOSE, PREVCLOSE, TOTTRDQTY, TOTTRDVAL
  const iSym = find('TCKRSYMB', 'SYMBOL');
  const iSeries = find('SCTYSRS', 'SCTYSRIS', 'SERIES');
  const iInstr = find('FININSTRMTP');
  const iOpen = find('OPNPRIC', 'OPNPRC', 'OPEN');
  const iHigh = find('HGHPRIC', 'HGHPRC', 'HIGH');
  const iLow = find('LWPRIC', 'LWPRC', 'LOW');
  const iClose = find('CLSPRIC', 'CLSPRC', 'CLOSE', 'LASTPRIC');
  const iPrev = find(
    'PRVSCLSGPPRIC',
    'PRVSCLSPRC',
    'PREVCLOSE',
    'PREV_CLOSE',
  );
  const iVol = find('TTLTRADGVOL', 'TTLTRDQTY', 'TOTTRDQTY', 'VOLUME');
  const iVal = find('TTLTRFVAL', 'TTLTRDVAL', 'TOTTRDVAL', 'TURNOVER');

  if (iSym < 0 || iClose < 0) {
    return [];
  }

  const out: BhavRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const symbol = (cols[iSym] ?? '').trim().toUpperCase();
    if (!symbol) {
      continue;
    }

    const series =
      iSeries >= 0 ? (cols[iSeries] ?? '').trim().toUpperCase() : '';
    const instr =
      iInstr >= 0 ? (cols[iInstr] ?? '').trim().toUpperCase() : '';

    // Prefer cash equities; never keep obvious non-equity series (GB bonds, etc.)
    if (iInstr >= 0 && instr && instr !== 'STK') {
      continue;
    }
    if (iSeries >= 0 && series && !EQUITY_SERIES.has(series)) {
      continue;
    }

    const close = Number(cols[iClose]);
    if (!Number.isFinite(close) || close <= 0) {
      continue;
    }

    out.push({
      symbol,
      open: iOpen >= 0 ? numOrNull(cols[iOpen]) : null,
      high: iHigh >= 0 ? numOrNull(cols[iHigh]) : null,
      low: iLow >= 0 ? numOrNull(cols[iLow]) : null,
      close,
      prevClose: iPrev >= 0 ? numOrNull(cols[iPrev]) : null,
      volume: iVol >= 0 ? Math.floor(Number(cols[iVol]) || 0) : 0,
      tradedValue: iVal >= 0 ? Number(cols[iVal]) || 0 : 0,
    });
  }
  return out;
}

function numOrNull(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}
