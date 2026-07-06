import { IsString, IsOptional } from 'class-validator';

export class CreateRegionDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsString()
  plateFormatRegex: string;

  @IsOptional()
  @IsString()
  plateFormatHint?: string;
}
