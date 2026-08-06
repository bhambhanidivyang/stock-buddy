import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';
import { StatementDto } from './dtos/statement.dto';
import { StatementService } from './statement.service';

@Controller('statement')
export class StatementController {
  constructor(private readonly statementService: StatementService) {}

  @Get()
  async getStatement(@CurrentUser() user: User): Promise<StatementDto[]> {
    return this.statementService.getStatement(user.id);
  }
}
