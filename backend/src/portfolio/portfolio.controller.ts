import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';
import { ReviewTradeDto } from './dtos/review-trade.dto';
import { PortfolioService } from './portfolio.service';

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get()
  getPortfolio(@CurrentUser() user: User) {
    return this.portfolioService.getPortfolio(user.id);
  }

  @Post(':tradeId/review')
  reviewTrade(
    @CurrentUser() user: User,
    @Param('tradeId', ParseUUIDPipe) tradeId: string,
    @Body() body: ReviewTradeDto,
  ) {
    return this.portfolioService.reviewTrade(user.id, tradeId, body);
  }
}
