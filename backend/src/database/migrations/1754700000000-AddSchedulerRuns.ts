import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSchedulerRuns1754700000000 implements MigrationInterface {
  name = 'AddSchedulerRuns1754700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "scheduler_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "jobName" character varying(64) NOT NULL,
        "runDate" character varying(10) NOT NULL,
        "status" character varying(16) NOT NULL,
        "detail" text,
        "startedAt" TIMESTAMPTZ NOT NULL,
        "finishedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_scheduler_runs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_scheduler_runs_job_date" UNIQUE ("jobName", "runDate")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "scheduler_runs"`);
  }
}
