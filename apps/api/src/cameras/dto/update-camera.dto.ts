import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { CreateCameraDto } from './create-camera.dto';

export class UpdateCameraDto extends PartialType(CreateCameraDto) {
  @IsOptional()
  @IsString()
  streamUrl?: string;

  @IsOptional()
  @IsBoolean()
  recordingEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
