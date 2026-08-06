import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketBhavDaily } from '../database/entities/market-bhav-daily.entity';
import { UniverseSnapshot } from '../database/entities/universe-snapshot.entity';
import { UniverseSymbolRow } from '../database/entities/universe-symbol.entity';
import { MarketFeatureEngine } from './features/market-feature.engine';
import { NseMarketService } from './nse/nse-market.service';
import { NseUniverseProvider } from './providers/nse-universe.provider';
import { UniverseResolverService } from './providers/universe-resolver.service';
import { MarketSyncController } from './market-sync.controller';
import { YahooService } from './yahoo.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UniverseSnapshot,
      UniverseSymbolRow,
      MarketBhavDaily,
    ]),
  ],
  controllers: [MarketSyncController],
  providers: [
    YahooService,
    NseMarketService,
    NseUniverseProvider,
    UniverseResolverService,
    MarketFeatureEngine,
  ],
  exports: [
    YahooService,
    NseMarketService,
    MarketFeatureEngine,
    UniverseResolverService,
  ],
})
export class MarketModule {}
