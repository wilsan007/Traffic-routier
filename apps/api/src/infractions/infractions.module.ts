import { Module } from '@nestjs/common';
import { InfractionsService } from './infractions.service';
import { InfractionsController } from './infractions.controller';
import { PvPdfService } from './pv-pdf.service';

@Module({
  providers: [InfractionsService, PvPdfService],
  controllers: [InfractionsController],
  exports: [InfractionsService, PvPdfService],
})
export class InfractionsModule {}
