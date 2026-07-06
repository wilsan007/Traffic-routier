import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class RejectInfractionDto {
  @IsString()
  reason: string;
}

export class RecordPaymentDto {
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsOptional()
  @IsString()
  payerName?: string;
}

export class OpenDisputeDto {
  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  details?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  attachmentUrls?: string[];
}

export class DecideDisputeDto {
  @IsBoolean()
  accept: boolean;

  @IsString()
  decision: string;
}

export class CancelInfractionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
