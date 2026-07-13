import { Module } from '@nestjs/common';
import { CamerasService } from './cameras.service';
import { CamerasController } from './cameras.controller';
import { MediamtxService } from './mediamtx.service';
import { LiveIngestService } from './live-ingest.service';
import { CapturesModule } from '../captures/captures.module';

@Module({
  imports: [CapturesModule],
  providers: [CamerasService, MediamtxService, LiveIngestService],
  controllers: [CamerasController],
  exports: [CamerasService, MediamtxService],
})
export class CamerasModule {}
