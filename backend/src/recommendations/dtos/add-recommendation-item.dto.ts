import { IsString, Matches, MaxLength } from 'class-validator';

export class AddRecommendationItemDto {
  @IsString()
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9._-]+$/, {
    message: 'symbol must be a plain NSE ticker',
  })
  symbol: string;
}
