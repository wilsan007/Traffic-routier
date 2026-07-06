import { IsDateString, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { InfractionSeverity } from '@prisma/client';

export class CreateInfractionDto {
  @IsString()
  vehicleId: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  captureId?: string;

  @IsOptional()
  @IsString()
  typeId?: string; // référence au barème (InfractionType)

  @IsOptional()
  @IsString()
  type?: string; // libellé libre si pas de barème

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(InfractionSeverity)
  severity?: InfractionSeverity;

  @IsOptional()
  @IsNumber()
  fineAmount?: number;

  @IsOptional()
  @IsNumber()
  points?: number;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}
