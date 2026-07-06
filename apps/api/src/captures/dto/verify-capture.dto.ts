import { IsString } from 'class-validator';

export class VerifyCaptureDto {
  @IsString()
  correctedPlate: string;
}
