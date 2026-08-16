import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from './account.entity';
import { BrokerOrder } from './broker-order.entity';
import { Trade } from './trade.entity';

@Entity('position_management_decisions')
@Index(['accountId', 'createdAt'])
@Index(['tradeId', 'createdAt'])
@Index(['symbol', 'createdAt'])
export class PositionManagementDecision {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ name: 'trade_id', type: 'uuid' })
  tradeId: string;

  @ManyToOne(() => Trade, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trade_id' })
  trade: Trade;

  @Column({ type: 'text' })
  symbol: string;

  /** INTERVAL | EVENT */
  @Column({ name: 'triggered_by', type: 'text' })
  triggeredBy: string;

  @Column({ type: 'jsonb', nullable: true })
  events: unknown[] | null;

  /** Deterministic snapshot sent to AI (replayable). */
  @Column({ type: 'jsonb' })
  snapshot: Record<string, unknown>;

  @Column({ name: 'ai_input_version', type: 'text' })
  aiInputVersion: string;

  @Column({ name: 'prompt_hash', type: 'text', nullable: true })
  promptHash: string | null;

  @Column({ name: 'ai_action', type: 'text' })
  aiAction: string;

  @Column({
    name: 'ai_confidence',
    type: 'numeric',
    precision: 6,
    scale: 4,
    nullable: true,
  })
  aiConfidence: string | null;

  @Column({ name: 'ai_reason', type: 'text' })
  aiReason: string;

  @Column({
    name: 'suggested_stop',
    type: 'numeric',
    precision: 12,
    scale: 4,
    nullable: true,
  })
  suggestedStop: string | null;

  @Column({
    name: 'suggested_exit_price',
    type: 'numeric',
    precision: 12,
    scale: 4,
    nullable: true,
  })
  suggestedExitPrice: string | null;

  /** ALLOW | BLOCK */
  @Column({ name: 'validation_result', type: 'text' })
  validationResult: string;

  @Column({ name: 'validation_reason', type: 'text' })
  validationReason: string;

  @Column({ name: 'phase_before', type: 'text', nullable: true })
  phaseBefore: string | null;

  @Column({ name: 'phase_after', type: 'text', nullable: true })
  phaseAfter: string | null;

  @Column({ name: 'broker_order_id', type: 'uuid', nullable: true })
  brokerOrderId: string | null;

  @ManyToOne(() => BrokerOrder, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'broker_order_id' })
  brokerOrder: BrokerOrder | null;

  @Column({ name: 'broker_status', type: 'text', nullable: true })
  brokerStatus: string | null;

  @Column({
    name: 'fill_price',
    type: 'numeric',
    precision: 12,
    scale: 4,
    nullable: true,
  })
  fillPrice: string | null;

  @Column({ name: 'fill_qty', type: 'integer', nullable: true })
  fillQty: number | null;

  @Column({
    name: 'pnl_after',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  pnlAfter: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
