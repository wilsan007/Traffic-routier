import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';
import { AlertsGateway } from './alerts.gateway';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'change-me-super-secret-in-prod',
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AlertsService, AlertsGateway],
  controllers: [AlertsController],
  exports: [AlertsService, AlertsGateway],
})
export class AlertsModule {}
