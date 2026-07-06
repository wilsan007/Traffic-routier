import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CasesService } from './cases.service';
import { CreateCaseDto } from './dto/create-case.dto';
import { UpdateCaseDto } from './dto/update-case.dto';
import { AddNoteDto } from './dto/add-note.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('cases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('cases')
export class CasesController {
  constructor(private casesService: CasesService) {}

  @Post()
  create(@Body() dto: CreateCaseDto, @CurrentUser() user: { userId: string }) {
    return this.casesService.create(dto, user.userId);
  }

  @Get()
  findAll(@Query('status') status?: string) {
    return this.casesService.findAll(status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.casesService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  update(@Param('id') id: string, @Body() dto: UpdateCaseDto) {
    return this.casesService.update(id, dto);
  }

  @Post(':id/notes')
  addNote(
    @Param('id') id: string,
    @Body() dto: AddNoteDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.casesService.addNote(id, dto.content, user.userId);
  }

  @Post(':id/attachments')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  addAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { userId: string },
  ) {
    return this.casesService.addAttachment(id, file.buffer, file.mimetype, user.userId);
  }
}
