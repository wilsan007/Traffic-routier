import { Module } from '@nestjs/common';
import { FleetsController } from './fleets.controller';

@Module({
  controllers: [FleetsController],
})
export class FleetsModule {}
