import { beforeEach, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { StatementController } from './statement.controller';
import { StatementService } from './statement.service';

describe('StatementController', () => {
  let controller: StatementController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatementController],
      providers: [
        {
          provide: StatementService,
          useValue: {
            getStatement: async () => [],
          },
        },
      ],
    }).compile();

    controller = module.get<StatementController>(StatementController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
