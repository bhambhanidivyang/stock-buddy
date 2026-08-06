/**
 * Seeds 10 filled trades across 4 IST days for GET /statement grouping.
 * Usage: npx ts-node -r tsconfig-paths/register scripts/seed-statement-test.ts
 *
 * Clears prior seed rows (ai_raw/context_snapshot contain { seed: true }).
 */
import { AppDataSource } from '../src/database/data-source';
import {
  Account,
  ExecutionSession,
  RecommendationItem,
  RecommendationRun,
  Trade,
} from '../src/database/entities';
import {
  ExecutionSessionStatus,
  ExecutionStopReason,
  MarketSession,
  RecommendationItemRole,
  RecommendationRunStatus,
  TradeExitReason,
  TradeStatus,
} from '../src/database/enums';

/** IST calendar day + clock → UTC Date (IST = UTC+5:30). */
function ist(day: string, hour: number, minute = 0): Date {
  const [y, m, d] = day.split('-').map(Number);
  // noon trick avoided: build as UTC then subtract 5:30
  const utcMs = Date.UTC(y, m - 1, d, hour, minute) - (5 * 60 + 30) * 60 * 1000;
  return new Date(utcMs);
}

type SeedTrade = {
  symbol: string;
  qty: number;
  role: RecommendationItemRole;
  buyDay: string;
  sellDay: string;
  investedInr: number;
  realizedPnl: number;
};

/** 10 fills spanning 4 IST days (some sell on a later day). */
const SEED_TRADES: SeedTrade[] = [
  // 2026-07-29
  {
    symbol: 'ITC',
    qty: 4,
    role: RecommendationItemRole.HEDGE,
    buyDay: '2026-07-29',
    sellDay: '2026-07-29',
    investedInr: 1000,
    realizedPnl: 100,
  },
  {
    symbol: 'RELIANCE',
    qty: 5,
    role: RecommendationItemRole.PRIMARY,
    buyDay: '2026-07-29',
    sellDay: '2026-07-30', // P/L lands next day
    investedInr: 2000,
    realizedPnl: 50,
  },
  {
    symbol: 'TCS',
    qty: 2,
    role: RecommendationItemRole.PRIMARY,
    buyDay: '2026-07-29',
    sellDay: '2026-07-29',
    investedInr: 3000,
    realizedPnl: -80,
  },
  // 2026-07-30
  {
    symbol: 'INFY',
    qty: 6,
    role: RecommendationItemRole.PRIMARY,
    buyDay: '2026-07-30',
    sellDay: '2026-07-30',
    investedInr: 1500,
    realizedPnl: 120,
  },
  {
    symbol: 'HDFCBANK',
    qty: 3,
    role: RecommendationItemRole.HEDGE,
    buyDay: '2026-07-30',
    sellDay: '2026-07-31',
    investedInr: 2500,
    realizedPnl: 75,
  },
  // 2026-07-31
  {
    symbol: 'SBIN',
    qty: 10,
    role: RecommendationItemRole.PRIMARY,
    buyDay: '2026-07-31',
    sellDay: '2026-07-31',
    investedInr: 1800,
    realizedPnl: 40,
  },
  {
    symbol: 'WIPRO',
    qty: 8,
    role: RecommendationItemRole.HEDGE,
    buyDay: '2026-07-31',
    sellDay: '2026-07-31',
    investedInr: 900,
    realizedPnl: -30,
  },
  {
    symbol: 'AXISBANK',
    qty: 4,
    role: RecommendationItemRole.PRIMARY,
    buyDay: '2026-07-31',
    sellDay: '2026-08-01',
    investedInr: 2200,
    realizedPnl: 90,
  },
  // 2026-08-01
  {
    symbol: 'ICICIBANK',
    qty: 7,
    role: RecommendationItemRole.PRIMARY,
    buyDay: '2026-08-01',
    sellDay: '2026-08-01',
    investedInr: 2800,
    realizedPnl: 60,
  },
  {
    symbol: 'BHARTIARTL',
    qty: 9,
    role: RecommendationItemRole.HEDGE,
    buyDay: '2026-08-01',
    sellDay: '2026-08-01',
    investedInr: 1600,
    realizedPnl: 25,
  },
];

