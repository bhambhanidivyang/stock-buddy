import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SchedulerJobName,
  SchedulerRun,
} from '../database/entities/scheduler-run.entity';
import { loadSchedulerConfig } from './scheduler.config';

@Injectable()
export class SchedulerRunStore {
  constructor(
    @InjectRepository(SchedulerRun)
    private readonly runs: Repository<SchedulerRun>,
  ) {}

  /**
   * Claim a once-per-IST-day job slot.
   * Returns false if already successful or another worker is freshly running.
   */
  async claim(jobName: SchedulerJobName, runDate: string): Promise<boolean> {
    const config = loadSchedulerConfig();
    const existing = await this.runs.findOne({ where: { jobName, runDate } });
    const now = new Date();

    if (!existing) {
      await this.runs.save(
        this.runs.create({
          jobName,
          runDate,
          status: 'running',
          detail: null,
          startedAt: now,
          finishedAt: null,
        }),
      );
      return true;
    }

    if (existing.status === 'success') {
      return false;
    }

    if (existing.status === 'running') {
      const age = now.getTime() - new Date(existing.startedAt).getTime();
      if (age < config.staleRunningMs) {
        return false;
      }
    }

    existing.status = 'running';
    existing.detail = null;
    existing.startedAt = now;
    existing.finishedAt = null;
    await this.runs.save(existing);
    return true;
  }

  async complete(
    jobName: SchedulerJobName,
    runDate: string,
    status: 'success' | 'failed' | 'skipped',
    detail?: string,
  ): Promise<void> {
    const existing = await this.runs.findOne({ where: { jobName, runDate } });
    if (!existing) return;
    existing.status = status;
    existing.detail = detail ?? null;
    existing.finishedAt = new Date();
    await this.runs.save(existing);
  }
}
