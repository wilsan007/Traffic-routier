import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OpsGateway } from './ops.gateway';
import { OpsController } from './ops.controller';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'change-me-super-secret-in-prod',
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [OpsGateway],
  controllers: [OpsController],
  exports: [OpsGateway],
})
export class OpsModule {}
