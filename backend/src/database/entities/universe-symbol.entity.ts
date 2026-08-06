import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('universe_symbols')
@Unique(['snapshotId', 'symbol'])
@Index(['snapshotId'])
@Index(['symbol'])
export class UniverseSymbolRow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'snapshot_id', type: 'uuid' })
  snapshotId: string;

  @Column({ type: 'text' })
  symbol: string;

  @Column({ name: 'yahoo_symbol', type: 'text' })
  yahooSymbol: string;

  @Column({ name: 'company_name', type: 'text' })
  companyName: string;

  @Column({ type: 'text', default: 'Unknown' })
  sector: string;

  @Column({ type: 'text', default: 'EQ' })
  series: string;

  @Column({ type: 'text', nullable: true })
  isin: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
