import { Module } from '@nestjs/common';
import { PatternsService } from './patterns.service';
import { PatternsController } from './patterns.controller';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [AlertsModule],
  providers: [PatternsService],
  controllers: [PatternsController],
  exports: [PatternsService],
})
export class PatternsModule {}
