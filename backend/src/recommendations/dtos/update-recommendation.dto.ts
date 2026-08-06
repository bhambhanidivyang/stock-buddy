import { Type } from 'class-transformer';
import {
  ArrayMinSize,
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
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateRecommendationItemDto)
  items: UpdateRecommendationItemDto[];
}
