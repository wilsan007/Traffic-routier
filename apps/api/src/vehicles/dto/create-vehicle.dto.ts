import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { InsuranceStatus } from '@prisma/client';

export class CreateVehicleDto {
  @IsString()
  plateNumber: string;

  @IsString()
  regionId: string;

  @IsOptional()
  @IsString()
  make?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsInt()
  year?: number;

  @IsOptional()
  @IsString()
  vin?: string;

  @IsOptional()
  @IsDateString()
  registeredAt?: string;

  @IsOptional()
  @IsEnum(InsuranceStatus)
  insuranceStatus?: InsuranceStatus;

  @IsOptional()
  @IsDateString()
  insuranceExpiresAt?: string;

  @IsOptional()
  @IsDateString()
  technicalControlExpiresAt?: string;

  @IsOptional()
  @IsBoolean()
  stolen?: boolean;

  @IsOptional()
  @IsString()
  ownerId?: string;
}
