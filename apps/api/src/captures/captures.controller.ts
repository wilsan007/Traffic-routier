import {
  BadRequestException,
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
import { CapturesService } from './captures.service';
import { VerifyCaptureDto } from './dto/verify-capture.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { imageUploadOptions } from '../common/multer/upload.options';

@ApiTags('captures')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('captures')
export class CapturesController {
  constructor(private capturesService: CapturesService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('image', imageUploadOptions()))
  ingest(
    @UploadedFile() image: Express.Multer.File,
    @Body('cameraId') cameraId: string,
    @Body('latitude') latitude: string,
    @Body('longitude') longitude: string,
    @CurrentUser() user: { userId: string },
  ) {
    if (!image) throw new BadRequestException('Image requise.');
    return this.capturesService.ingest({
      imageBuffer: image.buffer,
      cameraId: cameraId || undefined,
      officerId: user.userId,
      latitude: latitude ? parseFloat(latitude) : undefined,
      longitude: longitude ? parseFloat(longitude) : undefined,
    });
  }

  @Post('scan')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('image', imageUploadOptions()))
  scan(
    @UploadedFile() image: Express.Multer.File,
    @Body('latitude') latitude: string,
    @Body('longitude') longitude: string,
    @CurrentUser() user: { userId: string },
  ) {
    if (!image) throw new BadRequestException('Image requise.');
    return this.capturesService.scan({
      imageBuffer: image.buffer,
      officerId: user.userId,
      latitude: latitude ? parseFloat(latitude) : undefined,
      longitude: longitude ? parseFloat(longitude) : undefined,
    });
  }

  @Get()
  findAll(@Query('plate') plate?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.capturesService.findAll({ plate, from, to });
  }

  @Get('review-queue')
  findLowConfidence() {
    return this.capturesService.findLowConfidence();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.capturesService.findOne(id);
  }

  @Patch(':id/verify')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  verify(
    @Param('id') id: string,
    @Body() dto: VerifyCaptureDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.capturesService.verify(id, dto.correctedPlate, user.userId);
  }
}
