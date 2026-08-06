import { beforeEach, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AccountService } from '../account/account.service';
import { Trade } from '../database/entities';
import { TradeStatus } from '../database/enums';
import { YahooService } from '../market/yahoo.service';
import { StatementService } from './statement.service';

describe('StatementService', () => {
  let service: StatementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatementService,
        {
          provide: AccountService,
          useValue: {
            getAccountForUser: async (_userId?: string) => ({
              id: 'acc-1',
              initialFund: '100000',
            }),
          },
        },
        {
          provide: YahooService,
          useValue: { getQuotes: async () => new Map() },
        },
        {
          provide: getRepositoryToken(Trade),
          useValue: {
            find: async () => [],
          },
        },
      ],
    }).compile();

    service = module.get<StatementService>(StatementService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('sets cash and holdings after same-day round trip', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StatementService,
        {
          provide: AccountService,
          useValue: {
            getAccountForUser: async (_userId?: string) => ({
              id: 'acc-1',
              initialFund: '100000',
            }),
          },
        },
        {
          provide: YahooService,
          useValue: { getQuotes: async () => new Map() },
        },
        {
          provide: getRepositoryToken(Trade),
          useValue: {
            find: async () => [
              {
                symbol: 'ITC',
                qty: 4,
                status: TradeStatus.CLOSED,
                buyAt: new Date('2026-08-01T04:30:00.000Z'),
                buyPrice: '250.00',
                stopLoss: '240.00',
                sellTarget: '262.50',
                investedInr: '1000.00',
                sellAt: new Date('2026-08-01T08:30:00.000Z'),
                proceedsInr: '1100.00',
                realizedPnl: '100.00',
              },
              {
                symbol: 'RELIANCE',
                qty: 5,
                status: TradeStatus.CLOSED,
                buyAt: new Date('2026-08-01T04:30:00.000Z'),
                buyPrice: '400.00',
                stopLoss: '388.00',
                sellTarget: '415.00',
                investedInr: '2000.00',
                sellAt: new Date('2026-08-01T08:30:00.000Z'),
                proceedsInr: '2050.00',
                realizedPnl: '50.00',
              },
            ],
          },
        },
      ],
    }).compile();

    const rows = await moduleRef.get(StatementService).getStatement("user-1");
    const aug1 = rows.find((r) => r.date === '2026-08-01');
    expect(aug1).toMatchObject({
      date: '2026-08-01',
      buyAmount: 3000,
      sellAmount: 3150,
      profitLoss: 150,
      cash: 100150,
      holdingsValue: 0,
      stocksBought:
        '4xITC @250 SL240 T262.5, 5xRELIANCE @400 SL388 T415',
      stocksSold: '4xITC, 5xRELIANCE',
      holdings: '',
    });
  });

  it('shows carried holdings and sold names across days', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StatementService,
        {
          provide: AccountService,
          useValue: {
            getAccountForUser: async (_userId?: string) => ({
              id: 'acc-1',
              initialFund: '100000',
            }),
          },
        },
        {
          provide: YahooService,
          useValue: { getQuotes: async () => new Map() },
        },
        {
          provide: getRepositoryToken(Trade),
          useValue: {
            find: async () => [
              {
                symbol: 'ITC',
                qty: 4,
                status: TradeStatus.CLOSED,
                buyAt: new Date('2026-07-29T04:30:00.000Z'),
                buyPrice: '250.00',
                stopLoss: '240.00',
                sellTarget: '262.50',
                investedInr: '1000.00',
                sellAt: new Date('2026-07-29T08:30:00.000Z'),
                proceedsInr: '1100.00',
                realizedPnl: '100.00',
              },
              {
                symbol: 'RELIANCE',
                qty: 5,
                status: TradeStatus.CLOSED,
                buyAt: new Date('2026-07-29T04:30:00.000Z'),
                buyPrice: '400.00',
                stopLoss: '388.00',
                sellTarget: '415.00',
                investedInr: '2000.00',
                sellAt: new Date('2026-07-30T08:30:00.000Z'),
                proceedsInr: '2050.00',
                realizedPnl: '50.00',
              },
            ],
          },
        },
      ],
    }).compile();

    const rows = await moduleRef.get(StatementService).getStatement("user-1");
    const d29 = rows.find((r) => r.date === '2026-07-29');
    const d30 = rows.find((r) => r.date === '2026-07-30');

    expect(d29).toMatchObject({
      stocksBought:
        '4xITC @250 SL240 T262.5, 5xRELIANCE @400 SL388 T415',
      stocksSold: '4xITC',
      holdings: '5xRELIANCE · new',
    });
    expect(d30).toMatchObject({
      stocksBought: '',
      stocksSold: '5xRELIANCE',
      holdings: '',
    });
  });

  it('WAITING_BUY does not reduce cash; open lots count as holdings', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StatementService,
        {
          provide: AccountService,
          useValue: {
            getAccountForUser: async (_userId?: string) => ({
              id: 'acc-1',
              initialFund: '100000',
            }),
          },
        },
        {
          provide: YahooService,
          useValue: {
            getQuotes: async () =>
              new Map([['GAIL', { price: 180, symbol: 'GAIL' }]]),
          },
        },
        {
          provide: getRepositoryToken(Trade),
          useValue: {
            find: async () => [
              {
                symbol: 'TCS',
                qty: 10,
                status: TradeStatus.WAITING_BUY,
                buyAt: null,
                investedInr: null,
                sellAt: null,
                realizedPnl: null,
              },
              {
                symbol: 'GAIL',
                qty: 100,
                status: TradeStatus.OPEN,
                buyAt: new Date('2026-08-01T04:30:00.000Z'),
                buyPrice: '180.00',
                stopLoss: '174.00',
                sellTarget: '186.75',
                investedInr: '18000.00',
                sellAt: null,
                realizedPnl: null,
              },
            ],
          },
        },
      ],
    }).compile();

    const rows = await moduleRef.get(StatementService).getStatement("user-1");
    const aug1 = rows.find((r) => r.date === '2026-08-01');
    expect(aug1).toMatchObject({
      buyAmount: 18000,
      sellAmount: 0,
      profitLoss: 0,
      cash: 82000,
      holdingsValue: 18000, // 100 * 180 mark
      stocksBought: '100xGAIL @180 SL174 T186.75',
      stocksSold: '',
      holdings: '100xGAIL · new',
    });
  });
});
