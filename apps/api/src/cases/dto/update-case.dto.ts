import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CaseStatus } from '@prisma/client';

export class UpdateCaseDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(CaseStatus)
  status?: CaseStatus;

  @IsOptional()
  @IsString()
  assignedToId?: string;
}
