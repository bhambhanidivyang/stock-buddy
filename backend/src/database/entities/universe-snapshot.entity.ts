import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('universe_snapshots')
export class UniverseSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'as_of', type: 'date' })
  asOf: string;

  @Column({ type: 'text' })
  source: string;

  @Column({ name: 'symbol_count', type: 'int' })
  symbolCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
