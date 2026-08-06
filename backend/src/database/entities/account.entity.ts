import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { ExecutionSession } from './execution-session.entity';
import { RecommendationRun } from './recommendation-run.entity';
import { Trade } from './trade.entity';

@Entity('accounts')
@Unique(['userId'])
@Index(['userId'])
@Check(`"cash" >= 0`)
@Check(`"initial_fund" > 0`)
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Owning user — one paper account per user. */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ type: 'text' })
  name: string;

  @Column({
    name: 'initial_fund',
    type: 'numeric',
    precision: 14,
    scale: 2,
  })
  initialFund: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  cash: string;

  @Column({
    name: 'realized_pnl',
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
  })
  realizedPnl: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => RecommendationRun, (run) => run.account)
  recommendationRuns: RecommendationRun[];

  @OneToMany(() => ExecutionSession, (session) => session.account)
  executionSessions: ExecutionSession[];

  @OneToMany(() => Trade, (trade) => trade.account)
  trades: Trade[];
}