function expectedStatement() {
  type Row = {
    date: string;
    buyAmount: number;
    sellAmount: number;
    profitLoss: number;
    buys: Map<string, number>;
  };
  const byDay = new Map<string, Row>();

  const touch = (day: string) => {
    let row = byDay.get(day);
    if (!row) {
      row = {
        date: day,
        buyAmount: 0,
        sellAmount: 0,
        profitLoss: 0,
        buys: new Map(),
      };
      byDay.set(day, row);
    }
    return row;
  };

  for (const t of SEED_TRADES) {
    const buy = touch(t.buyDay);
    buy.buyAmount += t.investedInr;
    buy.buys.set(t.symbol, (buy.buys.get(t.symbol) ?? 0) + t.qty);

    const sell = touch(t.sellDay);
    sell.sellAmount += t.investedInr + t.realizedPnl;
    sell.profitLoss += t.realizedPnl;
  }

  return [...byDay.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((row) => ({
      date: row.date,
      buyAmount: row.buyAmount,
      sellAmount: row.sellAmount,
      profitLoss: row.profitLoss,
      stocksBought: [...row.buys.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([symbol, qty]) => `${qty}x${symbol}`)
        .join(', '),
    }));
}

async function clearPreviousSeed() {
  await AppDataSource.query(`
    DELETE FROM trades
    WHERE recommendation_item_id IN (
      SELECT ri.id
      FROM recommendation_items ri
      JOIN recommendation_runs rr ON rr.id = ri.recommendation_run_id
      WHERE rr.model = 'seed'
    )
  `);
  await AppDataSource.query(`
    DELETE FROM execution_sessions
    WHERE recommendation_run_id IN (
      SELECT id FROM recommendation_runs WHERE model = 'seed'
    )
  `);
  await AppDataSource.query(`
    DELETE FROM recommendation_items
    WHERE recommendation_run_id IN (
      SELECT id FROM recommendation_runs WHERE model = 'seed'
    )
  `);
  await AppDataSource.query(`
    DELETE FROM recommendation_runs WHERE model = 'seed'
  `);
}

async function main() {
  await AppDataSource.initialize();

  const accounts = AppDataSource.getRepository(Account);
  const runs = AppDataSource.getRepository(RecommendationRun);
  const items = AppDataSource.getRepository(RecommendationItem);
  const sessions = AppDataSource.getRepository(ExecutionSession);
  const trades = AppDataSource.getRepository(Trade);

  const account = await accounts.findOne({ where: { name: 'default' } });
  if (!account) {
    throw new Error('default account missing — run migrations first');
  }

  await clearPreviousSeed();

  const totalAllocated = SEED_TRADES.reduce((s, t) => s + t.investedInr, 0);
  const totalPnl = SEED_TRADES.reduce((s, t) => s + t.realizedPnl, 0);
  const marketTs = ist('2026-08-01', 9, 15);

  const run = await runs.save(
    runs.create({
      accountId: account.id,
      status: RecommendationRunStatus.COMPLETED,
      marketTs,
      marketSession: MarketSession.OPEN,
      availableCash: '100000.00',
      portfolioSummary: 'Seed plan: 10 trades / 4 IST days',
      totalAllocatedInr: totalAllocated.toFixed(2),
      cashReservedInr: (100000 - totalAllocated).toFixed(2),
      contextSnapshot: { seed: true },
      aiRaw: { seed: true },
      model: 'seed',
    }),
  );

  const session = await sessions.save(
    sessions.create({
      accountId: account.id,
      recommendationRunId: run.id,
      status: ExecutionSessionStatus.COMPLETED,
      startedAt: ist('2026-07-29', 9, 20),
      stoppedAt: ist('2026-08-01', 15, 30),
      stopReason: ExecutionStopReason.ALL_CLOSED,
    }),
  );

  for (const [index, t] of SEED_TRADES.entries()) {
    const buyAt = ist(t.buyDay, 10, index);
    const sellAt = ist(t.sellDay, 14, index);
    const buyPrice = t.investedInr / t.qty;
    const sellPrice = (t.investedInr + t.realizedPnl) / t.qty;

    const item = await items.save(
      items.create({
        recommendationRunId: run.id,
        symbol: t.symbol,
        qty: t.qty,
        allocationInr: t.investedInr.toFixed(2),
        buyLow: (buyPrice * 0.98).toFixed(4),
        buyHigh: (buyPrice * 1.02).toFixed(4),
        sellTarget: (sellPrice * 1.01).toFixed(4),
        stopLoss: (buyPrice * 0.95).toFixed(4),
        role: t.role,
        summary: `Seed ${t.symbol}`,
        sortOrder: index,
      }),
    );

    await trades.save(
      trades.create({
        accountId: account.id,
        recommendationItemId: item.id,
        executionSessionId: session.id,
        symbol: t.symbol,
        qty: t.qty,
        role: t.role,
        buyLow: item.buyLow,
        buyHigh: item.buyHigh,
        sellTarget: item.sellTarget,
        stopLoss: item.stopLoss,
        summary: item.summary,
        status: TradeStatus.CLOSED,
        exitReason:
          t.realizedPnl >= 0 ? TradeExitReason.TARGET : TradeExitReason.STOP,
        buyPrice: buyPrice.toFixed(4),
        buyAt,
        sellPrice: sellPrice.toFixed(4),
        sellAt,
        investedInr: t.investedInr.toFixed(2),
        proceedsInr: (t.investedInr + t.realizedPnl).toFixed(2),
        realizedPnl: t.realizedPnl.toFixed(2),
      }),
    );
  }

  account.cash = (100000 + totalPnl).toFixed(2);
  account.realizedPnl = totalPnl.toFixed(2);
  await accounts.save(account);

  console.log(
    JSON.stringify(
      {
        ok: true,
        tradeCount: SEED_TRADES.length,
        days: 4,
        accountId: account.id,
        recommendationRunId: run.id,
        expectedStatement: expectedStatement(),
      },
      null,
      2,
    ),
  );

  await AppDataSource.destroy();
}

main().catch(async (err) => {
  console.error(err);
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
  process.exit(1);
});
