import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { NseMarketService } from '../nse/nse-market.service';
import type { UniverseProvider, UniverseStock } from './universe.provider';

@Injectable()
export class NseUniverseProvider implements UniverseProvider {
  readonly name = 'nse';
  private readonly logger = new Logger(NseUniverseProvider.name);

  constructor(private readonly nse: NseMarketService) {}

  async getUniverse(): Promise<UniverseStock[]> {
    await this.nse.ensureUniverseSynced();
    const fromDb = await this.nse.getUniverseFromDb();
    if (!fromDb || fromDb.length === 0) {
      this.logger.error('NSE universe empty after sync');
      throw new ServiceUnavailableException(
        'NSE equity universe unavailable. Run POST /market/sync and ensure NSE archives are reachable.',
      );
    }
    return fromDb;
  }
}
