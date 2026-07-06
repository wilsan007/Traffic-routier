import { Module } from '@nestjs/common';
import { InfractionTypesService } from './infraction-types.service';
import { InfractionTypesController } from './infraction-types.controller';

@Module({
  providers: [InfractionTypesService],
  controllers: [InfractionTypesController],
  exports: [InfractionTypesService],
})
export class InfractionTypesModule {}
