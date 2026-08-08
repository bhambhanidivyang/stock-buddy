import { Logger } from '@nestjs/common';
import { AiRecommendationPick } from '../ai/recommendation.schema';
import {
  loadRecommendationConfig,
  type RecommendationConfig,
} from '../config/recommendation.config';
import { roundMoney } from '../common/money';
import type { SuggestedLevels } from '../market/features/candidate.types';
import { MIN_BUYABLE_STRUCTURAL_RR } from '../market/levels/candidate-status';
import { normalizeNseSymbol } from '../market/symbols';

const logger = new Logger('PickValidator');

export type CandidateQuote = {
  symbol: string;
  price: number;
  volume: number | null;
  sector?: string;
};

export type ValidatorRejection = {
  symbol: string;
  reason: string;
};

export type NormalizePicksResult = {
  picks: AiRecommendationPick[];
  rejected: ValidatorRejection[];
};

export type NormalizePicksOptions = {
  config?: RecommendationConfig;
  levelsBySymbol?: Map<string, SuggestedLevels>;
  minVolume?: number;
};

/**
 * Validate picks, enforce size/sector/RR, and require levels match suggestedLevels.
 */
export function normalizePicks(
  picks: AiRecommendationPick[],
  availableCash: number,
  allowedSymbols: Set<string>,
  quotesBySymbol: Map<string, CandidateQuote>,
  options: NormalizePicksOptions = {},
): NormalizePicksResult {
  const config = options.config ?? loadRecommendationConfig();
  const levelsBySymbol = options.levelsBySymbol ?? new Map();
  const minVolume = options.minVolume ?? 100_000;

  if (!Array.isArray(picks) || picks.length === 0) {
    return { picks: [], rejected: [] };
  }

  const rejected: ValidatorRejection[] = [];
  const pushReject = (symbol: string, reason: string) => {
    logger.warn(`Skipping ${symbol}: ${reason}`);
    if (!rejected.some((r) => r.symbol === symbol)) {
      rejected.push({ symbol, reason });
    }
  };

  const maxAlloc = roundMoney(availableCash * config.maxAllocPct);
  const minAlloc = roundMoney(availableCash * config.minAllocPct);

  const merged = new Map<string, AiRecommendationPick>();

  for (const pick of picks) {
    const symbol = normalizeNseSymbol(pick.symbol);
    if (!symbol || !allowedSymbols.has(symbol)) {
      pushReject(
        symbol || String(pick.symbol ?? '?'),
        'unknown or out-of-universe symbol',
      );
      continue;
    }

    const suggested = levelsBySymbol.get(symbol);
    if (!suggested) {
      pushReject(symbol, 'no suggestedLevels for symbol');
      continue;
    }

    // Force deterministic levels (AI must not invent)
    const buyLow = suggested.buyLow;
    const buyHigh = suggested.buyHigh;
    const sellTarget = suggested.sellTarget;
    const stopLoss = suggested.stopLoss;

    const qty = Math.floor(Number(pick.qty));
    if (!Number.isFinite(qty) || qty <= 0) {
      pushReject(symbol, 'invalid qty');
      continue;
    }

    // Geometry + RR always at worst-case fill (buyHigh) — Structure+ATR contract.
    if (!(stopLoss < buyLow && buyLow < buyHigh && buyHigh < sellTarget)) {
      pushReject(
        symbol,
        `need stop < buyLow < buyHigh < target (stop=${stopLoss} band=${buyLow}-${buyHigh} target=${sellTarget})`,
      );
      continue;
    }

    const risk = buyHigh - stopLoss;
    const reward = sellTarget - buyHigh;
    const rr = risk > 0 ? reward / risk : 0;
    // Soft structural floor only — green/amber RR are quality signals, not hard gates.
    const minRr = MIN_BUYABLE_STRUCTURAL_RR;
    if (!(risk > 0) || rr < minRr - 0.01) {
      pushReject(
        symbol,
        `risk/reward @buyHigh ${rr.toFixed(2)}:1 < ${minRr}:1 soft floor`,
      );
      continue;
    }

    const mid = (buyLow + buyHigh) / 2;

    const quote = quotesBySymbol.get(symbol);
    if (quote) {
      if (quote.price > buyHigh + config.levelsPriceTolerance) {
        pushReject(
          symbol,
          `stale band — LTP ${quote.price} > buyHigh ${buyHigh}`,
        );
        continue;
      }
      if (quote.volume != null && quote.volume < minVolume) {
        pushReject(symbol, `low volume ${quote.volume} < ${minVolume}`);
        continue;
      }
    }

    const allocationInr = roundMoney(
      Number.isFinite(pick.allocationInr) && pick.allocationInr > 0
        ? pick.allocationInr
        : qty * mid,
    );

    const convictionRank = Number.isFinite(Number(pick.convictionRank))
      ? Math.max(1, Math.floor(Number(pick.convictionRank)))
      : 99;

    const next: AiRecommendationPick = {
      symbol,
      qty,
      allocationInr,
      buyLow,
      buyHigh,
      sellTarget,
      stopLoss,
      role: pick.role === 'HEDGE' ? 'HEDGE' : 'PRIMARY',
      summary:
        pick.summary?.trim() || `Selected ${symbol} from live context.`,
      convictionRank,
    };

    const existing = merged.get(symbol);
    if (existing) {
      merged.set(symbol, {
        ...existing,
        qty: existing.qty + next.qty,
        allocationInr: roundMoney(existing.allocationInr + next.allocationInr),
        convictionRank: Math.min(existing.convictionRank, next.convictionRank),
        summary: `${existing.summary} | Merged duplicate pick: ${next.summary}`,
      });
      logger.warn(`Merged duplicate plan symbol ${symbol}`);
    } else {
      merged.set(symbol, next);
    }
  }

  const sectorCounts = new Map<string, number>();
  const cashFit: AiRecommendationPick[] = [];
  let allocated = 0;

  const ordered = [...merged.values()].sort(
    (a, b) => a.convictionRank - b.convictionRank,
  );

  for (const pick of ordered) {
    const sector = quotesBySymbol.get(pick.symbol)?.sector ?? 'Unknown';
    const sectorCount = sectorCounts.get(sector) ?? 0;
    if (sectorCount >= config.maxPerSector) {
      pushReject(
        pick.symbol,
        `sector ${sector} already has ${config.maxPerSector} picks`,
      );
      continue;
    }

    const mid = (pick.buyLow + pick.buyHigh) / 2;
    if (mid <= 0) {
      pushReject(pick.symbol, 'invalid mid price');
      continue;
    }

    let { qty, allocationInr } = pick;

    if (allocationInr > maxAlloc) {
      const cappedQty = Math.floor(maxAlloc / mid);
      if (cappedQty <= 0) {
        pushReject(
          pick.symbol,
          `cannot fit under max ${config.maxAllocPct * 100}% cap`,
        );
        continue;
      }
      qty = cappedQty;
      allocationInr = roundMoney(qty * mid);
      logger.warn(
        `Capped ${pick.symbol} to max ${config.maxAllocPct * 100}% → ${allocationInr}`,
      );
    }

    if (allocated + allocationInr > availableCash) {
      const remaining = roundMoney(availableCash - allocated);
      if (remaining < mid) {
        pushReject(pick.symbol, 'insufficient remaining cash');
        continue;
      }
      qty = Math.floor(remaining / mid);
      if (qty <= 0) {
        pushReject(pick.symbol, 'insufficient remaining cash');
        continue;
      }
      allocationInr = roundMoney(qty * mid);
    }

    if (allocationInr < minAlloc) {
      pushReject(
        pick.symbol,
        `allocation ${allocationInr} < min ${config.minAllocPct * 100}% (${minAlloc})`,
      );
      continue;
    }

    cashFit.push({ ...pick, qty, allocationInr });
    allocated = roundMoney(allocated + allocationInr);
    sectorCounts.set(sector, sectorCount + 1);
  }

  if (config.fullCashDeploy && cashFit.length > 0) {
    deployRemainingCash(cashFit, availableCash, maxAlloc, config);
    allocated = roundMoney(
      cashFit.reduce((sum, p) => sum + p.allocationInr, 0),
    );
    const leftover = roundMoney(availableCash - allocated);
    const leftoverLimit = Math.max(
      config.maxCashLeftoverInr,
      roundMoney(availableCash * config.maxCashLeftoverPct),
    );
    if (leftover > leftoverLimit) {
      logger.warn(
        `Full-cash deploy still left ₹${leftover} idle (limit ₹${leftoverLimit}). Need more names or higher maxAlloc — picks=${cashFit.length}`,
      );
    } else {
      logger.log(
        `Full-cash deploy: allocated=₹${allocated} leftover=₹${leftover} picks=${cashFit.length}`,
      );
    }
  }

  return {
    picks: cashFit.map((pick, index) => ({
      ...pick,
      convictionRank: index + 1,
    })),
    rejected,
  };
}

