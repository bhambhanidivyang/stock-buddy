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

export type ActivityLogCategory = 'RECOMMENDATION' | 'EXECUTION';

@Entity('activity_logs')
@Index(['accountId', 'dayKey', 'createdAt'])
@Index(['accountId', 'category', 'createdAt'])
export class ActivityLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  /** IST calendar day key YYYY-MM-DD */
  @Column({ name: 'day_key', type: 'text' })
  dayKey: string;

  @Column({ type: 'text' })
  category: ActivityLogCategory;

  @Column({ name: 'event_code', type: 'text' })
  eventCode: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, unknown> | null;

  /** Recommendation run id or execution session id when applicable. */
  @Column({ name: 'ref_id', type: 'uuid', nullable: true })
  refId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
