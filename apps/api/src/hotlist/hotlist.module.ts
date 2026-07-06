import { Module } from '@nestjs/common';
import { HotlistService } from './hotlist.service';
import { HotlistController } from './hotlist.controller';

@Module({
  providers: [HotlistService],
  controllers: [HotlistController],
  exports: [HotlistService],
})
export class HotlistModule {}
