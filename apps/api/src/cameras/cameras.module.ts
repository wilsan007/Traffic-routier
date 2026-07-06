import { Module } from '@nestjs/common';
import { CamerasService } from './cameras.service';
import { CamerasController } from './cameras.controller';
import { MediamtxService } from './mediamtx.service';

@Module({
  providers: [CamerasService, MediamtxService],
  controllers: [CamerasController],
  exports: [CamerasService, MediamtxService],
})
export class CamerasModule {}
