import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniverseAndBhav1754500000000 implements MigrationInterface {
  name = 'AddUniverseAndBhav1754500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS universe_snapshots (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        as_of date NOT NULL,
        source text NOT NULL,
        symbol_count int NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS universe_symbols (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        snapshot_id uuid NOT NULL REFERENCES universe_snapshots(id) ON DELETE CASCADE,
        symbol text NOT NULL,
        yahoo_symbol text NOT NULL,
        company_name text NOT NULL,
        sector text NOT NULL DEFAULT 'Unknown',
        series text NOT NULL DEFAULT 'EQ',
        isin text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (snapshot_id, symbol)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_universe_symbols_snapshot ON universe_symbols(snapshot_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_universe_symbols_symbol ON universe_symbols(symbol)`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS market_bhav_daily (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        trade_date date NOT NULL,
        symbol text NOT NULL,
        open numeric(14,4) NULL,
        high numeric(14,4) NULL,
        low numeric(14,4) NULL,
        close numeric(14,4) NOT NULL,
        prev_close numeric(14,4) NULL,
        volume bigint NOT NULL DEFAULT 0,
        traded_value numeric(20,2) NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (trade_date, symbol)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_bhav_trade_date ON market_bhav_daily(trade_date)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_bhav_symbol_date ON market_bhav_daily(symbol, trade_date)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS market_bhav_daily`);
    await queryRunner.query(`DROP TABLE IF EXISTS universe_symbols`);
    await queryRunner.query(`DROP TABLE IF EXISTS universe_snapshots`);
  }
}
