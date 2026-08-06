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

  /** Edit PENDING plan items (qty, levels, allocation) before execute. */
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
