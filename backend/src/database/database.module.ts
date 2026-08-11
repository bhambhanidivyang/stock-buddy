import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { User } from '../auth/entities/user.entity';
import {
  Account,
  ActivityLog,
  ExecutionSession,
  MarketBhavDaily,
  RecommendationItem,
  RecommendationRun,
  SchedulerRun,
  Trade,
  UniverseSnapshot,
  UniverseSymbolRow,
} from './entities';
import { AddRecommendationPortfolioMeta1754080000000 } from './migrations/1754080000000-AddRecommendationPortfolioMeta';
import { AddRefreshTokens1754600000000 } from './migrations/1754600000000-AddRefreshTokens';
import { AddSchedulerRuns1754700000000 } from './migrations/1754700000000-AddSchedulerRuns';
import { AddAccountUserId1754800000000 } from './migrations/1754800000000-AddAccountUserId';
import { AllowMultipleTradesPerItem1754900000000 } from './migrations/1754900000000-AllowMultipleTradesPerItem';
import { AddActivityLogs1755000000000 } from './migrations/1755000000000-AddActivityLogs';
import { AddUniverseAndBhav1754500000000 } from './migrations/1754500000000-AddUniverseAndBhav';
import { CreateUsers1754040000000 } from './migrations/1754040000000-CreateUsers';
import { InitSchema1753470000000 } from './migrations/1753470000000-InitSchema';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DATABASE_HOST', 'localhost'),
        port: Number(config.get<string>('DATABASE_PORT', '5432')),
        username: config.get<string>('POSTGRES_USER', 'postgres'),
        password: config.get<string>('POSTGRES_PASSWORD', 'postgres'),
        database: config.get<string>('POSTGRES_DB', 'stock-buddy-dev'),
        autoLoadEntities: true,
        entities: [
          Account,
          ActivityLog,
          RecommendationRun,
          RecommendationItem,
          ExecutionSession,
          Trade,
          User,
          RefreshToken,
          SchedulerRun,
          UniverseSnapshot,
          UniverseSymbolRow,
          MarketBhavDaily,
        ],
        synchronize: false,
        migrationsRun: true,
        migrations: [
          InitSchema1753470000000,
          CreateUsers1754040000000,
          AddRecommendationPortfolioMeta1754080000000,
          AddUniverseAndBhav1754500000000,
          AddRefreshTokens1754600000000,
          AddSchedulerRuns1754700000000,
          AddAccountUserId1754800000000,
          AllowMultipleTradesPerItem1754900000000,
          AddActivityLogs1755000000000,
        ],
      }),
    }),
    TypeOrmModule.forFeature([
      Account,
      ActivityLog,
      RecommendationRun,
      RecommendationItem,
      ExecutionSession,
      Trade,
      User,
      RefreshToken,
      SchedulerRun,
      UniverseSnapshot,
      UniverseSymbolRow,
      MarketBhavDaily,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}

