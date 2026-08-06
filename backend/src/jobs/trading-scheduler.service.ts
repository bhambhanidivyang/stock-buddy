import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AccountService } from '../account/account.service';
import { ExecuteService } from '../execute/execute.service';
import {
  isIstWeekday,
  istDateKey,
  istMinutesSinceMidnight,
} from '../market/market-clock';
import { NseMarketService } from '../market/nse/nse-market.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { loadSchedulerConfig } from './scheduler.config';
import { SchedulerRunStore } from './scheduler-run.store';

const TZ = 'Asia/Kolkata';

@Injectable()
export class TradingSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(TradingSchedulerService.name);

  constructor(
    private readonly store: SchedulerRunStore,
    private readonly nse: NseMarketService,
    private readonly recommendations: RecommendationsService,
    private readonly execute: ExecuteService,
    private readonly accounts: AccountService,
  ) {}

  async onModuleInit() {
    const config = loadSchedulerConfig();
    if (!config.enabled) {
      this.logger.log('Scheduler disabled (SCHEDULER_ENABLED=false)');
      return;
    }
    this.logger.log(
      `Scheduler enabled (autoExecute=${config.autoExecute}) — running boot catch-up`,
    );
    // Defer so HTTP + DB migrations finish first.
    setTimeout(() => {
      void this.runCatchUp().catch((err) =>
        this.logger.error(`Boot catch-up failed: ${String(err)}`),
      );
    }, 5_000);
  }

  /** Weekdays 18:30 IST — refresh equity master + bhav after cash close. */
  @Cron('30 18 * * 1-5', { name: 'nse_sync', timeZone: TZ })
  async cronNseSync() {
    if (!loadSchedulerConfig().enabled) return;
    await this.runNseSync('cron');
  }

  /** Weekdays 08:45 IST — build AI plan for the day. */
  @Cron('45 8 * * 1-5', { name: 'recommend', timeZone: TZ })
  async cronRecommend() {
    if (!loadSchedulerConfig().enabled) return;
    await this.runRecommend('cron');
  }

  /** Weekdays 09:14 IST — arm OMS on today's PENDING plan (opt-in). */
  @Cron('14 9 * * 1-5', { name: 'execute', timeZone: TZ })
  async cronExecute() {
    const config = loadSchedulerConfig();
    if (!config.enabled || !config.autoExecute) return;
    await this.runExecute('cron');
  }

  async runCatchUp(): Promise<void> {
    if (!isIstWeekday()) {
      this.logger.log('Catch-up skipped (weekend IST)');
      return;
    }

    const mins = istMinutesSinceMidnight();
    const config = loadSchedulerConfig();

    // After evening sync window
    if (mins >= 18 * 60 + 30) {
      await this.runNseSync('catchup');
    }

    // After recommend window
    if (mins >= 8 * 60 + 45) {
      await this.runRecommend('catchup');
    }

    // After execute window
    if (config.autoExecute && mins >= 9 * 60 + 14) {
      await this.runExecute('catchup');
    }
  }

  async runNseSync(trigger: string): Promise<void> {
    const runDate = istDateKey();
    const claimed = await this.store.claim('nse_sync', runDate);
    if (!claimed) {
      this.logger.log(`nse_sync skipped (${trigger}) — already claimed for ${runDate}`);
      return;
    }

    this.logger.log(`nse_sync start (${trigger}) ${runDate}`);
    try {
      const universe = await this.nse.syncEquityMaster();
      const bhav = await this.nse.ensureBhavSynced(20);
      const detail = `universe=${universe.count} bhavDate=${bhav.tradeDate ?? 'null'} rows=${bhav.rows}`;
      if (!bhav.tradeDate || bhav.rows <= 0) {
        await this.store.complete('nse_sync', runDate, 'failed', detail);
        throw new Error(`NSE bhav sync produced no rows (${detail})`);
      }
      await this.store.complete('nse_sync', runDate, 'success', detail);
      this.logger.log(`nse_sync ok (${trigger}) ${detail}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.store.complete('nse_sync', runDate, 'failed', message);
      this.logger.error(`nse_sync failed (${trigger}): ${message}`);
      throw err;
    }
  }

  async runRecommend(trigger: string): Promise<void> {
    const runDate = istDateKey();
    const claimed = await this.store.claim('recommend', runDate);
    if (!claimed) {
      this.logger.log(`recommend skipped (${trigger}) — already claimed for ${runDate}`);
      return;
    }

    this.logger.log(`recommend start (${trigger}) ${runDate}`);
    try {
      // Prefer fresh universe/bhav before AI if possible (idempotent if sync already succeeded).
      try {
        await this.nse.ensureUniverseSynced();
        await this.nse.ensureBhavSynced(20);
      } catch (syncErr) {
        this.logger.warn(
          `recommend pre-sync soft-fail: ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`,
        );
      }

      const paperAccounts = await this.accounts.listUserPaperAccounts();
      if (paperAccounts.length === 0) {
        await this.store.complete(
          'recommend',
          runDate,
          'skipped',
          'no user paper accounts',
        );
        this.logger.warn(`recommend skipped (${trigger}) — no user accounts`);
        return;
      }

      const summaries: string[] = [];
      for (const account of paperAccounts) {
        if (!account.userId) continue;
        try {
          const run = await this.recommendations.createRecommendation(
            account.userId,
          );
          summaries.push(
            `${account.userId.slice(0, 8)}→${run.id.slice(0, 8)}:${run.items?.length ?? 0}`,
          );
        } catch (userErr) {
          const msg =
            userErr instanceof Error ? userErr.message : String(userErr);
          summaries.push(`${account.userId.slice(0, 8)}:ERR`);
          this.logger.error(
            `recommend failed for user ${account.userId}: ${msg}`,
          );
        }
      }
      const detail = `accounts=${paperAccounts.length} [${summaries.join('; ')}]`;
      await this.store.complete('recommend', runDate, 'success', detail);
      this.logger.log(`recommend ok (${trigger}) ${detail}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.store.complete('recommend', runDate, 'failed', message);
      this.logger.error(`recommend failed (${trigger}): ${message}`);
      throw err;
    }
  }

  async runExecute(trigger: string): Promise<void> {
    const runDate = istDateKey();
    const claimed = await this.store.claim('execute', runDate);
    if (!claimed) {
      this.logger.log(`execute skipped (${trigger}) — already claimed for ${runDate}`);
      return;
    }

    this.logger.log(`execute start (${trigger}) ${runDate}`);
    try {
      const paperAccounts = await this.accounts.listUserPaperAccounts();
      if (paperAccounts.length === 0) {
        await this.store.complete(
          'execute',
          runDate,
          'skipped',
          'no user paper accounts',
        );
        return;
      }

      const summaries: string[] = [];
      let hardFail: string | null = null;
      for (const account of paperAccounts) {
        if (!account.userId) continue;
        try {
          const result = await this.execute.startExecution(account.userId);
          summaries.push(
            `${account.userId.slice(0, 8)}→${result.sessionId?.slice(0, 8) ?? '?'}:${result.trades?.length ?? 0}`,
          );
        } catch (userErr) {
          const message =
            userErr instanceof Error ? userErr.message : String(userErr);
          const soft =
            /no PENDING recommendation/i.test(message) ||
            /no items/i.test(message) ||
            /not from today's IST/i.test(message);
          summaries.push(
            soft
              ? `${account.userId.slice(0, 8)}:skip`
              : `${account.userId.slice(0, 8)}:ERR`,
          );
          if (soft) {
            this.logger.warn(
              `execute skipped for user ${account.userId}: ${message}`,
            );
          } else {
            hardFail = message;
            this.logger.error(
              `execute failed for user ${account.userId}: ${message}`,
            );
          }
        }
      }

      const detail = `accounts=${paperAccounts.length} [${summaries.join('; ')}]`;
      if (hardFail && summaries.every((s) => s.includes(':ERR'))) {
        await this.store.complete('execute', runDate, 'failed', detail);
        throw new Error(hardFail);
      }
      await this.store.complete(
        'execute',
        runDate,
        hardFail ? 'success' : 'success',
        detail,
      );
      this.logger.log(`execute ok (${trigger}) ${detail}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.store.complete('execute', runDate, 'failed', message);
      this.logger.error(`execute failed (${trigger}): ${message}`);
      throw err;
    }
  }
}
