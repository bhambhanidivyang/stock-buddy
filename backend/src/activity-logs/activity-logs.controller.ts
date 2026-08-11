import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';
import { ActivityLogsService } from './activity-logs.service';

@Controller('logs')
export class ActivityLogsController {
  constructor(private readonly activityLogs: ActivityLogsService) {}

  /** Date-wise milestone logs (newest day first). */
  @Get()
  list(
    @CurrentUser() user: User,
    @Query('days', new DefaultValuePipe(21), ParseIntPipe) days: number,
  ) {
    return this.activityLogs.listForUser(user.id, days);
  }
}
