import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateWagerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  providerId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  externalTransactionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  playerId!: string;

  @IsUUID()
  walletId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  roundId!: string;

  @IsIn(['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'])
  type!: 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';

  @IsString()
  @Matches(/^(?=.*[1-9])\d{1,18}(?:\.\d{1,2})?$/)
  amount!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  referenceExternalTransactionId?: string;
}
