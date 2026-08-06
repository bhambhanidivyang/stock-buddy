import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../database/entities';
import { AccountService } from './account.service';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([Account])],
  providers: [AccountService],
  exports: [AccountService, TypeOrmModule],
})
export class AccountModule {}
