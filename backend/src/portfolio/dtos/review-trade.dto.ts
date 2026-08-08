import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  Min,
  ValidateIf,
} from 'class-validator';

export enum ReviewTradeAction {
  /** Paper sell at live mark (full or partial qty). OPEN or NEEDS_REVIEW. */
  SELL = 'SELL',
  /** Return NEEDS_REVIEW → OPEN (optionally retarget). */
  RESUME = 'RESUME',
  /** Update sellTarget / stopLoss on OPEN or NEEDS_REVIEW (both required). */
  MODIFY = 'MODIFY',
}

export class ReviewTradeDto {
  @IsEnum(ReviewTradeAction)
  action: ReviewTradeAction;

  /** Retarget levels (required for MODIFY; optional for SELL/RESUME). */
  @ValidateIf(
    (o: ReviewTradeDto) =>
      o.action === ReviewTradeAction.MODIFY || o.sellTarget != null,
  )
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  sellTarget?: number;

  @ValidateIf(
    (o: ReviewTradeDto) =>
      o.action === ReviewTradeAction.MODIFY || o.stopLoss != null,
  )
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  stopLoss?: number;

  /**
   * Shares to sell (SELL only). Omit or set to full lot qty to close entirely.
   * Must be an integer 1..qty.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty?: number;
}
