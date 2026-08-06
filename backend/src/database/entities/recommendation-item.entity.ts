import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { RecommendationItemRole } from '../enums';
import { RecommendationRun } from './recommendation-run.entity';
import { Trade } from './trade.entity';

@Entity('recommendation_items')
@Unique(['recommendationRunId', 'symbol'])
@Check(`"qty" > 0`)
@Check(`"buy_low" <= "buy_high"`)
export class RecommendationItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'recommendation_run_id', type: 'uuid' })
  recommendationRunId: string;

  @ManyToOne(() => RecommendationRun, (run) => run.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'recommendation_run_id' })
  recommendationRun: RecommendationRun;

  @Column({ type: 'text' })
  symbol: string;

  @Column({ type: 'integer' })
  qty: number;

  @Column({
    name: 'allocation_inr',
    type: 'numeric',
    precision: 14,
    scale: 2,
  })
  allocationInr: string;

  @Column({ name: 'buy_low', type: 'numeric', precision: 12, scale: 4 })
  buyLow: string;

  @Column({ name: 'buy_high', type: 'numeric', precision: 12, scale: 4 })
  buyHigh: string;

  @Column({ name: 'sell_target', type: 'numeric', precision: 12, scale: 4 })
  sellTarget: string;

  @Column({ name: 'stop_loss', type: 'numeric', precision: 12, scale: 4 })
  stopLoss: string;

  @Column({ type: 'text' })
  role: RecommendationItemRole;

  @Column({ type: 'text' })
  summary: string;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToOne(() => Trade, (trade) => trade.recommendationItem)
  trade: Trade | null;
}
