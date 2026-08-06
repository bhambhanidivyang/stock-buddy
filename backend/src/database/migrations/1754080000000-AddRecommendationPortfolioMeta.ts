import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecommendationPortfolioMeta1754080000000
  implements MigrationInterface
{
  name = 'AddRecommendationPortfolioMeta1754080000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recommendation_runs"
      ADD COLUMN IF NOT EXISTS "market_regime" text,
      ADD COLUMN IF NOT EXISTS "confidence" text,
      ADD COLUMN IF NOT EXISTS "portfolio_strategy" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recommendation_runs"
      DROP COLUMN IF EXISTS "portfolio_strategy",
      DROP COLUMN IF EXISTS "confidence",
      DROP COLUMN IF EXISTS "market_regime"
    `);
  }
}
