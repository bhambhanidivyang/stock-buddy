import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { AiModule } from '../ai/ai.module';
import {
  Account,
  BrokerOrder,
  PositionManagementDecision,
  Trade,
} from '../database/entities';
import { MarketModule } from '../market/market.module';
import {
  LIVE_MARKET_DATA_PROVIDER,
  MARKET_DATA_PROVIDER,
} from '../market/providers/market-data.provider';
import { YahooService } from '../market/yahoo.service';
import { AiPositionService } from './ai-position.service';
import { LiveMarketDataService } from './live-market-data.service';
import { OrderReconciliationService } from './order-reconciliation.service';
import { PaperBrokerService } from './paper-broker.service';
import { PositionManagementService } from './position-management.service';

@Module({
  imports: [
    MarketModule,
    AiModule,
    ActivityLogsModule,
    TypeOrmModule.forFeature([
      Trade,
      Account,
      BrokerOrder,
      PositionManagementDecision,
    ]),
  ],
  providers: [
    LiveMarketDataService,
    { provide: LIVE_MARKET_DATA_PROVIDER, useExisting: LiveMarketDataService },
    { provide: MARKET_DATA_PROVIDER, useExisting: YahooService },
    OrderReconciliationService,
    PaperBrokerService,
    AiPositionService,
    PositionManagementService,
  ],
  exports: [
    LiveMarketDataService,
    OrderReconciliationService,
    PaperBrokerService,
    PositionManagementService,
  ],
})
export class LiveModule {}
