import 'dotenv/config';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { User } from '../auth/entities/user.entity';
import {
  Account,
  ExecutionSession,
  MarketBhavDaily,
  RecommendationItem,
  RecommendationRun,
  Trade,
  UniverseSnapshot,
  UniverseSymbolRow,
} from './entities';
import { AddRecommendationPortfolioMeta1754080000000 } from './migrations/1754080000000-AddRecommendationPortfolioMeta';
import { AddRefreshTokens1754600000000 } from './migrations/1754600000000-AddRefreshTokens';
import { AddSchedulerRuns1754700000000 } from './migrations/1754700000000-AddSchedulerRuns';
import { AddAccountUserId1754800000000 } from './migrations/1754800000000-AddAccountUserId';
import { AddUniverseAndBhav1754500000000 } from './migrations/1754500000000-AddUniverseAndBhav';
import { CreateUsers1754040000000 } from './migrations/1754040000000-CreateUsers';
import { InitSchema1753470000000 } from './migrations/1753470000000-InitSchema';
import { SchedulerRun } from './entities/scheduler-run.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: Number(process.env.DATABASE_PORT ?? 5432),
  username: process.env.POSTGRES_USER ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD ?? 'postgres',
  database: process.env.POSTGRES_DB ?? 'stock-buddy-dev',
  entities: [
    Account,
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
  migrations: [
    InitSchema1753470000000,
    CreateUsers1754040000000,
    AddRecommendationPortfolioMeta1754080000000,
    AddUniverseAndBhav1754500000000,
    AddRefreshTokens1754600000000,
    AddSchedulerRuns1754700000000,
    AddAccountUserId1754800000000,
  ],
  synchronize: false,
});
