import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { RedisCacheService } from './redis-cache.service';

@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
        const redis = new Redis(redisUrl);
        return {
          throttlers: [
            { name: 'short', ttl: 1000, limit: 10 },
            { name: 'medium', ttl: 10000, limit: 50 },
            { name: 'long', ttl: 60000, limit: 200 },
          ],
          storage: new ThrottlerStorageRedisService(redis),
        };
      },
    }),
  ],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
        return new Redis(redisUrl);
      },
    },
    RedisCacheService,
  ],
  exports: ['REDIS_CLIENT', RedisCacheService],
})
export class RedisModule {}
