import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('market_bhav_daily')
@Unique(['tradeDate', 'symbol'])
@Index(['tradeDate'])
@Index(['symbol', 'tradeDate'])
export class MarketBhavDaily {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'trade_date', type: 'date' })
  tradeDate: string;

  @Column({ type: 'text' })
  symbol: string;

  @Column({ type: 'numeric', precision: 14, scale: 4, nullable: true })
  open: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 4, nullable: true })
  high: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 4, nullable: true })
  low: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 4 })
  close: string;

  @Column({ name: 'prev_close', type: 'numeric', precision: 14, scale: 4, nullable: true })
  prevClose: string | null;

  @Column({ type: 'bigint', default: 0 })
  volume: string;

  @Column({
    name: 'traded_value',
    type: 'numeric',
    precision: 20,
    scale: 2,
    default: 0,
  })
  tradedValue: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
