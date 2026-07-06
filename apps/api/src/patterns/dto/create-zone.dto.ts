import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateZoneDto {
  @IsString()
  name: string;

  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;

  @IsOptional()
  @IsNumber()
  radiusMeters?: number;
}
