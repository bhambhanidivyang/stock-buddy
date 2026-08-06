import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountModule } from '../account/account.module';
import { Trade } from '../database/entities';
import { MarketModule } from '../market/market.module';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';

@Module({
  imports: [AccountModule, MarketModule, TypeOrmModule.forFeature([Trade])],
  controllers: [PortfolioController],
  providers: [PortfolioService],
})
export class PortfolioModule {}
