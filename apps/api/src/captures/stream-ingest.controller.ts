import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CapturesService } from './captures.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { imageUploadOptions } from '../common/multer/upload.options';

// Ingestion machine-à-machine depuis le worker de flux vidéo (service ML).
// Authentifiée par clé de service (x-api-key), pas par JWT utilisateur —
// volontairement dans un contrôleur séparé pour ne pas hériter des guards JWT.
@ApiTags('captures')
@ApiSecurity('x-api-key')
@UseGuards(ApiKeyGuard)
@Controller('captures/stream')
export class StreamIngestController {
  constructor(private capturesService: CapturesService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('image', imageUploadOptions()))
  ingestFromStream(
    @UploadedFile() image: Express.Multer.File,
    @Body('cameraId') cameraId: string,
    @Body('plateText') plateText: string,
    @Body('confidence') confidence: string,
    @Body('latitude') latitude: string,
    @Body('longitude') longitude: string,
  ) {
    if (!image) throw new BadRequestException('Image requise.');
    return this.capturesService.ingest({
      imageBuffer: image.buffer,
      cameraId: cameraId || undefined,
      latitude: latitude ? parseFloat(latitude) : undefined,
      longitude: longitude ? parseFloat(longitude) : undefined,
      preDetected:
        plateText != null
          ? { plateText, confidence: confidence ? parseFloat(confidence) : 0 }
          : undefined,
    });
  }
}
