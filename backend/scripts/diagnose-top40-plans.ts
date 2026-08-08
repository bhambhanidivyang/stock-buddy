/**
 * Board-only Top-40 trade-plan diagnostics (no AI, no DB recommendation write).
 * Usage: npx ts-node -r tsconfig-paths/register scripts/diagnose-top40-plans.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { loadRecommendationConfig } from '../src/config/recommendation.config';
import { MarketFeatureEngine } from '../src/market/features/market-feature.engine';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const engine = app.get(MarketFeatureEngine);
    const config = loadRecommendationConfig();
    const board = await engine.buildBoard(config);
    const buyable = board.shortlistOutcomes.filter((o) => o.status === 'BUYABLE');
    const watch = board.shortlistOutcomes.filter((o) => o.status === 'WATCH');
    const red = board.shortlistOutcomes.filter((o) => o.status === 'RED');

    console.log('\n=== Top 40 status ===');
    console.log(
      JSON.stringify(
        {
          shortlisted: board.pipelineFunnel.prioritized,
          BUYABLE: buyable.length,
          WATCH: watch.length,
          RED: red.length,
          sentToAi: board.pipelineFunnel.sentToAi,
          funnel: board.pipelineFunnel.summary,
        },
        null,
        2,
      ),
    );

    const watchReasons = new Map<string, number>();
    for (const o of watch) {
      const code = o.reasonCode ?? 'OTHER';
      watchReasons.set(code, (watchReasons.get(code) ?? 0) + 1);
    }
    console.log('\n=== WATCH reasons ===');
    console.log(
      [...watchReasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}=${v}`)
        .join(' | ') || '(none)',
    );

    console.log('\n=== BUYABLE ===');
    for (const o of buyable) {
      console.log(
        `${o.symbol} entry=${o.buyLow}-${o.buyHigh} stop=${o.stopLoss} tgt=${o.sellTarget} RR=${o.riskReward} setup=${o.setupType}`,
      );
    }

    console.log('\n=== STOP_TOO_WIDE samples (up to 8) ===');
    for (const o of watch.filter((x) => x.reasonCode === 'STOP_TOO_WIDE').slice(0, 8)) {
      console.log(`${o.symbol}: ${o.reason}`);
    }

    console.log('\n=== NO_VALID_ENTRY / ENTRY_TOO_EXTENDED counts ===');
    console.log(
      `NO_VALID_ENTRY=${watchReasons.get('NO_VALID_ENTRY') ?? 0} ENTRY_TOO_EXTENDED=${watchReasons.get('ENTRY_TOO_EXTENDED') ?? 0} TARGET_TOO_CLOSE=${watchReasons.get('TARGET_TOO_CLOSE') ?? 0}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
