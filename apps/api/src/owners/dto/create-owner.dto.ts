import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { LicenseStatus } from '@prisma/client';

export class CreateOwnerDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  nationalId?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @IsOptional()
  @IsEnum(LicenseStatus)
  licenseStatus?: LicenseStatus;

  @IsOptional()
  @IsDateString()
  licenseExpiresAt?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;
}
