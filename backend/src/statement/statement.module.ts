import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountModule } from '../account/account.module';
import { Trade } from '../database/entities';
import { MarketModule } from '../market/market.module';
import { StatementController } from './statement.controller';
import { StatementService } from './statement.service';

@Module({
  imports: [AccountModule, MarketModule, TypeOrmModule.forFeature([Trade])],
  controllers: [StatementController],
  providers: [StatementService],
})
export class StatementModule {}
