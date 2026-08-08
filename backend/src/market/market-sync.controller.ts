import { Controller, Logger, Post } from '@nestjs/common';
import { loadRankingConfig } from '../config/ranking.config';
import { NseMarketService } from './nse/nse-market.service';

/** Manual / cron-friendly sync for NSE master + bhavcopy. */
@Controller('market')
export class MarketSyncController {
  private readonly logger = new Logger(MarketSyncController.name);

  constructor(private readonly nse: NseMarketService) {}

  @Post('sync')
  async sync() {
    const bhavSessions = loadRankingConfig().bhavLookbackSessions;
    this.logger.log(
      `Starting NSE universe + bhav sync (sessions≥${bhavSessions})`,
    );
    const universe = await this.nse.ensureUniverseSynced();
    const bhav = await this.nse.ensureBhavSynced(bhavSessions);
    return {
      universe,
      bhav,
      ok: true,
    };
  }
}
