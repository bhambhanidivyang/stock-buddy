import {
  BadRequestException,
  Controller,
  HttpException,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { TradingSchedulerService } from './trading-scheduler.service';

type JobParam = 'nse_sync' | 'recommend' | 'execute' | 'catchup';

/** Manual triggers for ops / local testing (JWT required via global guard). */
@Controller('jobs')
export class JobsController {
  constructor(private readonly scheduler: TradingSchedulerService) {}

  @Post('trigger/:job')
  async trigger(@Param('job') job: string) {
    const name = job as JobParam;
    try {
      switch (name) {
        case 'nse_sync':
          await this.scheduler.runNseSync('manual');
          return { ok: true, job: name };
        case 'recommend':
          await this.scheduler.runRecommend('manual');
          return { ok: true, job: name };
        case 'execute':
          await this.scheduler.runExecute('manual');
          return { ok: true, job: name };
        case 'catchup':
          await this.scheduler.runCatchUp();
          return { ok: true, job: name };
        default:
          throw new BadRequestException(
            `Unknown job "${job}". Use nse_sync | recommend | execute | catchup`,
          );
      }
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpException({ ok: false, job: name, message }, HttpStatus.BAD_GATEWAY);
    }
  }
}
