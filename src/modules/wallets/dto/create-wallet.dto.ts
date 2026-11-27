import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class CreateWalletDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  playerId!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsString()
  @Matches(/^\d{1,18}(?:\.\d{1,2})?$/)
  openingBalance!: string;
}
