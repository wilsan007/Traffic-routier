import { IsString } from 'class-validator';

export class AddNoteDto {
  @IsString()
  content: string;
}
