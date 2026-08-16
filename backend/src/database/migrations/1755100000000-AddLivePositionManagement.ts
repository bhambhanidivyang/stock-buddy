import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLivePositionManagement1755100000000
  implements MigrationInterface
{
  name = 'AddLivePositionManagement1755100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trades"
        ADD COLUMN IF NOT EXISTS "management_phase" text,
        ADD COLUMN IF NOT EXISTS "initial_stop" numeric(12,4),
        ADD COLUMN IF NOT EXISTS "original_target" numeric(12,4),
        ADD COLUMN IF NOT EXISTS "high_water_mark" numeric(12,4),
        ADD COLUMN IF NOT EXISTS "max_unrealized_pct" numeric(10,4),
        ADD COLUMN IF NOT EXISTS "last_ai_review_at" TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS "last_ai_action" text
    `);

    await queryRunner.query(`
      UPDATE "trades"
      SET
        "management_phase" = CASE
          WHEN "status" = 'OPEN' THEN 'ACTIVE'
          ELSE "management_phase"
        END,
        "initial_stop" = COALESCE("initial_stop", "stop_loss"),
        "original_target" = COALESCE("original_target", "sell_target"),
        "high_water_mark" = COALESCE("high_water_mark", "buy_price"),
        "max_unrealized_pct" = COALESCE("max_unrealized_pct", 0)
      WHERE "status" IN ('OPEN', 'NEEDS_REVIEW')
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "broker_orders" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "trade_id" uuid NOT NULL,
        "symbol" text NOT NULL,
        "side" text NOT NULL,
        "qty" integer NOT NULL,
        "status" text NOT NULL,
        "source" text NOT NULL,
        "broker" text NOT NULL DEFAULT 'paper',
        "requested_price" numeric(12,4),
        "fill_price" numeric(12,4),
        "fill_qty" integer,
        "reject_reason" text,
        "filled_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_broker_orders_account"
          FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_broker_orders_trade"
          FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_broker_orders_account_created"
        ON "broker_orders" ("account_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_broker_orders_trade_created"
        ON "broker_orders" ("trade_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_broker_orders_status"
        ON "broker_orders" ("status")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "position_management_decisions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "trade_id" uuid NOT NULL,
        "symbol" text NOT NULL,
        "triggered_by" text NOT NULL,
        "events" jsonb,
        "snapshot" jsonb NOT NULL,
        "ai_input_version" text NOT NULL,
        "prompt_hash" text,
        "ai_action" text NOT NULL,
        "ai_confidence" numeric(6,4),
        "ai_reason" text NOT NULL,
        "suggested_stop" numeric(12,4),
        "suggested_exit_price" numeric(12,4),
        "validation_result" text NOT NULL,
        "validation_reason" text NOT NULL,
        "phase_before" text,
        "phase_after" text,
        "broker_order_id" uuid,
        "broker_status" text,
        "fill_price" numeric(12,4),
        "fill_qty" integer,
        "pnl_after" numeric(14,2),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_pmd_account"
          FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pmd_trade"
          FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pmd_broker_order"
          FOREIGN KEY ("broker_order_id") REFERENCES "broker_orders"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pmd_account_created"
        ON "position_management_decisions" ("account_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pmd_trade_created"
        ON "position_management_decisions" ("trade_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pmd_symbol_created"
        ON "position_management_decisions" ("symbol", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_pmd_symbol_created"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_pmd_trade_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_pmd_account_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "position_management_decisions"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_broker_orders_status"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_broker_orders_trade_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_broker_orders_account_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "broker_orders"`);
    await queryRunner.query(`
      ALTER TABLE "trades"
        DROP COLUMN IF EXISTS "last_ai_action",
        DROP COLUMN IF EXISTS "last_ai_review_at",
        DROP COLUMN IF EXISTS "max_unrealized_pct",
        DROP COLUMN IF EXISTS "high_water_mark",
        DROP COLUMN IF EXISTS "original_target",
        DROP COLUMN IF EXISTS "initial_stop",
        DROP COLUMN IF EXISTS "management_phase"
    `);
  }
}
