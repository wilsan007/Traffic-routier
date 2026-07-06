import { Module } from '@nestjs/common';
import { PublicPortalController } from './public-portal.controller';
import { InfractionsModule } from '../infractions/infractions.module';

@Module({
  imports: [InfractionsModule],
  controllers: [PublicPortalController],
})
export class PublicPortalModule {}
