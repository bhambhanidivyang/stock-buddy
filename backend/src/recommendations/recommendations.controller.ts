import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';
import { AddRecommendationItemDto } from './dtos/add-recommendation-item.dto';
import { UpdateRecommendationDto } from './dtos/update-recommendation.dto';
import { RecommendationsService } from './recommendations.service';

@Controller('recommendations')
export class RecommendationsController {
  constructor(
    private readonly recommendationsService: RecommendationsService,
  ) {}

  /** Past recommendation runs for the signed-in account (newest first). */
  @Get()
  list(
    @CurrentUser() user: User,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.recommendationsService.listRecommendations(user.id, limit);
  }

  /** Sole Executable (customizable) plan for today, if any. */
  @Get('executable')
  getExecutable(@CurrentUser() user: User) {
    return this.recommendationsService.getExecutablePlan(user.id);
  }

  @Get(':id')
  getOne(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.recommendationsService.getRecommendation(user.id, id);
  }

  @Post()
  create(@CurrentUser() user: User) {
    return this.recommendationsService.createRecommendation(user.id);
  }

  /** Mark a today's PENDING plan as the sole Executable plan. */
  @Post(':id/mark-executable')
  markExecutable(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.recommendationsService.markExecutablePlan(user.id, id);
  }

  /** Add a Buyable shortlist symbol into the Executable plan. */
  @Post(':id/items')
  addItem(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddRecommendationItemDto,
  ) {
    return this.recommendationsService.addBuyableItem(user.id, id, body);
  }

  /** Edit Executable plan items (qty, levels) before execute. */
  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRecommendationDto,
  ) {
    return this.recommendationsService.updateRecommendation(
      user.id,
      id,
      body,
    );
  }
}
