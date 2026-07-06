import { IsIn } from 'class-validator';

export class ResolveAlertDto {
  @IsIn(['RESOLVED', 'FALSE_POSITIVE'])
  status: 'RESOLVED' | 'FALSE_POSITIVE';
}
