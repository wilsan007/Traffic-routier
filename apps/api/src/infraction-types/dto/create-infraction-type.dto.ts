import { IsBoolean, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateInfractionTypeDto {
  @IsString()
  code: string;

  @IsString()
  label: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsNumber()
  baseAmount: number;

  @IsOptional()
  @IsNumber()
  reducedAmount?: number;

  @IsOptional()
  @IsNumber()
  increasedAmount?: number;

  @IsOptional()
  @IsInt()
  points?: number;

  @IsOptional()
  @IsInt()
  reducedDays?: number;

  @IsOptional()
  @IsInt()
  dueDays?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
