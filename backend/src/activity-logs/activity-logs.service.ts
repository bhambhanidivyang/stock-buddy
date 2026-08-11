import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountService } from '../account/account.service';
import {
  ActivityLog,
  type ActivityLogCategory,
} from '../database/entities/activity-log.entity';
import { istDateKey } from '../market/market-clock';

@Injectable()
export class ActivityLogsService {
  constructor(
    private readonly accounts: AccountService,
    @InjectRepository(ActivityLog)
    private readonly logs: Repository<ActivityLog>,
  ) {}

  async append(input: {
    accountId: string;
    category: ActivityLogCategory;
    eventCode: string;
    message: string;
    meta?: Record<string, unknown> | null;
    refId?: string | null;
    at?: Date;
  }): Promise<ActivityLog> {
    const at = input.at ?? new Date();
    const row = this.logs.create({
      accountId: input.accountId,
      dayKey: istDateKey(at),
      category: input.category,
      eventCode: input.eventCode,
      message: input.message,
      meta: input.meta ?? null,
      refId: input.refId ?? null,
      createdAt: at,
    });
    return this.logs.save(row);
  }

  async listForUser(userId: string, dayLimit = 21) {
    const account = await this.accounts.getAccountForUser(userId);
    const takeDays = Math.min(60, Math.max(1, Math.floor(dayLimit)));

    const rows = await this.logs.find({
      where: { accountId: account.id },
      order: { createdAt: 'DESC' },
      take: takeDays * 80,
    });

    const byDay = new Map<
      string,
      Array<{
        id: string;
        category: ActivityLogCategory;
        eventCode: string;
        message: string;
        meta: Record<string, unknown> | null;
        refId: string | null;
        createdAt: Date;
      }>
    >();

    for (const row of rows) {
      const list = byDay.get(row.dayKey) ?? [];
      list.push({
        id: row.id,
        category: row.category,
        eventCode: row.eventCode,
        message: row.message,
        meta: row.meta,
        refId: row.refId,
        createdAt: row.createdAt,
      });
      byDay.set(row.dayKey, list);
    }

    return [...byDay.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, takeDays)
      .map(([dayKey, events]) => ({
        dayKey,
        events: events.sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        ),
      }));
  }
}
