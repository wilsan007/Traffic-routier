import { Module } from '@nestjs/common';
import { CapturesService } from './captures.service';
import { CapturesController } from './captures.controller';
import { StreamIngestController } from './stream-ingest.controller';
import { MlClientService } from './ml-client.service';
import { HotlistModule } from '../hotlist/hotlist.module';
import { AlertsModule } from '../alerts/alerts.module';
import { PatternsModule } from '../patterns/patterns.module';
import { TollsModule } from '../tolls/tolls.module';

@Module({
  imports: [HotlistModule, AlertsModule, PatternsModule, TollsModule],
  providers: [CapturesService, MlClientService],
  controllers: [CapturesController, StreamIngestController],
  exports: [CapturesService],
})
export class CapturesModule {}
