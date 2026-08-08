import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  RecommendationItemRole,
  TradeExitReason,
  TradeStatus,
} from '../enums';
import { Account } from './account.entity';
import { ExecutionSession } from './execution-session.entity';
import { RecommendationItem } from './recommendation-item.entity';

@Entity('trades')
@Index(['accountId', 'status'])
@Index(['executionSessionId', 'status'])
@Index(['symbol', 'status'])
export class Trade {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @ManyToOne(() => Account, (account) => account.trades, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ name: 'recommendation_item_id', type: 'uuid' })
  recommendationItemId: string;

  @ManyToOne(() => RecommendationItem, (item) => item.trades, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'recommendation_item_id' })
  recommendationItem: RecommendationItem;

  @Column({ name: 'execution_session_id', type: 'uuid' })
  executionSessionId: string;

  @ManyToOne(() => ExecutionSession, (session) => session.trades, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'execution_session_id' })
  executionSession: ExecutionSession;

  @Column({ type: 'text' })
  symbol: string;

  @Column({ type: 'integer' })
  qty: number;

  @Column({ type: 'text' })
  role: RecommendationItemRole;

  @Column({ name: 'buy_low', type: 'numeric', precision: 12, scale: 4 })
  buyLow: string;

  @Column({ name: 'buy_high', type: 'numeric', precision: 12, scale: 4 })
  buyHigh: string;

  @Column({ name: 'sell_target', type: 'numeric', precision: 12, scale: 4 })
  sellTarget: string;

  @Column({ name: 'stop_loss', type: 'numeric', precision: 12, scale: 4 })
  stopLoss: string;

  @Column({ type: 'text' })
  summary: string;

  @Column({ type: 'text' })
  status: TradeStatus;

  @Column({ name: 'exit_reason', type: 'text', nullable: true })
  exitReason: TradeExitReason | null;

  @Column({
    name: 'buy_price',
    type: 'numeric',
    precision: 12,
    scale: 4,
    nullable: true,
  })
  buyPrice: string | null;

  @Column({ name: 'buy_at', type: 'timestamptz', nullable: true })
  buyAt: Date | null;

  @Column({
    name: 'sell_price',
    type: 'numeric',
    precision: 12,
    scale: 4,
    nullable: true,
  })
  sellPrice: string | null;

  @Column({ name: 'sell_at', type: 'timestamptz', nullable: true })
  sellAt: Date | null;

  @Column({
    name: 'invested_inr',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  investedInr: string | null;

  @Column({
    name: 'proceeds_inr',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  proceedsInr: string | null;

  @Column({
    name: 'realized_pnl',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  realizedPnl: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
