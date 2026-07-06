import { IsEnum } from 'class-validator';
import { InfractionStatus } from '@prisma/client';

export class UpdateInfractionStatusDto {
  @IsEnum(InfractionStatus)
  status: InfractionStatus;
}
