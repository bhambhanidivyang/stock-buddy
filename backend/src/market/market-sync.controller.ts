import { Controller, Logger, Post } from '@nestjs/common';
import { NseMarketService } from './nse/nse-market.service';

/** Manual / cron-friendly sync for NSE master + bhavcopy. */
@Controller('market')
export class MarketSyncController {
  private readonly logger = new Logger(MarketSyncController.name);

  constructor(private readonly nse: NseMarketService) {}

  @Post('sync')
  async sync() {
    this.logger.log('Starting NSE universe + bhav sync');
    const universe = await this.nse.ensureUniverseSynced();
    const bhav = await this.nse.ensureBhavSynced(20);
    return {
      universe,
      bhav,
      ok: true,
    };
  }
}
