import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountModule } from '../account/account.module';
import { Trade } from '../database/entities';
import { MarketModule } from '../market/market.module';
import { BalanceController } from './balance.controller';
import { BalanceService } from './balance.service';

@Module({
  imports: [AccountModule, MarketModule, TypeOrmModule.forFeature([Trade])],
  controllers: [BalanceController],
  providers: [BalanceService],
})
export class BalanceModule {}