/**
 * Greedily add shares (conviction order) until cash can't buy another lot
 * without breaching per-name maxAlloc.
 */
function deployRemainingCash(
  picks: AiRecommendationPick[],
  availableCash: number,
  maxAlloc: number,
  config: RecommendationConfig,
): void {
  const maxSteps = 50_000;
  for (let step = 0; step < maxSteps; step += 1) {
    const allocated = roundMoney(
      picks.reduce((sum, p) => sum + p.allocationInr, 0),
    );
    const remaining = roundMoney(availableCash - allocated);
    if (remaining <= 0) {
      return;
    }

    const ordered = [...picks].sort(
      (a, b) => a.convictionRank - b.convictionRank,
    );
    let progressed = false;
    for (const pick of ordered) {
      const mid = (pick.buyLow + pick.buyHigh) / 2;
      if (!(mid > 0) || remaining < mid) {
        continue;
      }
      const headroom = roundMoney(maxAlloc - pick.allocationInr);
      if (headroom < mid) {
        continue;
      }
      const addQty = Math.min(
        Math.floor(remaining / mid),
        Math.floor(headroom / mid),
      );
      if (addQty <= 0) {
        continue;
      }
      pick.qty += addQty;
      pick.allocationInr = roundMoney(pick.qty * mid);
      progressed = true;
      break;
    }
    if (!progressed) {
      return;
    }
  }
  logger.warn(
    `deployRemainingCash hit step cap (maxAllocPct=${config.maxAllocPct})`,
  );
}
