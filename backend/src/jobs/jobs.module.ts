import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountModule } from '../account/account.module';
import { SchedulerRun } from '../database/entities/scheduler-run.entity';
import { ExecuteModule } from '../execute/execute.module';
import { MarketModule } from '../market/market.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { JobsController } from './jobs.controller';
import { SchedulerRunStore } from './scheduler-run.store';
import { TradingSchedulerService } from './trading-scheduler.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([SchedulerRun]),
    AccountModule,
    MarketModule,
    RecommendationsModule,
    ExecuteModule,
  ],
  controllers: [JobsController],
  providers: [SchedulerRunStore, TradingSchedulerService],
})
export class JobsModule {}
