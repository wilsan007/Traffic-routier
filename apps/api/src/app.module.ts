import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './common/audit/audit.module';
import { StorageModule } from './storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RegionsModule } from './regions/regions.module';
import { OwnersModule } from './owners/owners.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { CamerasModule } from './cameras/cameras.module';
import { HotlistModule } from './hotlist/hotlist.module';
import { AlertsModule } from './alerts/alerts.module';
import { CapturesModule } from './captures/captures.module';
import { InfractionsModule } from './infractions/infractions.module';
import { CasesModule } from './cases/cases.module';
import { SearchModule } from './search/search.module';
import { AuditViewerModule } from './audit/audit-viewer.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { PatternsModule } from './patterns/patterns.module';
import { RetentionModule } from './retention/retention.module';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from './notifications/notifications.module';
import { InfractionTypesModule } from './infraction-types/infraction-types.module';
import { PublicPortalModule } from './public-portal/public-portal.module';
import { FleetsModule } from './fleets/fleets.module';
import { TollsModule } from './tolls/tolls.module';
import { OpsModule } from './ops/ops.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport: process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
        autoLogging: true,
      },
    }),
    RedisModule,
    PrismaModule,
    AuditModule,
    StorageModule,
    AuthModule,
    UsersModule,
    RegionsModule,
    OwnersModule,
    VehiclesModule,
    CamerasModule,
    HotlistModule,
    AlertsModule,
    CapturesModule,
    InfractionsModule,
    CasesModule,
    SearchModule,
    AuditViewerModule,
    AnalyticsModule,
    HealthModule,
    ScheduleModule.forRoot(),
    PatternsModule,
    RetentionModule,
    NotificationsModule,
    InfractionTypesModule,
    PublicPortalModule,
    FleetsModule,
    TollsModule,
    OpsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
