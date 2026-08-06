import { Injectable } from '@nestjs/common';
import type { RecommendationConfig } from '../../config/recommendation.config';
import { loadRecommendationConfig } from '../../config/recommendation.config';
import { NseUniverseProvider } from './nse-universe.provider';
import type { UniverseStock } from './universe.provider';

/** Always resolves the live NSE EQ universe (no static watchlist). */
@Injectable()
export class UniverseResolverService {
  constructor(private readonly nseProvider: NseUniverseProvider) {}

  async resolve(
    _config: RecommendationConfig = loadRecommendationConfig(),
  ): Promise<{ stocks: UniverseStock[]; providerName: string }> {
    const stocks = await this.nseProvider.getUniverse();
    return { stocks, providerName: this.nseProvider.name };
  }
}
