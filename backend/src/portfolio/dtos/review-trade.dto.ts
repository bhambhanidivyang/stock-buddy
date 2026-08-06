import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';

export enum ReviewTradeAction {
  SELL = 'SELL',
  RESUME = 'RESUME',
}

export class ReviewTradeDto {
  @IsEnum(ReviewTradeAction)
  action: ReviewTradeAction;

  /** Optional retarget before sell or hold (both required together). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  sellTarget?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  stopLoss?: number;
}
