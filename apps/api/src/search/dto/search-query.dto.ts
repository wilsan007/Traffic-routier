import { IsEnum, IsString } from 'class-validator';
import { SearchType } from '@prisma/client';

export class SearchQueryDto {
  @IsString()
  q: string;

  @IsEnum(SearchType)
  type: SearchType;
}
