import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddActivityLogs1755000000000 implements MigrationInterface {
  name = 'AddActivityLogs1755000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "activity_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "day_key" text NOT NULL,
        "category" text NOT NULL,
        "event_code" text NOT NULL,
        "message" text NOT NULL,
        "meta" jsonb,
        "ref_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_activity_logs_account"
          FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_activity_logs_account_day_created"
        ON "activity_logs" ("account_id", "day_key", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_activity_logs_account_category_created"
        ON "activity_logs" ("account_id", "category", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_activity_logs_account_category_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_activity_logs_account_day_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "activity_logs"`);
  }
}
