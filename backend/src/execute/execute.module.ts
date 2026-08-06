import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountModule } from '../account/account.module';
import {
  Account,
  ExecutionSession,
  RecommendationItem,
  RecommendationRun,
  Trade,
} from '../database/entities';
import { MarketModule } from '../market/market.module';
import { ExecuteController } from './execute.controller';
import { ExecuteService } from './execute.service';
import { ExecutionLoopService } from './execution-loop.service';

@Module({
  imports: [
    AccountModule,
    MarketModule,
    TypeOrmModule.forFeature([
      Account,
      RecommendationRun,
      RecommendationItem,
      ExecutionSession,
      Trade,
    ]),
  ],
  controllers: [ExecuteController],
  providers: [ExecuteService, ExecutionLoopService],
  exports: [ExecuteService],
})
export class ExecuteModule {}
