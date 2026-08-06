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
import { ExecutionSessionStatus, ExecutionStopReason } from '../enums';
import { Account } from './account.entity';
import { RecommendationRun } from './recommendation-run.entity';
import { Trade } from './trade.entity';

@Entity('execution_sessions')
@Index('execution_sessions_one_running_per_account', ['accountId'], {
  unique: true,
  where: `"status" = 'RUNNING'`,
})
export class ExecutionSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @ManyToOne(() => Account, (account) => account.executionSessions, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ name: 'recommendation_run_id', type: 'uuid' })
  recommendationRunId: string;

  @ManyToOne(() => RecommendationRun, (run) => run.executionSessions, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'recommendation_run_id' })
  recommendationRun: RecommendationRun;

  @Column({ type: 'text' })
  status: ExecutionSessionStatus;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'stopped_at', type: 'timestamptz', nullable: true })
  stoppedAt: Date | null;

  @Column({ name: 'stop_reason', type: 'text', nullable: true })
  stopReason: ExecutionStopReason | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => Trade, (trade) => trade.executionSession)
  trades: Trade[];
}
