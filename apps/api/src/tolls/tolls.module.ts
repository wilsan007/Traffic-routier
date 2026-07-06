import { Module } from '@nestjs/common';
import { TollsService } from './tolls.service';
import { TollsController } from './tolls.controller';

@Module({
  providers: [TollsService],
  controllers: [TollsController],
  exports: [TollsService],
})
export class TollsModule {}
