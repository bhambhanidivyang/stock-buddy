import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1753470000000 implements MigrationInterface {
  name = 'InitSchema1753470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "accounts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "initial_fund" numeric(14,2) NOT NULL,
        "cash" numeric(14,2) NOT NULL,
        "realized_pnl" numeric(14,2) NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_accounts_name" UNIQUE ("name"),
        CONSTRAINT "CHK_accounts_cash_non_negative" CHECK ("cash" >= 0),
        CONSTRAINT "CHK_accounts_initial_fund_positive" CHECK ("initial_fund" > 0),
        CONSTRAINT "PK_accounts" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "recommendation_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "status" text NOT NULL,
        "market_ts" TIMESTAMPTZ NOT NULL,
        "market_session" text NOT NULL,
        "available_cash" numeric(14,2) NOT NULL,
        "portfolio_summary" text,
        "total_allocated_inr" numeric(14,2) NOT NULL,
        "cash_reserved_inr" numeric(14,2) NOT NULL,
        "context_snapshot" jsonb NOT NULL,
        "ai_raw" jsonb NOT NULL,
        "model" text NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_recommendation_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_recommendation_runs_account" FOREIGN KEY ("account_id")
          REFERENCES "accounts"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_recommendation_runs_account_created_at"
        ON "recommendation_runs" ("account_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_recommendation_runs_account_status"
        ON "recommendation_runs" ("account_id", "status")
    `);

    await queryRunner.query(`
      CREATE TABLE "recommendation_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "recommendation_run_id" uuid NOT NULL,
        "symbol" text NOT NULL,
        "qty" integer NOT NULL,
        "allocation_inr" numeric(14,2) NOT NULL,
        "buy_low" numeric(12,4) NOT NULL,
        "buy_high" numeric(12,4) NOT NULL,
        "sell_target" numeric(12,4) NOT NULL,
        "stop_loss" numeric(12,4) NOT NULL,
        "role" text NOT NULL,
        "summary" text NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_recommendation_items" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_recommendation_items_run_symbol" UNIQUE ("recommendation_run_id", "symbol"),
        CONSTRAINT "CHK_recommendation_items_qty_positive" CHECK ("qty" > 0),
        CONSTRAINT "CHK_recommendation_items_buy_band" CHECK ("buy_low" <= "buy_high"),
        CONSTRAINT "FK_recommendation_items_run" FOREIGN KEY ("recommendation_run_id")
          REFERENCES "recommendation_runs"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "execution_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "recommendation_run_id" uuid NOT NULL,
        "status" text NOT NULL,
        "started_at" TIMESTAMPTZ NOT NULL,
        "stopped_at" TIMESTAMPTZ,
        "stop_reason" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_execution_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_execution_sessions_account" FOREIGN KEY ("account_id")
          REFERENCES "accounts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_execution_sessions_recommendation_run" FOREIGN KEY ("recommendation_run_id")
          REFERENCES "recommendation_runs"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "execution_sessions_one_running_per_account"
        ON "execution_sessions" ("account_id")
        WHERE "status" = 'RUNNING'
    `);

    await queryRunner.query(`
      CREATE TABLE "trades" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "recommendation_item_id" uuid NOT NULL,
        "execution_session_id" uuid NOT NULL,
        "symbol" text NOT NULL,
        "qty" integer NOT NULL,
        "role" text NOT NULL,
        "buy_low" numeric(12,4) NOT NULL,
        "buy_high" numeric(12,4) NOT NULL,
        "sell_target" numeric(12,4) NOT NULL,
        "stop_loss" numeric(12,4) NOT NULL,
        "summary" text NOT NULL,
        "status" text NOT NULL,
        "exit_reason" text,
        "buy_price" numeric(12,4),
        "buy_at" TIMESTAMPTZ,
        "sell_price" numeric(12,4),
        "sell_at" TIMESTAMPTZ,
        "invested_inr" numeric(14,2),
        "proceeds_inr" numeric(14,2),
        "realized_pnl" numeric(14,2),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trades" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_trades_recommendation_item" UNIQUE ("recommendation_item_id"),
        CONSTRAINT "FK_trades_account" FOREIGN KEY ("account_id")
          REFERENCES "accounts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_trades_recommendation_item" FOREIGN KEY ("recommendation_item_id")
          REFERENCES "recommendation_items"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_trades_execution_session" FOREIGN KEY ("execution_session_id")
          REFERENCES "execution_sessions"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_trades_account_status"
        ON "trades" ("account_id", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_trades_execution_session_status"
        ON "trades" ("execution_session_id", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_trades_symbol_status"
        ON "trades" ("symbol", "status")
    `);

    const initialFund = process.env.DAILY_FUND ?? '100000';
    await queryRunner.query(
      `
      INSERT INTO "accounts" ("name", "initial_fund", "cash", "realized_pnl")
      VALUES ('default', $1, $1, 0)
      ON CONFLICT ("name") DO NOTHING
      `,
      [initialFund],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "trades"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "execution_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "recommendation_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "recommendation_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "accounts"`);
  }
}
