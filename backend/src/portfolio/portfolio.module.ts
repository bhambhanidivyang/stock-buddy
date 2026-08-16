import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountModule } from '../account/account.module';
import { Trade } from '../database/entities';
import { LiveModule } from '../live/live.module';
import { MarketModule } from '../market/market.module';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';

@Module({
  imports: [
    AccountModule,
    MarketModule,
    LiveModule,
    TypeOrmModule.forFeature([Trade]),
  ],
  controllers: [PortfolioController],
  providers: [PortfolioService],
})
export class PortfolioModule {}
