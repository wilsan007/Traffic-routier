import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { HotlistReason, Priority } from '@prisma/client';

export class CreateHotlistEntryDto {
  @IsString()
  plateNumber: string;

  @IsEnum(HotlistReason)
  reason: HotlistReason;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
