import { Module } from '@nestjs/common';
import { OwnersService } from './owners.service';
import { OwnersController } from './owners.controller';

@Module({
  providers: [OwnersService],
  controllers: [OwnersController],
  exports: [OwnersService],
})
export class OwnersModule {}
