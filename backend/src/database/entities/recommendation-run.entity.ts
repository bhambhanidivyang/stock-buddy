import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MarketSession, RecommendationRunStatus } from '../enums';
import { Account } from './account.entity';
import { ExecutionSession } from './execution-session.entity';
import { RecommendationItem } from './recommendation-item.entity';

@Entity('recommendation_runs')
@Index(['accountId', 'createdAt'])
@Index(['accountId', 'status'])
export class RecommendationRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @ManyToOne(() => Account, (account) => account.recommendationRuns, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ type: 'text' })
  status: RecommendationRunStatus;

  @Column({ name: 'market_ts', type: 'timestamptz' })
  marketTs: Date;

  @Column({ name: 'market_session', type: 'text' })
  marketSession: MarketSession;

  @Column({
    name: 'available_cash',
    type: 'numeric',
    precision: 14,
    scale: 2,
  })
  availableCash: string;

  @Column({ name: 'portfolio_summary', type: 'text', nullable: true })
  portfolioSummary: string | null;

  @Column({ name: 'market_regime', type: 'text', nullable: true })
  marketRegime: string | null;

  @Column({ type: 'text', nullable: true })
  confidence: string | null;

  @Column({ name: 'portfolio_strategy', type: 'jsonb', nullable: true })
  portfolioStrategy: Record<string, unknown> | null;

  @Column({
    name: 'total_allocated_inr',
    type: 'numeric',
    precision: 14,
    scale: 2,
  })
  totalAllocatedInr: string;

  @Column({
    name: 'cash_reserved_inr',
    type: 'numeric',
    precision: 14,
    scale: 2,
  })
  cashReservedInr: string;

  @Column({ name: 'context_snapshot', type: 'jsonb' })
  contextSnapshot: Record<string, unknown>;

  @Column({ name: 'ai_raw', type: 'jsonb' })
  aiRaw: Record<string, unknown>;

  @Column({ type: 'text' })
  model: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => RecommendationItem, (item) => item.recommendationRun)
  items: RecommendationItem[];

  @OneToMany(() => ExecutionSession, (session) => session.recommendationRun)
  executionSessions: ExecutionSession[];
}
