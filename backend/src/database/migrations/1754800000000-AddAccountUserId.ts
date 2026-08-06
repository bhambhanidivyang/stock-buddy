import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One paper account per user.
 * - Adds accounts.user_id (unique, FK users)
 * - Drops global unique on accounts.name (many users can have name "paper")
 * - Assigns legacy "default" account to the oldest user when present
 */
export class AddAccountUserId1754800000000 implements MigrationInterface {
  name = 'AddAccountUserId1754800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "accounts"
      ADD COLUMN IF NOT EXISTS "user_id" uuid
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "accounts"
          ADD CONSTRAINT "FK_accounts_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // Drop name uniqueness so each user can have name 'paper'
    await queryRunner.query(`
      ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "UQ_accounts_name"
    `);

    // Attach legacy default account to oldest user (if any)
    await queryRunner.query(`
      UPDATE "accounts" a
      SET "user_id" = u.id
      FROM (
        SELECT id FROM "users" ORDER BY "createdAt" ASC LIMIT 1
      ) u
      WHERE a."name" = 'default' AND a."user_id" IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_accounts_user_id"
      ON "accounts" ("user_id")
      WHERE "user_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_accounts_user_id"
      ON "accounts" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_accounts_user_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_accounts_user_id"`);
    await queryRunner.query(`
      ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "FK_accounts_user"
    `);
    await queryRunner.query(`
      ALTER TABLE "accounts" DROP COLUMN IF EXISTS "user_id"
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "accounts"
          ADD CONSTRAINT "UQ_accounts_name" UNIQUE ("name");
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
  }
}
