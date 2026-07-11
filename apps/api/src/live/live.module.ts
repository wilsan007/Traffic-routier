import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LiveGateway } from './live.gateway';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'change-me-super-secret-in-prod',
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [LiveGateway],
  exports: [LiveGateway],
})
export class LiveModule {}
