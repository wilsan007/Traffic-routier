import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { CameraType } from '@prisma/client';

export class CreateCameraDto {
  @IsString()
  name: string;

  @IsEnum(CameraType)
  type: CameraType;

  @IsString()
  regionId: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;
}
