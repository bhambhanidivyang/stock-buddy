import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { moneyString } from '../common/money';
import { Account } from '../database/entities';

@Injectable()
export class AccountService {
  constructor(
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
    private readonly config: ConfigService,
  ) {}

  /** Paper account for the authenticated user (creates if missing). */
  async getAccountForUser(userId: string): Promise<Account> {
    const existing = await this.accounts.findOne({ where: { userId } });
    if (existing) {
      return existing;
    }
    return this.createPaperAccount(userId);
  }

  /** All user-owned paper accounts (scheduler). */
  async listUserPaperAccounts(): Promise<Account[]> {
    return this.accounts.find({
      where: { userId: Not(IsNull()) },
      order: { createdAt: 'ASC' },
    });
  }

  async createPaperAccount(userId: string): Promise<Account> {
    const existing = await this.accounts.findOne({ where: { userId } });
    if (existing) {
      return existing;
    }

    const initial = this.initialFundInr();
    const account = this.accounts.create({
      userId,
      name: 'paper',
      initialFund: moneyString(initial),
      cash: moneyString(initial),
      realizedPnl: moneyString(0),
    });
    return this.accounts.save(account);
  }

  async getAccountById(accountId: string): Promise<Account> {
    const account = await this.accounts.findOne({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException(`Account ${accountId} not found`);
    }
    return account;
  }

  private initialFundInr(): number {
    const raw = this.config.get<string>('DAILY_FUND', '100000');
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 100_000;
  }
}
