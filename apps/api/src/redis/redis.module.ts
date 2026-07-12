import { Module, Global, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { RedisCacheService } from './redis-cache.service';
import { InMemoryRedis } from './in-memory-redis';

const THROTTLERS = [
  { name: 'short', ttl: 1000, limit: 10 },
  { name: 'medium', ttl: 10000, limit: 50 },
  { name: 'long', ttl: 60000, limit: 200 },
];

// Redis n'est utilisé que si REDIS_URL est explicitement défini. Sinon (offre
// gratuite sans Redis), l'API bascule en mémoire : throttling in-memory + cache
// in-memory, sans aucune dépendance externe. Un vrai Redis reste recommandé en
// multi-instances.
@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        if (redisUrl) {
          return {
            throttlers: THROTTLERS,
            storage: new ThrottlerStorageRedisService(new Redis(redisUrl)),
          };
        }
        // Stockage in-memory par défaut (aucun `storage` fourni).
        return { throttlers: THROTTLERS };
      },
    }),
  ],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        if (redisUrl) {
          return new Redis(redisUrl);
        }
        new Logger('RedisModule').warn(
          'REDIS_URL absent : bascule en cache/throttling en mémoire (mono-instance).',
        );
        return new InMemoryRedis();
      },
    },
    RedisCacheService,
  ],
  exports: ['REDIS_CLIENT', RedisCacheService],
})
export class RedisModule {}
