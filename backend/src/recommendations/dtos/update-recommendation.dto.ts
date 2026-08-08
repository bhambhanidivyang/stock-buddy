import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateRecommendationItemDto {
  @IsUUID()
  id: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  qty: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  allocationInr: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  buyLow: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  buyHigh: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  sellTarget: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  stopLoss: number;
}

export class UpdateRecommendationDto {
  /** Empty array clears the buy list (user removed every name). */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateRecommendationItemDto)
  items: UpdateRecommendationItemDto[];
}
