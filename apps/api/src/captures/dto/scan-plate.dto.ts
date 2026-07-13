import { IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

// Scan par texte de plaque (OCR embarqué on-device) : la reconnaissance a déjà
// eu lieu sur l'appareil, seul le texte de la plaque est transmis au serveur
// pour vérification hotlist / registre.
export class ScanPlateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(16)
  plate: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;
}
