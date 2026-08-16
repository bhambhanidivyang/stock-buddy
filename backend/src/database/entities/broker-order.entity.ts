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
  BrokerOrderStatus,
  OrderSide,
  OrderSource,
} from '../enums';
import { Account } from './account.entity';
import { Trade } from './trade.entity';

@Entity('broker_orders')
@Index(['accountId', 'createdAt'])
@Index(['tradeId', 'createdAt'])
@Index(['status'])
export class BrokerOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ name: 'trade_id', type: 'uuid' })
  tradeId: string;

  @ManyToOne(() => Trade, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trade_id' })
  trade: Trade;

  @Column({ type: 'text' })
  symbol: string;

  @Column({ type: 'text' })
  side: OrderSide;

  @Column({ type: 'integer' })
  qty: number;

  @Column({ type: 'text' })
  status: BrokerOrderStatus;

  @Column({ type: 'text' })
  source: OrderSource;

  /** Paper today; future broker adapter name stays here. */
  @Column({ type: 'text', default: 'paper' })
  broker: string;

  @Column({
    name: 'requested_price',
    type: 'numeric',
    precision: 12,
    scale: 4,
    nullable: true,
  })
  requestedPrice: string | null;

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

  @Column({ name: 'reject_reason', type: 'text', nullable: true })
  rejectReason: string | null;

  @Column({ name: 'filled_at', type: 'timestamptz', nullable: true })
  filledAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
