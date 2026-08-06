import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountModule } from '../account/account.module';
import { AiModule } from '../ai/ai.module';
import {
  RecommendationItem,
  RecommendationRun,
  Trade,
} from '../database/entities';
import { MarketModule } from '../market/market.module';
import { ManageHoldingsService } from './manage-holdings.service';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

@Module({
  imports: [
    AccountModule,
    AiModule,
    MarketModule,
    TypeOrmModule.forFeature([
      RecommendationRun,
      RecommendationItem,
      Trade,
    ]),
  ],
  controllers: [RecommendationsController],
  providers: [RecommendationsService, ManageHoldingsService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
