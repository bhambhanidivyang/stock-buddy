import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Partial human sells create a CLOSED sibling trade that shares the same
 * recommendation_item_id. Drop the 1:1 unique so that is allowed.
 */
export class AllowMultipleTradesPerItem1754900000000
  implements MigrationInterface
{
  name = 'AllowMultipleTradesPerItem1754900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trades" DROP CONSTRAINT IF EXISTS "UQ_trades_recommendation_item"`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_trades_recommendation_item"
        ON "trades" ("recommendation_item_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_trades_recommendation_item"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trades"
        ADD CONSTRAINT "UQ_trades_recommendation_item" UNIQUE ("recommendation_item_id")`,
    );
  }
}
