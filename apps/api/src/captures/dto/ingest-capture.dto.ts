import { IsOptional, IsString, IsNumberString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class IngestCaptureDto {
  @ApiPropertyOptional({ description: 'ID de la caméra associée' })
  @IsOptional()
  @IsString()
  cameraId?: string;

  @ApiPropertyOptional({ description: 'Latitude GPS' })
  @IsOptional()
  @IsNumberString()
  latitude?: string;

  @ApiPropertyOptional({ description: 'Longitude GPS' })
  @IsOptional()
  @IsNumberString()
  longitude?: string;
}
