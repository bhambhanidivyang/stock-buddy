import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SchedulerJobName = 'nse_sync' | 'recommend' | 'execute';
export type SchedulerRunStatus = 'running' | 'success' | 'failed' | 'skipped';

@Entity('scheduler_runs')
@Index(['jobName', 'runDate'], { unique: true })
export class SchedulerRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 64 })
  jobName: SchedulerJobName;

  /** IST calendar date YYYY-MM-DD */
  @Column({ length: 10 })
  runDate: string;

  @Column({ length: 16 })
  status: SchedulerRunStatus;

  @Column({ type: 'text', nullable: true })
  detail: string | null;

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
