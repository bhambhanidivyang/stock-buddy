import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';
import { ExecuteService } from './execute.service';

@Controller('execute')
export class ExecuteController {
  constructor(private readonly executeService: ExecuteService) {}

  @Post()
  start(
    @CurrentUser() user: User,
    @Body() body?: { recommendationId?: string },
  ) {
    return this.executeService.startExecution(user.id, body?.recommendationId);
  }

  @Get('status')
  status(@CurrentUser() user: User) {
    return this.executeService.getStatus(user.id);
  }

  /** Past execution sessions with trade fills (newest first). */
  @Get('history')
  history(
    @CurrentUser() user: User,
    @Query('limit') limit?: string,
  ) {
    const n = limit != null ? Number(limit) : 30;
    return this.executeService.listHistory(
      user.id,
      Number.isFinite(n) ? n : 30,
    );
  }

  @Post('stop')
  stop(@CurrentUser() user: User) {
    return this.executeService.stopExecution(user.id);
  }
}
